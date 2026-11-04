import {
	Component,
	debounce,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	normalizePath,
	Notice,
	TFile,
	type Editor,
	type WorkspaceLeaf,
} from 'obsidian';
import { callClaude, type CallResult } from './claude';
import { markIdAt, setHoverMark, setIssueMarks, type MarkSpec } from './cm-marks';
import { locateQuote } from './core/anchor';
import { chunkNote } from './core/chunk';
import { wordDiff } from './core/diff';
import {
	addToDictionary,
	filterByDictionary,
	flaggedWord,
	normWord,
	parseDictionary,
} from './core/dictionary';
import { markRange, planFixes, type ResolvedEdit } from './core/edits';
import { runPool } from './core/pool';
import {
	buildCheckMessage,
	buildFactMessage,
	buildScoresMessage,
	CHECK_SYSTEM,
	FACT_SYSTEM,
	SCORES_SYSTEM,
	type CheckOptions,
} from './core/prompt';
import { frontmatterRange } from './core/protect';
import {
	assignIds,
	BAND_LABEL,
	fingerprint,
	formatStamp,
	nothingOpen,
	scoreBand,
	sortByPosition,
	type ItemStatus,
} from './core/review-state';
import {
	checkSchema,
	parseCheck,
	parseFactAnswer,
	parseScores,
	SCORES_SCHEMA,
	type CheckKey,
} from './core/schema';
import type { Issue, IssueKind, RawIssue, Scores } from './core/types';
import type GramspellPlugin from './main';

export const VIEW_TYPE_GRAMSPELL = 'gramspell-check-view';

interface ItemState {
	status: ItemStatus;
	checked: boolean;
	message: string | null;
}

/** Check state for one note, kept for the session so the pane survives note switches. */
export interface NoteCheck {
	path: string;
	issues: Issue[];
	items: Map<string, ItemState>;
	scores: Scores | null;
	scoresError: string | null;
	scoring: boolean;
	busy: boolean;
	/** True once a check has run to completion. */
	finished: boolean;
	done: number;
	total: number;
	errors: string[];
	usage: string[];
	stamped: string | null;
}

const KIND_TITLE: Record<IssueKind, string> = {
	spelling: 'Spelling',
	grammar: 'Grammar',
	fact: 'Facts',
};

const KIND_ORDER: IssueKind[] = ['spelling', 'grammar', 'fact'];

/** Max requests in flight during one check. */
const CONCURRENCY = 3;

export class GramspellView extends ItemView {
	private path: string | null = null;
	private renderScope: Component | null = null;
	private readonly rerenderSoon = debounce(() => this.render(), 800, true);
	private body: HTMLElement | null = null;
	private renderedPath: string | null = null;
	private applyBtn: HTMLButtonElement | null = null;
	private hovered: string | null = null;
	private pending: Promise<void>[] = [];
	/** Kinds hidden with the filter chips (cards and inline marks). */
	private readonly hidden = new Set<IssueKind>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: GramspellPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GRAMSPELL;
	}

	getDisplayText(): string {
		return 'Grammar & spelling';
	}

	getIcon(): string {
		return 'spell-check';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.followActive()));
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				if (info.file?.path === this.path) this.rerenderSoon();
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const check = this.plugin.checks.get(oldPath);
				if (check) {
					this.plugin.checks.delete(oldPath);
					check.path = file.path;
					this.plugin.checks.set(file.path, check);
				}
				if (this.path === oldPath) this.path = file.path;
				this.render();
			}),
		);
		this.registerDomEvent(this.contentEl, 'mouseleave', () => this.hover(null));
		// Clicking an inline mark in the editor scrolls the panel to its card.
		this.registerDomEvent(activeDocument, 'click', (evt) => {
			const id = markIdAt(evt.target);
			const mv = this.markdownView();
			if (id && mv && evt.target instanceof Node && mv.containerEl.contains(evt.target))
				this.focusCard(id);
		});
		this.followActive();
	}

	async onClose(): Promise<void> {
		this.rerenderSoon.cancel();
		this.hover(null);
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = null;
	}

	/** Track the active Markdown note; ignore focus moving into side panes. */
	private followActive(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const path = view?.file?.path ?? null;
		if (path && path !== this.path) {
			this.hover(null);
			this.path = path;
			this.render();
		} else if (!this.path) {
			this.render();
		}
	}

	/** Called by the command: check the given note now. */
	async startCheck(path: string): Promise<void> {
		this.path = path;
		this.render();
		await this.runCheck();
	}

	// ---- note access -------------------------------------------------------

	private file(path = this.path): TFile | null {
		if (!path) return null;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private markdownView(): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === this.path) return v;
		}
		return null;
	}

	private editor(): Editor | null {
		return this.markdownView()?.editor ?? null;
	}

	/** Live editor text when the note is open, else the file on disk. */
	private async noteText(): Promise<string | null> {
		const ed = this.editor();
		if (ed) return ed.getValue();
		const f = this.file();
		return f ? this.app.vault.read(f) : null;
	}

	private apiKey(): string | null {
		const id = this.plugin.settings.apiKeySecret;
		if (!id) return null;
		return this.app.secretStorage.getSecret(id);
	}

	private check(): NoteCheck | null {
		return this.path ? (this.plugin.checks.get(this.path) ?? null) : null;
	}

	private freshCheck(path: string): NoteCheck {
		const c: NoteCheck = {
			path,
			issues: [],
			items: new Map(),
			scores: null,
			scoresError: null,
			scoring: false,
			busy: false,
			finished: false,
			done: 0,
			total: 0,
			errors: [],
			usage: [],
			stamped: null,
		};
		this.plugin.checks.set(path, c);
		return c;
	}

	private async dictionary(): Promise<Set<string>> {
		const f = this.file(normalizePath(this.plugin.settings.dictionaryPath));
		return f ? parseDictionary(await this.app.vault.cachedRead(f)) : new Set();
	}

	/** Previously rejected fixes for this note, as "quote → replacement" lines for the prompt. */
	private ignoredForPrompt(path: string): string[] {
		return (this.plugin.settings.ignored[path] ?? []).map((fp) => {
			const [, quote = '', replacement = ''] = fp.split('|');
			return `"${quote}" → "${replacement}"`;
		});
	}

	// ---- checking ----------------------------------------------------------

	async runCheck(): Promise<void> {
		if (!this.path) return;
		const path = this.path;
		const prev = this.plugin.checks.get(path);
		if (prev?.busy || prev?.scoring) return;
		const s = this.plugin.settings;
		const check = this.freshCheck(path);
		const key = this.apiKey();
		if (!key) {
			check.errors.push(
				'No API key found. Set the Anthropic API key secret in the plugin settings.',
			);
			this.render();
			return;
		}
		const text = await this.noteText();
		if (text === null) {
			check.errors.push('The note could not be read.');
			this.render();
			return;
		}
		if (!s.checkSpelling && !s.checkGrammar && !s.checkFacts && !s.checkScores) {
			check.errors.push('All checks are turned off in settings.');
			this.render();
			return;
		}

		const dict = await this.dictionary();
		const ignored = new Set(s.ignored[path] ?? []);
		const chunks = chunkNote(text);
		const partial = chunks.length > 1;
		const factsInline = s.checkFacts && !s.webSearch;
		const keys: CheckKey[] = [
			...(s.checkSpelling ? (['spelling'] as const) : []),
			...(s.checkGrammar ? (['grammar'] as const) : []),
			...(factsInline ? (['facts'] as const) : []),
		];
		const opts: CheckOptions = {
			variant: s.variant,
			spelling: s.checkSpelling,
			grammar: s.checkGrammar,
			facts: factsInline,
			dictionary: [...dict].sort(),
			ignored: this.ignoredForPrompt(path),
		};
		const base = { apiKey: key, model: s.model, effort: s.effort };

		const addIssues = (raw: RawIssue[]): void => {
			const fresh = filterByDictionary(raw, dict).filter((i) => !ignored.has(fingerprint(i)));
			for (const issue of assignIds(check.issues, fresh)) {
				check.issues.push(issue);
				check.items.set(issue.id, { status: 'open', checked: true, message: null });
			}
		};

		const tasks: Array<() => Promise<void>> = [];
		const label = (i: number): string => (partial ? ` (part ${i + 1}/${chunks.length})` : '');
		chunks.forEach((chunk, i) => {
			if (keys.length) {
				tasks.push(async () => {
					const res = await callClaude({
						...base,
						system: CHECK_SYSTEM,
						user: buildCheckMessage(chunk.text, partial, opts),
						schema: checkSchema(keys),
					});
					this.recordUsage(check, `Check${label(i)}`, res);
					const parsed = parseCheck(res.text, keys);
					if (!parsed.ok) throw new Error(`Claude's answer could not be read: ${parsed.error}`);
					addIssues(parsed.value);
				});
			}
			if (s.checkFacts && s.webSearch) {
				tasks.push(async () => {
					const res = await callClaude({
						...base,
						system: FACT_SYSTEM,
						user: buildFactMessage(chunk.text, partial, opts),
						schema: null,
						webSearch: { maxUses: 5, blockedDomains: s.blockedDomains },
					});
					this.recordUsage(check, `Facts${label(i)}`, res);
					const parsed = parseFactAnswer(res.text);
					if (!parsed.ok)
						throw new Error(`The fact-check answer could not be read: ${parsed.error}`);
					addIssues(parsed.value);
				});
			}
		});
		if (s.checkScores && chunks.length) {
			check.scoring = true;
			tasks.push(() => this.score(check, key, text));
		}

		check.busy = true;
		check.total = tasks.length;
		this.render();
		await runPool(tasks, CONCURRENCY, (_i, result) => {
			check.done++;
			if (result.status === 'rejected') {
				const reason: unknown = result.reason;
				check.errors.push(reason instanceof Error ? reason.message : String(reason));
			}
			if (this.path === path) this.render();
		});
		check.busy = false;
		check.scoring = false;
		check.finished = true;
		if (chunks.length === 0) check.errors.push('The note has no text to check.');
		this.render();
		await this.maybeAutoStamp(check);
	}

	private recordUsage(check: NoteCheck, what: string, res: CallResult): void {
		check.usage.push(`${what}: ${res.usage}`);
	}

	/** Score the note body; errors are kept on the check, not thrown. */
	private async score(check: NoteCheck, key: string, text: string): Promise<void> {
		const s = this.plugin.settings;
		const fm = frontmatterRange(text);
		const body = fm ? text.slice(fm.to) : text;
		check.scoring = true;
		check.scoresError = null;
		try {
			const res = await callClaude({
				apiKey: key,
				model: s.model,
				effort: s.effort,
				system: SCORES_SYSTEM,
				user: buildScoresMessage(body),
				schema: SCORES_SCHEMA,
			});
			this.recordUsage(check, 'Scores', res);
			const parsed = parseScores(res.text);
			if (!parsed.ok) throw new Error(`The scores could not be read: ${parsed.error}`);
			check.scores = parsed.value;
		} catch (e) {
			check.scoresError = e instanceof Error ? e.message : String(e);
		} finally {
			check.scoring = false;
		}
	}

	private async rescore(): Promise<void> {
		const check = this.check();
		if (!check || check.busy || check.scoring) return;
		const key = this.apiKey();
		const text = await this.noteText();
		if (!key || text === null) {
			check.scoresError = key ? 'The note could not be read.' : 'No API key found.';
			this.render();
			return;
		}
		check.scoring = true;
		this.render();
		await this.score(check, key, text);
		this.render();
	}

	// ---- actions -----------------------------------------------------------

	private status(check: NoteCheck, id: string): ItemStatus {
		return check.items.get(id)?.status ?? 'open';
	}

	private applyToEditor(editor: Editor, edits: ResolvedEdit[]): void {
		if (edits.length === 0) return;
		editor.transaction({
			changes: edits.map((e) => ({
				from: editor.offsetToPos(e.range.from),
				to: editor.offsetToPos(e.range.to),
				text: e.replace,
			})),
		});
	}

	async applySelected(): Promise<void> {
		const check = this.check();
		if (!check) return;
		const editor = this.editor();
		if (!editor) {
			new Notice('Open the note in an editor to apply fixes.');
			return;
		}
		const text = editor.getValue();
		const ticked = this.ordered(
			check.issues.filter((i) => {
				const st = check.items.get(i.id);
				return st?.status === 'open' && st.checked && !this.hidden.has(i.kind);
			}),
			text,
		);
		if (ticked.length === 0) {
			new Notice('Nothing is ticked.');
			return;
		}
		const plan = planFixes(text, ticked);
		this.applyToEditor(editor, plan.edits);
		for (const id of plan.applied) {
			const st = check.items.get(id);
			if (st) {
				st.status = 'applied';
				st.checked = false;
				st.message = null;
			}
		}
		for (const r of plan.rejected) {
			const st = check.items.get(r.id);
			if (st) {
				st.checked = false;
				st.message = `Not applied: ${r.reason}`;
			}
		}
		const n = plan.applied.length;
		new Notice(
			`Applied ${n} fix${n === 1 ? '' : 'es'}` +
				(plan.rejected.length ? `, ${plan.rejected.length} not applied` : '') +
				'.',
		);
		this.render();
		await this.maybeAutoStamp(check);
	}

	private async ignore(issue: Issue): Promise<void> {
		const check = this.check();
		const st = check?.items.get(issue.id);
		if (!check || !st) return;
		st.status = 'ignored';
		st.checked = false;
		const list = this.plugin.settings.ignored[check.path] ?? [];
		const fp = fingerprint(issue);
		if (!list.includes(fp)) list.push(fp);
		this.plugin.settings.ignored[check.path] = list;
		await this.plugin.saveSettings();
		this.render();
		await this.maybeAutoStamp(check);
	}

	private async addWord(issue: Issue): Promise<void> {
		const check = this.check();
		if (!check) return;
		const word = flaggedWord(issue);
		if (!word) return;
		const path = normalizePath(this.plugin.settings.dictionaryPath);
		try {
			const existing = this.file(path);
			if (existing) {
				await this.app.vault.process(existing, (t) => addToDictionary(t, word));
			} else {
				const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
				if (folder && !this.app.vault.getAbstractFileByPath(folder))
					await this.app.vault.createFolder(folder);
				await this.app.vault.create(path, addToDictionary('', word));
			}
		} catch (e) {
			new Notice(`Could not update the dictionary: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		// Every open spelling card for this word goes away.
		const n = normWord(word);
		for (const i of check.issues) {
			if (i.kind !== 'spelling' || normWord(flaggedWord(i)) !== n) continue;
			const st = check.items.get(i.id);
			if (st?.status === 'open') {
				st.status = 'ignored';
				st.checked = false;
			}
		}
		new Notice(`Added "${word}" to the dictionary.`);
		this.render();
		await this.maybeAutoStamp(check);
	}

	private async maybeAutoStamp(check: NoteCheck): Promise<void> {
		if (
			this.plugin.settings.autoStamp &&
			check.finished &&
			!check.busy &&
			!check.stamped &&
			check.errors.length === 0 &&
			nothingOpen(check.issues, (id) => this.status(check, id))
		)
			await this.stamp(check);
	}

	private async stamp(check: NoteCheck): Promise<void> {
		const f = this.file(check.path);
		if (!f) return;
		// Flush unsaved editor changes so the frontmatter write can't race them.
		const mv = this.markdownView();
		if (mv) await mv.save();
		const value = formatStamp(new Date());
		await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
			fm.gramcheck = value;
		});
		check.stamped = value;
		new Notice(`Stamped gramcheck: ${value}`);
		this.render();
	}

	private jumpTo(issue: Issue): void {
		const mv = this.markdownView();
		if (!mv) {
			new Notice('Open the note in an editor to jump to the text.');
			return;
		}
		const loc = locateQuote(mv.editor.getValue(), issue.quote);
		if (loc.status !== 'unique') {
			new Notice(
				loc.status === 'none'
					? 'That text is no longer in the note.'
					: 'That text appears more than once.',
			);
			return;
		}
		this.app.workspace.setActiveLeaf(mv.leaf, { focus: true });
		const from = mv.editor.offsetToPos(loc.range.from);
		const to = mv.editor.offsetToPos(loc.range.to);
		mv.editor.setCursor(from);
		mv.editor.scrollIntoView({ from, to }, true);
	}

	/** Outline an issue's mark in the note (null clears). */
	private hover(id: string | null): void {
		if (id === this.hovered) return;
		this.hovered = id;
		const editor = this.editor();
		if (editor) setHoverMark(editor, id);
	}

	private wireHover(card: HTMLElement, id: string): void {
		card.addEventListener('mouseenter', () => this.hover(id));
		card.addEventListener('focusin', () => this.hover(id));
		card.addEventListener('pointerdown', () => this.hover(id));
	}

	/** Scroll the panel to a card and flash it. */
	private focusCard(id: string): void {
		const card = this.body?.querySelector<HTMLElement>(
			`.gramspell-card[data-id="${CSS.escape(id)}"]`,
		);
		if (!card) return;
		card.scrollIntoView({ block: 'center', behavior: 'smooth' });
		card.addClass('is-flash');
		window.setTimeout(() => card.removeClass('is-flash'), 1200);
		this.hover(id);
	}

	/** Issues sorted by position in `text`; unplaceable ones last. */
	private ordered(issues: Issue[], text: string | null): Issue[] {
		return sortByPosition(issues, (i) => {
			if (text === null) return null;
			const loc = locateQuote(text, i.quote);
			return loc.status === 'unique' ? loc.range.from : null;
		});
	}

	/** Push inline marks for the open, visible issues into the note's editor. */
	private updateMarks(check: NoteCheck | null, text: string | null): void {
		const editor = this.editor();
		if (!editor) return;
		if (!check || text === null) {
			setIssueMarks(editor, []);
			return;
		}
		const marks: MarkSpec[] = [];
		for (const issue of check.issues) {
			if (this.status(check, issue.id) !== 'open' || this.hidden.has(issue.kind)) continue;
			const r = markRange(text, issue);
			if (r) marks.push({ id: issue.id, kind: issue.kind, from: r.from, to: r.to });
		}
		setIssueMarks(editor, marks);
		if (this.hovered && !marks.some((m) => m.id === this.hovered)) this.hover(null);
	}

	// ---- rendering ---------------------------------------------------------

	private md(el: HTMLElement, markdown: string): void {
		if (!this.renderScope) return;
		this.pending.push(
			MarkdownRenderer.render(this.app, markdown, el, this.path ?? '', this.renderScope),
		);
	}

	render(): void {
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = this.addChild(new Component());
		const scroller = this.contentEl;
		const samePath = this.renderedPath === this.path;
		const prevTop = samePath ? scroller.scrollTop : 0;
		const prevHeight = samePath ? (this.body?.offsetHeight ?? 0) : 0;
		this.renderedPath = this.path;
		this.pending = [];
		this.applyBtn = null;
		scroller.empty();
		scroller.addClass('gramspell-scroller');
		const root = scroller.createDiv({ cls: 'gramspell' });
		this.body = root;
		// Hold the old height until the async Markdown has rendered, so the scroll position survives.
		if (prevHeight > 0) root.setCssProps({ '--gramspell-hold-height': `${prevHeight}px` });
		const text = this.editor()?.getValue() ?? null;
		this.build(root, text);
		this.updateMarks(this.check(), text);
		scroller.scrollTop = prevTop;
		const pending = this.pending;
		void Promise.allSettled(pending).then(() => {
			if (this.body !== root) return;
			scroller.scrollTop = prevTop;
			root.setCssProps({ '--gramspell-hold-height': '0px' });
		});
	}

	private build(root: HTMLElement, text: string | null): void {
		if (!this.path) {
			root.createDiv({
				cls: 'gramspell-empty',
				text: 'Open a note, then run "Check spelling, grammar & facts".',
			});
			return;
		}
		const check = this.check();
		const name = this.path.split('/').pop() ?? this.path;

		const header = root.createDiv({ cls: 'gramspell-header' });
		header.createDiv({ cls: 'gramspell-title', text: name.replace(/\.md$/, '') });
		const runBtn = header.createEl('button', {
			cls: 'mod-cta',
			text: check?.busy
				? `Checking ${check.done}/${check.total}…`
				: check?.finished
					? 'Check again'
					: 'Check note',
		});
		runBtn.disabled = (check?.busy ?? false) || (check?.scoring ?? false);
		runBtn.addEventListener('click', () => void this.runCheck());

		if (!check) {
			root.createDiv({ cls: 'gramspell-empty', text: 'Not checked yet in this session.' });
			return;
		}
		if (check.busy) {
			const prog = root.createDiv({ cls: 'gramspell-status' });
			prog.setText(
				check.total > 1
					? `Claude is checking the note (${check.done} of ${check.total} requests done)…`
					: 'Claude is checking the note…',
			);
		}
		for (const err of check.errors) root.createDiv({ cls: 'gramspell-error', text: err });

		const status = (id: string): ItemStatus => this.status(check, id);
		const open = check.issues.filter((i) => status(i.id) === 'open');

		// Filter chips with open counts per kind.
		const chips = root.createDiv({ cls: 'gramspell-chips' });
		for (const kind of KIND_ORDER) {
			const n = open.filter((i) => i.kind === kind).length;
			const chip = chips.createEl('button', {
				cls: `gramspell-chip gramspell-chip-${kind}${this.hidden.has(kind) ? ' is-off' : ''}`,
				text: `${KIND_TITLE[kind]} ${n}`,
				attr: { 'aria-pressed': String(!this.hidden.has(kind)), title: 'Show or hide' },
			});
			chip.addEventListener('click', () => {
				if (this.hidden.has(kind)) this.hidden.delete(kind);
				else this.hidden.add(kind);
				this.render();
			});
		}

		const anchorNote = (issue: Issue): string | null => {
			if (text === null) return null;
			const loc = locateQuote(text, issue.quote);
			if (loc.status === 'none') return 'changed — check again';
			if (loc.status === 'multiple') return 'appears more than once';
			return null;
		};

		for (const kind of KIND_ORDER) {
			if (this.hidden.has(kind)) continue;
			const list = this.ordered(
				open.filter((i) => i.kind === kind),
				text,
			);
			if (!list.length) continue;
			const sec = root.createDiv({ cls: 'gramspell-section' });
			const h = sec.createDiv({ cls: 'gramspell-section-head' });
			h.createEl('h4', { text: `${KIND_TITLE[kind]} (${list.length})` });
			const all = list.every((i) => check.items.get(i.id)?.checked);
			const toggleAll = h.createEl('a', {
				cls: 'gramspell-link',
				text: all ? 'Untick all' : 'Tick all',
			});
			toggleAll.addEventListener('click', () => {
				for (const i of list) {
					const st = check.items.get(i.id);
					if (st) st.checked = !all;
				}
				this.render();
			});
			for (const issue of list) this.renderCard(sec, issue, check, anchorNote(issue));
		}

		if (check.finished && open.length === 0 && check.errors.length === 0) {
			root.createDiv({ cls: 'gramspell-empty', text: 'No open issues.' });
		}

		const handled = check.issues.filter((i) => status(i.id) !== 'open');
		if (handled.length) {
			const det = root.createEl('details', { cls: 'gramspell-handled' });
			det.createEl('summary', { text: `Handled (${handled.length})` });
			for (const h of handled) {
				const row = det.createDiv({ cls: 'gramspell-handled-row' });
				row.createSpan({ cls: 'gramspell-tag', text: status(h.id) });
				row.createSpan({ text: ` ${h.quote} → ${h.replacement}` });
			}
		}

		const footer = root.createDiv({ cls: 'gramspell-footer' });
		const apply = footer.createEl('button', { cls: 'mod-cta' });
		this.applyBtn = apply;
		this.updateApplyButton();
		apply.addEventListener('click', () => void this.applySelected());

		const stampRow = footer.createDiv({ cls: 'gramspell-stamp' });
		if (check.stamped) {
			stampRow.setText(`Stamped gramcheck: ${check.stamped}`);
		} else if (check.finished && !check.busy) {
			const b = stampRow.createEl('button', { text: 'Stamp gramcheck' });
			b.addEventListener('click', () => void this.stamp(check));
		}
		if (check.usage.length) {
			const u = footer.createEl('details', { cls: 'gramspell-usage' });
			u.createEl('summary', { text: `Token use (${check.usage.length} requests)` });
			for (const line of check.usage) u.createDiv({ text: line });
		}

		if (this.plugin.settings.checkScores || check.scores) this.renderScores(root, check);
	}

	private renderScores(root: HTMLElement, check: NoteCheck): void {
		const strip = root.createDiv({ cls: 'gramspell-scores' });
		const head = strip.createDiv({ cls: 'gramspell-scores-head' });
		head.createEl('h4', { text: 'Scores' });
		const btn = head.createEl('button', { text: check.scoring ? 'Scoring…' : 'Rescore' });
		btn.disabled = check.scoring || check.busy;
		btn.addEventListener('click', () => void this.rescore());
		if (check.scoresError) strip.createDiv({ cls: 'gramspell-error', text: check.scoresError });
		if (!check.scores) {
			if (!check.scoring && !check.scoresError)
				strip.createDiv({ cls: 'gramspell-status', text: 'Not scored yet.' });
			else if (check.scoring)
				strip.createDiv({ cls: 'gramspell-status', text: 'Claude is scoring the note…' });
			return;
		}
		const rows: Array<[string, keyof Scores]> = [
			['Flow', 'flow'],
			['Clarity', 'clarity'],
			['Reasoning', 'reasoning'],
		];
		for (const [label, key] of rows) {
			const sc = check.scores[key];
			const band = scoreBand(sc.score);
			const row = strip.createDiv({ cls: `gramspell-score band-${band}` });
			const top = row.createDiv({ cls: 'gramspell-score-top' });
			top.createSpan({ cls: 'gramspell-score-label', text: label });
			top.createSpan({
				cls: 'gramspell-score-value',
				text: `${sc.score}`,
				attr: { title: BAND_LABEL[band] },
			});
			const bar = row.createDiv({ cls: 'gramspell-bar' });
			bar
				.createDiv({ cls: 'gramspell-bar-fill' })
				.setCssProps({ '--gramspell-score': `${sc.score}%` });
			row.createDiv({ cls: 'gramspell-score-reason', text: sc.reason });
		}
	}

	/** Update the Apply button's count without a full re-render (keeps scroll position). */
	private updateApplyButton(): void {
		const check = this.check();
		const btn = this.applyBtn;
		if (!btn || !check) return;
		const ticked = check.issues.filter((i) => {
			const st = check.items.get(i.id);
			return st?.status === 'open' && st.checked && !this.hidden.has(i.kind);
		}).length;
		btn.setText(`Apply selected (${ticked})`);
		btn.disabled = ticked === 0;
	}

	private renderDiff(parent: HTMLElement, issue: Issue): void {
		const box = parent.createDiv({ cls: 'gramspell-diff', attr: { title: 'Jump to this text' } });
		box.addEventListener('click', () => this.jumpTo(issue));
		// Quotes with math render as before/after Markdown so equations display.
		const hasMath = /(^|[^\\])\$/.test(issue.quote);
		if (hasMath) {
			box.addClass('is-blocks');
			this.md(box.createDiv({ cls: 'gramspell-before' }), issue.quote);
			this.md(box.createDiv({ cls: 'gramspell-after' }), issue.replacement);
			return;
		}
		for (const part of wordDiff(issue.quote, issue.replacement)) {
			const cls =
				part.op === 'eq' ? 'gramspell-eq' : part.op === 'del' ? 'gramspell-del' : 'gramspell-ins';
			box.createSpan({ cls, text: part.text });
		}
	}

	private renderCard(
		parent: HTMLElement,
		issue: Issue,
		check: NoteCheck,
		anchor: string | null,
	): void {
		const st = check.items.get(issue.id);
		if (!st) return;
		const card = parent.createDiv({
			cls: `gramspell-card gramspell-card-${issue.kind}`,
			attr: { 'data-id': issue.id },
		});
		this.wireHover(card, issue.id);

		const head = card.createDiv({ cls: 'gramspell-card-head' });
		const tick = head.createEl('label', { cls: 'gramspell-tick' });
		const cb = tick.createEl('input', { type: 'checkbox' });
		cb.checked = st.checked;
		cb.disabled = anchor !== null;
		tick.appendText(' Fix');
		cb.addEventListener('change', () => {
			st.checked = cb.checked;
			this.updateApplyButton();
		});
		if (issue.kind === 'grammar' && issue.category)
			head.createSpan({ cls: 'gramspell-tag', text: issue.category });
		if (issue.kind === 'fact')
			head.createSpan({
				cls: `gramspell-tag conf-${issue.confidence.toLowerCase()}`,
				text: `${issue.confidence === 'High' ? 'High' : 'Medium'} confidence`,
			});
		if (anchor) head.createSpan({ cls: 'gramspell-tag is-warn', text: anchor });

		this.renderDiff(card, issue);
		if (issue.explanation) this.md(card.createDiv({ cls: 'gramspell-explain' }), issue.explanation);
		if (issue.kind === 'fact' && issue.sourceUrl) {
			const src = card.createDiv({ cls: 'gramspell-source' });
			src.appendText('Source: ');
			src.createEl('a', {
				text: issue.sourceTitle || issue.sourceUrl,
				href: issue.sourceUrl,
				attr: { target: '_blank', rel: 'noopener' },
			});
		}

		const actions = card.createDiv({ cls: 'gramspell-actions' });
		const ignoreBtn = actions.createEl('button', { text: 'Ignore' });
		ignoreBtn.addEventListener('click', () => void this.ignore(issue));
		if (issue.kind === 'spelling') {
			const word = flaggedWord(issue);
			if (word) {
				const add = actions.createEl('button', { text: 'Add to dictionary' });
				add.setAttr('title', `Add "${word}" to ${this.plugin.settings.dictionaryPath}`);
				add.addEventListener('click', () => void this.addWord(issue));
			}
		}
		if (st.message) card.createDiv({ cls: 'gramspell-error', text: st.message });
	}
}

import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { issueMarksExtension } from './cm-marks';
import { DEFAULT_SETTINGS, GramspellSettingTab, type GramspellSettings } from './settings';
import { GramspellView, VIEW_TYPE_GRAMSPELL, type NoteCheck } from './view';

export default class GramspellPlugin extends Plugin {
	settings: GramspellSettings = { ...DEFAULT_SETTINGS, ignored: {} };
	/** Check state per note path, kept for the session. */
	readonly checks = new Map<string, NoteCheck>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyColors();
		this.registerEditorExtension(issueMarksExtension);
		this.registerView(VIEW_TYPE_GRAMSPELL, (leaf) => new GramspellView(leaf, this));
		this.addRibbonIcon(
			'spell-check',
			'Check spelling, grammar & facts',
			() => void this.checkActiveNote(),
		);
		this.addCommand({
			id: 'check-current-note',
			name: 'Check spelling, grammar & facts',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) void this.checkActiveNote();
				return true;
			},
		});
		this.addCommand({
			id: 'open-pane',
			name: 'Open pane',
			callback: () => void this.revealView(),
		});
		this.addSettingTab(new GramspellSettingTab(this.app, this));
	}

	onunload(): void {
		this.checks.clear();
		// The colour variables live on the main window's body; popout windows fall back to the CSS defaults.
		// eslint-disable-next-line obsidianmd/prefer-active-doc -- deliberate: main window only
		document.body.setCssProps({
			'--gramspell-spelling': '',
			'--gramspell-grammar': '',
			'--gramspell-fact': '',
		});
	}

	/** Expose the highlight colours as CSS variables used by styles.css. */
	applyColors(): void {
		const s = this.settings;
		// The colour variables live on the main window's body; popout windows fall back to the CSS defaults.
		// eslint-disable-next-line obsidianmd/prefer-active-doc -- deliberate: main window only
		document.body.setCssProps({
			'--gramspell-spelling': s.colorSpelling,
			'--gramspell-grammar': s.colorGrammar,
			'--gramspell-fact': s.colorFact,
		});
	}

	private async revealView(): Promise<GramspellView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_GRAMSPELL)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_GRAMSPELL, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof GramspellView ? leaf.view : null;
	}

	private async checkActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) {
			new Notice('Open a Markdown note first.');
			return;
		}
		const view = await this.revealView();
		if (view) await view.startCheck(file.path);
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<GramspellSettings>;
		this.settings = {
			...DEFAULT_SETTINGS,
			...data,
			blockedDomains: [...(data.blockedDomains ?? DEFAULT_SETTINGS.blockedDomains)],
			ignored: { ...(data.ignored ?? {}) },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/**
 * Inline marks in the editor for open issues, plus an outline on the issue
 * under the pointer in the panel.
 *
 * This is the only module that touches Obsidian's undocumented `editor.cm`
 * (the CodeMirror 6 EditorView behind a MarkdownView), so an API change is a
 * one-file fix. Targeted against Obsidian 1.14.4 (@codemirror/view 6.43.13).
 */
import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Editor } from 'obsidian';
import type { IssueKind, TextRange } from './core/types';

export interface MarkSpec extends TextRange {
	id: string;
	kind: IssueKind;
}

interface MarkState {
	marks: MarkSpec[];
	hover: string | null;
}

const setMarks = StateEffect.define<MarkSpec[]>();
const setHover = StateEffect.define<string | null>();

const CLASS: Record<IssueKind, string> = {
	spelling: 'gramspell-mark-spelling',
	grammar: 'gramspell-mark-grammar',
	fact: 'gramspell-mark-fact',
	forbidden: 'gramspell-mark-forbidden',
};

function build(state: MarkState, docLength: number): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	for (const m of state.marks) {
		const from = Math.max(0, Math.min(m.from, docLength));
		const to = Math.max(from, Math.min(m.to, docLength));
		if (to === from) continue;
		const cls = `gramspell-mark ${CLASS[m.kind]}${m.id === state.hover ? ' is-hover' : ''}`;
		ranges.push(
			Decoration.mark({ class: cls, attributes: { 'data-gramspell-id': m.id } }).range(from, to),
		);
	}
	return Decoration.set(ranges, true);
}

const markField = StateField.define<{ state: MarkState; deco: DecorationSet }>({
	create: () => ({ state: { marks: [], hover: null }, deco: Decoration.none }),
	update(value, tr) {
		let { state } = value;
		let deco = value.deco.map(tr.changes);
		let rebuild = false;
		if (tr.docChanged) {
			// Keep the stored ranges in step with edits so hover rebuilds stay in place.
			state = {
				...state,
				marks: state.marks.map((m) => ({
					...m,
					from: tr.changes.mapPos(m.from, 1),
					to: tr.changes.mapPos(m.to, -1),
				})),
			};
		}
		for (const e of tr.effects) {
			if (e.is(setMarks)) {
				state = { ...state, marks: e.value };
				rebuild = true;
			}
			if (e.is(setHover)) {
				state = { ...state, hover: e.value };
				rebuild = true;
			}
		}
		if (rebuild) deco = build(state, tr.state.doc.length);
		return { state, deco };
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Register once via plugin.registerEditorExtension. */
export const issueMarksExtension: Extension = markField;

function viewOf(editor: Editor): EditorView | null {
	const cm = (editor as unknown as { cm?: unknown }).cm;
	return cm instanceof EditorView ? cm : null;
}

/** Replace all marks in this editor (an empty list clears them). */
export function setIssueMarks(editor: Editor, marks: MarkSpec[]): void {
	viewOf(editor)?.dispatch({ effects: setMarks.of(marks) });
}

/** Outline the mark with this id (null clears the outline). */
export function setHoverMark(editor: Editor, id: string | null): void {
	viewOf(editor)?.dispatch({ effects: setHover.of(id) });
}

/** The issue id of the mark under a DOM event target in the editor, if any. */
export function markIdAt(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	return target.closest('[data-gramspell-id]')?.getAttribute('data-gramspell-id') ?? null;
}

/** The editor's scrolling element (for matching scroll events), if it is a CodeMirror editor. */
export function editorScroller(editor: Editor): HTMLElement | null {
	return viewOf(editor)?.scrollDOM ?? null;
}

/** Document offset of the first character visible at the top of the editor. */
export function topVisibleOffset(editor: Editor): number | null {
	const view = viewOf(editor);
	if (!view) return null;
	const rect = view.scrollDOM.getBoundingClientRect();
	const block = view.lineBlockAtHeight(rect.top - view.documentTop + 4);
	return block.from;
}

/** Scroll the editor so the line holding `pos` sits near the top, without moving the cursor. */
export function scrollOffsetToTop(editor: Editor, pos: number): void {
	const view = viewOf(editor);
	if (!view) return;
	const at = Math.max(0, Math.min(pos, view.state.doc.length));
	view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 24 }) });
}

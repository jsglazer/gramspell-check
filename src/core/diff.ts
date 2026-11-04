import type { TextRange } from './types';

export type DiffOp = 'eq' | 'del' | 'ins';

export interface DiffPart {
	op: DiffOp;
	text: string;
}

/** Split into words, whitespace runs and single punctuation characters. */
export function tokenize(s: string): string[] {
	return s.match(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu) ?? [];
}

/** Largest token-grid size diffed with LCS; larger inputs fall back to delete-all/insert-all. */
const MAX_GRID = 40000;

function push(parts: DiffPart[], op: DiffOp, text: string): void {
	if (!text) return;
	const last = parts[parts.length - 1];
	if (last && last.op === op) last.text += text;
	else parts.push({ op, text });
}

/**
 * Word-level diff of `before` → `after`. Joining the `eq` and `del` parts gives
 * `before`; joining the `eq` and `ins` parts gives `after`.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
	const a = tokenize(before);
	const b = tokenize(after);
	const parts: DiffPart[] = [];
	if (a.length * b.length > MAX_GRID) {
		push(parts, 'del', before);
		push(parts, 'ins', after);
		return parts;
	}
	// lcs[i][j] = LCS length of a[i..] and b[j..]
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	let i = 0;
	let j = 0;
	// Collect a run of deletions and insertions, then emit dels before ins.
	let del = '';
	let ins = '';
	const flush = (): void => {
		push(parts, 'del', del);
		push(parts, 'ins', ins);
		del = '';
		ins = '';
	};
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			flush();
			push(parts, 'eq', a[i]);
			i++;
			j++;
		} else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
			ins += b[j++];
		} else {
			del += a[i++];
		}
	}
	flush();
	return parts;
}

/** The smallest edit turning `before` into `after`: replace before[start, end) with `insert`. */
export interface MinimalChange {
	start: number;
	end: number;
	insert: string;
}

/** Character-level common prefix/suffix trim. Returns null when the strings are equal. */
export function minimalChange(before: string, after: string): MinimalChange | null {
	if (before === after) return null;
	let p = 0;
	const max = Math.min(before.length, after.length);
	while (p < max && before[p] === after[p]) p++;
	let s = 0;
	while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
	return { start: p, end: before.length - s, insert: after.slice(p, after.length - s) };
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’]/u;

/**
 * The span to mark in the editor for a change inside `text`: the changed range
 * widened to whole words, and, for a pure insertion, the word just before it
 * (or after it, at the start). Offsets are relative to `text`.
 */
export function markSpan(text: string, change: TextRange): TextRange {
	let from = change.from;
	let to = change.to;
	if (from === to) {
		// Pure insertion: mark the neighbouring word.
		let a = from;
		while (a > 0 && /\s/.test(text[a - 1])) a--;
		if (a > 0) {
			to = a;
			from = a - 1;
		} else {
			let b = from;
			while (b < text.length && /\s/.test(text[b])) b++;
			from = b;
			to = Math.min(b + 1, text.length);
		}
	}
	while (from > 0 && WORD_CHAR.test(text[from - 1]) && WORD_CHAR.test(text[from] ?? ' ')) from--;
	while (to < text.length && WORD_CHAR.test(text[to]) && WORD_CHAR.test(text[to - 1] ?? ' ')) to++;
	if (to <= from) to = Math.min(from + 1, text.length);
	return { from, to };
}

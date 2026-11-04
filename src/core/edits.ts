import { locateQuote } from './anchor';
import { markSpan, minimalChange } from './diff';
import { isProtected, overlaps, protectedRanges } from './protect';
import type { Issue, TextRange } from './types';

/** A fix to validate: replace `quote` with `replacement`. */
export interface Fix {
	id: string;
	quote: string;
	replacement: string;
}

/** A validated edit with concrete offsets in the text it was planned against. */
export interface ResolvedEdit {
	id: string;
	range: TextRange;
	replace: string;
}

export interface Rejection {
	id: string;
	reason: string;
}

export interface EditPlan {
	/** Sorted by descending `range.from`, ready to apply without offset drift. */
	edits: ResolvedEdit[];
	applied: string[];
	rejected: Rejection[];
}

export type Resolution =
	{ ok: true; edit: ResolvedEdit; quoteRange: TextRange } | { ok: false; reason: string };

/**
 * Locate a fix in `text` and narrow it to the smallest changed span inside its
 * quote. Does not check protection or overlap.
 */
export function resolveFix(text: string, fix: Fix): Resolution {
	const loc = locateQuote(text, fix.quote);
	if (loc.status === 'none') return { ok: false, reason: 'The text is no longer in the note.' };
	if (loc.status === 'multiple')
		return { ok: false, reason: `The text appears ${loc.count} times in the note.` };
	const change = minimalChange(fix.quote, fix.replacement);
	if (!change) return { ok: false, reason: 'The proposed fix makes no change.' };
	// A whitespace-collapsed match can differ from the quote in whitespace only:
	// map the change's quote offsets onto the note's actual text.
	const actual = text.slice(loc.range.from, loc.range.to);
	const map = loc.fuzzy ? whitespaceMap(fix.quote, actual) : null;
	const at = (i: number): number => loc.range.from + (map ? map[i] : i);
	return {
		ok: true,
		quoteRange: loc.range,
		edit: {
			id: fix.id,
			range: { from: at(change.start), to: at(change.end) },
			replace: change.insert,
		},
	};
}

/**
 * Offset map from `quote` to `actual`, two strings equal up to whitespace runs
 * (and leading/trailing whitespace on the quote). map[i] is the offset in
 * `actual` for offset i in `quote`.
 */
export function whitespaceMap(quote: string, actual: string): number[] {
	const map = new Array<number>(quote.length + 1).fill(0);
	let i = 0;
	let k = 0;
	const ws = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
	while (i < quote.length) {
		if (ws(quote[i])) {
			const qs = i;
			while (i < quote.length && ws(quote[i])) i++;
			const ks = k;
			while (k < actual.length && ws(actual[k])) k++;
			for (let x = qs; x < i; x++) map[x] = x === qs ? ks : k;
		} else {
			map[i] = k;
			i++;
			if (k < actual.length) k++;
		}
	}
	map[quote.length] = k;
	return map;
}

function clashes(a: TextRange, b: TextRange): boolean {
	if (a.from === a.to && b.from === b.to) return a.from === b.from;
	return overlaps(a, b) || (a.from === a.to && a.from === b.from && b.to > b.from);
}

/**
 * Validate fixes against the current text, in order. A fix is rejected if its
 * quote is missing or ambiguous, its changed span touches a protected region, or
 * it overlaps a fix accepted earlier in the list.
 */
export function planFixes(text: string, fixes: Fix[]): EditPlan {
	const guard = protectedRanges(text);
	const accepted: ResolvedEdit[] = [];
	const applied: string[] = [];
	const rejected: Rejection[] = [];
	for (const fix of fixes) {
		const res = resolveFix(text, fix);
		if (!res.ok) {
			rejected.push({ id: fix.id, reason: res.reason });
			continue;
		}
		if (isProtected(res.edit.range, guard)) {
			rejected.push({
				id: fix.id,
				reason:
					'The change touches protected text (code, math, a link target, frontmatter, a JE: line, or below DO NOT EDIT).',
			});
			continue;
		}
		if (
			accepted.some((a) => clashes(res.edit.range, a.range) || clashes(a.range, res.edit.range))
		) {
			rejected.push({ id: fix.id, reason: 'The change overlaps another selected fix.' });
			continue;
		}
		accepted.push(res.edit);
		applied.push(fix.id);
	}
	accepted.sort((a, b) => b.range.from - a.range.from);
	return { edits: accepted, applied, rejected };
}

/** Apply resolved edits (descending order) to text. Pure. */
export function applyPlan(text: string, edits: ResolvedEdit[]): string {
	let out = text;
	const ordered = [...edits].sort((a, b) => b.range.from - a.range.from);
	for (const e of ordered) out = out.slice(0, e.range.from) + e.replace + out.slice(e.range.to);
	return out;
}

/**
 * Where to draw an issue's inline mark in `text`: facts mark the whole quote;
 * spelling and grammar mark the changed words. Null when it can't be placed.
 */
export function markRange(text: string, issue: Issue): TextRange | null {
	const res = resolveFix(text, issue);
	if (!res.ok) return null;
	if (issue.kind === 'fact') return res.quoteRange;
	const q = res.quoteRange;
	const quoteText = text.slice(q.from, q.to);
	const local = markSpan(quoteText, {
		from: res.edit.range.from - q.from,
		to: res.edit.range.to - q.from,
	});
	return { from: q.from + local.from, to: q.from + local.to };
}

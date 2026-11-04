import type { TextRange } from './types';

/**
 * Result of locating a quoted string in the note.
 * - unique: exactly one match (exact, or whitespace-collapsed when no exact match exists)
 * - none: no match at all
 * - multiple: more than one match, so the target is ambiguous
 */
export type AnchorResult =
	| { status: 'unique'; range: TextRange; fuzzy: boolean }
	| { status: 'none' }
	| { status: 'multiple'; count: number };

function findAll(haystack: string, needle: string): number[] {
	const hits: number[] = [];
	if (needle.length === 0) return hits;
	let i = haystack.indexOf(needle);
	while (i !== -1) {
		hits.push(i);
		i = haystack.indexOf(needle, i + 1);
	}
	return hits;
}

interface Collapsed {
	text: string;
	/** origStart[k] = index in the original text of collapsed char k. */
	origStart: number[];
	/** origEnd[k] = index just past the original span that produced collapsed char k. */
	origEnd: number[];
}

/** Collapse every whitespace run to a single space, keeping a map back to the original. */
export function collapseWhitespace(src: string): Collapsed {
	let text = '';
	const origStart: number[] = [];
	const origEnd: number[] = [];
	let i = 0;
	while (i < src.length) {
		if (/\s/.test(src[i])) {
			const start = i;
			while (i < src.length && /\s/.test(src[i])) i++;
			text += ' ';
			origStart.push(start);
			origEnd.push(i);
		} else {
			text += src[i];
			origStart.push(i);
			origEnd.push(i + 1);
			i++;
		}
	}
	return { text, origStart, origEnd };
}

/**
 * Locate `quote` in `text`. Exact matching first; if there is no exact match, a
 * whitespace-collapsed match is accepted only when it is unique.
 */
export function locateQuote(text: string, quote: string): AnchorResult {
	if (quote.length === 0) return { status: 'none' };
	const exact = findAll(text, quote);
	if (exact.length === 1) {
		return {
			status: 'unique',
			range: { from: exact[0], to: exact[0] + quote.length },
			fuzzy: false,
		};
	}
	if (exact.length > 1) return { status: 'multiple', count: exact.length };

	const needle = collapseWhitespace(quote).text.trim();
	if (needle.length === 0) return { status: 'none' };
	const hay = collapseWhitespace(text);
	const hits = findAll(hay.text, needle);
	if (hits.length === 0) return { status: 'none' };
	if (hits.length > 1) return { status: 'multiple', count: hits.length };
	const k = hits[0];
	const from = hay.origStart[k];
	const to = hay.origEnd[k + needle.length - 1];
	return { status: 'unique', range: { from, to }, fuzzy: true };
}

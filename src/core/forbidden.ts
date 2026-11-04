import { locateQuote } from './anchor';
import { frontmatterRange, isProtected, protectedRanges } from './protect';
import type { RawIssue, TextRange } from './types';

/** One forbidden word or phrase, with an optional fixed replacement. */
export interface ForbiddenEntry {
	term: string;
	replacement: string | null;
}

/**
 * Parse the settings list: one entry per line, `term` or `term => replacement`
 * (`→` also works). Blank lines and lines starting with `#` or `//` are skipped;
 * duplicate terms (case-insensitive) keep the first entry.
 */
export function parseForbidden(lines: string[]): ForbiddenEntry[] {
	const out: ForbiddenEntry[] = [];
	const seen = new Set<string>();
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith('//')) continue;
		const m = /^(.*?)\s*(?:=>|→)\s*(.*)$/.exec(line);
		const term = (m ? m[1] : line).trim();
		const replacement = m ? m[2].trim() : null;
		if (!term || seen.has(term.toLowerCase())) continue;
		seen.add(term.toLowerCase());
		out.push({ term, replacement: replacement === null ? null : replacement });
	}
	return out;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matcher for a term (inner whitespace matches any run). */
export function termRegex(term: string): RegExp {
	const body = term.trim().split(/\s+/).map(escapeRegex).join('\\s+');
	return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${body}(?![\\p{L}\\p{N}\\p{M}_])`, 'giu');
}

/** Give `replacement` the capitalisation pattern of `original` (ALL CAPS or Initial cap). */
export function matchCase(original: string, replacement: string): string {
	if (!replacement) return replacement;
	const letters = original.replace(/[^\p{L}]/gu, '');
	if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
	if (
		original[0] &&
		original[0] === original[0].toUpperCase() &&
		original[0] !== original[0].toLowerCase()
	)
		return replacement[0].toUpperCase() + replacement.slice(1);
	return replacement;
}

/**
 * The shortest quote around `range` that occurs only once in `text`, growing a
 * word at a time on each side but never past the line. Falls back to the whole
 * line when nothing shorter is unique.
 */
export function uniqueQuote(text: string, range: TextRange): TextRange {
	const lineStart = range.from === 0 ? 0 : text.lastIndexOf('\n', range.from - 1) + 1;
	const nl = text.indexOf('\n', range.to);
	const lineEnd = nl === -1 ? text.length : nl;
	let from = range.from;
	let to = range.to;
	const unique = (): boolean => locateQuote(text, text.slice(from, to)).status === 'unique';
	const growLeft = (): void => {
		let a = from;
		while (a > lineStart && /\s/.test(text[a - 1])) a--;
		while (a > lineStart && !/\s/.test(text[a - 1])) a--;
		from = a;
	};
	const growRight = (): void => {
		let b = to;
		while (b < lineEnd && /\s/.test(text[b])) b++;
		while (b < lineEnd && !/\s/.test(text[b])) b++;
		to = b;
	};
	while (!unique() && (from > lineStart || to < lineEnd)) {
		growLeft();
		if (unique()) break;
		growRight();
	}
	return { from, to };
}

/**
 * Every occurrence of a forbidden term that has a fixed replacement, outside
 * frontmatter and protected Markdown, as ready-to-apply issues. Terms without
 * a replacement are left to the model, which suggests a rewording in context.
 */
export function findForbidden(text: string, entries: ForbiddenEntry[]): RawIssue[] {
	const guard = protectedRanges(text);
	const fm = frontmatterRange(text);
	const hits: Array<{ range: TextRange; entry: ForbiddenEntry; matched: string }> = [];
	for (const entry of entries) {
		if (entry.replacement === null) continue;
		for (const m of text.matchAll(termRegex(entry.term))) {
			if (m.index === undefined) continue;
			const range = { from: m.index, to: m.index + m[0].length };
			if (fm && range.from < fm.to) continue;
			if (isProtected(range, guard)) continue;
			// Longer terms listed earlier win over a shorter term inside them.
			if (hits.some((h) => h.range.from < range.to && range.from < h.range.to)) continue;
			hits.push({ range, entry, matched: m[0] });
		}
	}
	hits.sort((a, b) => a.range.from - b.range.from);
	return hits.map(({ range, entry, matched }) => {
		const q = uniqueQuote(text, range);
		if (entry.replacement === '') {
			// A deletion needs its neighbouring space (and the next word, for capitals) inside the quote.
			const lineEnd = text.indexOf('\n', q.to) === -1 ? text.length : text.indexOf('\n', q.to);
			let b = q.to;
			while (b < lineEnd && text[b] === ' ') b++;
			if (b > q.to) {
				while (b < lineEnd && !/\s/.test(text[b])) b++;
				q.to = b;
			} else {
				while (q.from > 0 && text[q.from - 1] === ' ') q.from--;
			}
		}
		const quote = text.slice(q.from, q.to);
		const replaced = matchCase(matched, entry.replacement ?? '');
		const offset = range.from - q.from;
		let before = quote.slice(0, offset);
		let after = quote.slice(offset + matched.length);
		// Deleting a term ("term =>") also drops one neighbouring space.
		if (replaced === '') {
			if (after.startsWith(' ')) after = after.slice(1);
			else if (before.endsWith(' ')) before = before.slice(0, -1);
			// A deleted capitalised word passes its capital to the next word ("Very good" → "Good").
			if (/^\p{Lu}/u.test(matched) && /^\p{Ll}/u.test(after))
				after = after[0].toUpperCase() + after.slice(1);
		}
		const replacement = before + replaced + after;
		return {
			kind: 'forbidden',
			quote,
			replacement,
			explanation: entry.replacement
				? `"${entry.term}" is on your forbidden list; replace it with "${entry.replacement}".`
				: `"${entry.term}" is on your forbidden list.`,
			category: entry.term,
			confidence: 'High',
			sourceUrl: '',
			sourceTitle: '',
		};
	});
}

import { minimalChange } from './diff';
import { frontmatterRange } from './protect';
import type { RawIssue } from './types';

/** Normalise a word for dictionary lookup. */
export function normWord(w: string): string {
	return w.trim().replace(/[’]/g, "'").replace(/'s$/i, '').toLowerCase();
}

/**
 * Words from the dictionary note: one per line; list markers, wiki brackets
 * and backticks are stripped; blank lines, headings, comments (`%%`, `//`) and
 * frontmatter are skipped.
 */
export function parseDictionary(text: string): Set<string> {
	const fm = frontmatterRange(text);
	const body = fm ? text.slice(fm.to) : text;
	const words = new Set<string>();
	for (const raw of body.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith('%%') || line.startsWith('//')) continue;
		const w = line
			.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
			.replace(/^\[\[|\]\]$/g, '')
			.replace(/^`|`$/g, '');
		const n = normWord(w);
		if (n) words.add(n);
	}
	return words;
}

/** The note text after adding `word` (no change if it is already there). */
export function addToDictionary(text: string, word: string): string {
	const w = word.trim();
	if (!w || parseDictionary(text).has(normWord(w))) return text;
	const sep = text === '' || text.endsWith('\n') ? '' : '\n';
	return `${text}${sep}${w}\n`;
}

/** The original word a spelling fix changes (the changed span widened to whole words). */
export function flaggedWord(issue: Pick<RawIssue, 'quote' | 'replacement'>): string {
	const ch = minimalChange(issue.quote, issue.replacement);
	if (!ch) return '';
	const isWord = (c: string | undefined): boolean =>
		c !== undefined && /[\p{L}\p{N}\p{M}'’-]/u.test(c);
	let a = ch.start;
	let b = ch.end;
	while (a > 0 && isWord(issue.quote[a - 1])) a--;
	while (b < issue.quote.length && isWord(issue.quote[b])) b++;
	return issue.quote.slice(a, b).trim();
}

/** Drop spelling issues whose flagged word is in the dictionary. */
export function filterByDictionary<T extends Pick<RawIssue, 'kind' | 'quote' | 'replacement'>>(
	issues: T[],
	dict: Set<string>,
): T[] {
	if (dict.size === 0) return issues;
	return issues.filter((i) => i.kind !== 'spelling' || !dict.has(normWord(flaggedWord(i))));
}

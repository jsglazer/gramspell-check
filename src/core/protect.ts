import type { TextRange } from './types';

/** Matches a `JE: ` line after optional indentation, callout `>` markers and a list marker. */
const JE_LINE = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?JE: /;

/** Matches a Markdown heading whose text contains DO NOT EDIT (case-insensitive). */
const DO_NOT_EDIT_HEADING = /^#{1,6}[ \t]+.*\bDO NOT EDIT\b/i;

/** Opening or closing line of a fenced code block. */
const FENCE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/;

export function isJeLine(line: string): boolean {
	return JE_LINE.test(line);
}

/** Split text into lines with their start offsets (line text excludes the newline). */
export function lineSpans(text: string): Array<{ start: number; end: number; line: string }> {
	const out: Array<{ start: number; end: number; line: string }> = [];
	let start = 0;
	while (start <= text.length) {
		const nl = text.indexOf('\n', start);
		const end = nl === -1 ? text.length : nl;
		out.push({ start, end, line: text.slice(start, end) });
		if (nl === -1) break;
		start = nl + 1;
	}
	return out;
}

/** Range of the YAML frontmatter block (including both `---` fences), or null. */
export function frontmatterRange(text: string): TextRange | null {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
	const lines = lineSpans(text);
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].line.replace(/\r$/, '') === '---') {
			const to = i + 1 < lines.length ? lines[i + 1].start : text.length;
			return { from: 0, to };
		}
	}
	return null;
}

/**
 * Math spans (`$...$` and `$$...$$`) in `text`, ignoring escaped `\$`.
 * An opening delimiter with no closing partner produces no span.
 */
export function mathSpans(text: string): TextRange[] {
	const spans: TextRange[] = [];
	const isDollar = (i: number): boolean => text[i] === '$' && (i === 0 || text[i - 1] !== '\\');
	let i = 0;
	while (i < text.length) {
		if (!isDollar(i)) {
			i++;
			continue;
		}
		const block = text[i + 1] === '$';
		const open = block ? 2 : 1;
		let j = i + open;
		let close = -1;
		while (j < text.length) {
			if (isDollar(j) && (!block || text[j + 1] === '$')) {
				close = j;
				break;
			}
			// Inline math never spans a blank line.
			if (!block && text[j] === '\n' && text[j + 1] === '\n') break;
			j++;
		}
		if (close === -1) {
			i += open;
			continue;
		}
		const end = close + open;
		spans.push({ from: i, to: end });
		i = end;
	}
	return spans;
}

function regexRanges(text: string, re: RegExp, group?: number): TextRange[] {
	const out: TextRange[] = [];
	for (const m of text.matchAll(re)) {
		if (m.index === undefined) continue;
		if (group === undefined) {
			out.push({ from: m.index, to: m.index + m[0].length });
		} else if (m[group] !== undefined) {
			const offset = m[0].indexOf(m[group]);
			out.push({ from: m.index + offset, to: m.index + offset + m[group].length });
		}
	}
	return out;
}

/** Fenced code blocks, including their fence lines; an unclosed fence runs to the end. */
export function codeFenceRanges(text: string): TextRange[] {
	const out: TextRange[] = [];
	let open: { start: number; marker: string } | null = null;
	for (const span of lineSpans(text)) {
		const m = FENCE.exec(span.line);
		if (!m) continue;
		if (!open) {
			open = { start: span.start, marker: m[1] };
		} else if (m[1][0] === open.marker[0] && m[1].length >= open.marker.length) {
			out.push({ from: open.start, to: span.end });
			open = null;
		}
	}
	if (open) out.push({ from: open.start, to: text.length });
	return out;
}

/**
 * Inline syntax that must never change, inside otherwise checkable prose:
 * inline code, math, URLs, link and embed targets, HTML tags, footnote keys,
 * tags, block ids and `%%` comments.
 */
export function inlineProtectedRanges(text: string): TextRange[] {
	return [
		...regexRanges(text, /(`+)[^`\n][\s\S]*?\1/g),
		...mathSpans(text),
		...regexRanges(text, /%%[\s\S]*?%%/g),
		// [[target]] and ![[target]]: the whole link (its visible text is the target).
		...regexRanges(text, /!?\[\[[^\]|\n]*\]\]/g),
		// [[target|alias]]: only "[[target|" is protected; the alias is prose.
		...regexRanges(text, /!?\[\[[^\]|\n]*\|/g),
		// [text](url) and ![alt](url): the "(url)" part.
		...regexRanges(text, /\]\(([^)\s]*(?:\s+"[^"]*")?)\)/g, 0).map((r) => ({
			from: r.from + 1,
			to: r.to,
		})),
		...regexRanges(text, /<https?:\/\/[^>\s]+>|https?:\/\/[^\s)<>\]]+/g),
		...regexRanges(text, /<\/?[A-Za-z][^>\n]*>/g),
		...regexRanges(text, /\[\^[^\]\s]+\]/g),
		...regexRanges(text, /(?:^|[\s(])(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu, 1),
		...regexRanges(text, /\s(\^[A-Za-z0-9-]+)$/gm, 1),
	];
}

/**
 * Regions the plugin must never edit: frontmatter, code blocks, inline syntax,
 * every `JE: ` line, and everything from a `DO NOT EDIT` heading to the end.
 */
export function protectedRanges(text: string): TextRange[] {
	const ranges: TextRange[] = [];
	// Line-based regions start one character early (on the preceding newline, or at -1 for the
	// first line) so a pure insertion at the very start of the region also counts as inside it.
	const early = (r: TextRange): TextRange => ({ from: r.from - 1, to: r.to });
	const fm = frontmatterRange(text);
	if (fm) ranges.push(early(fm));
	const fences = codeFenceRanges(text);
	ranges.push(...fences.map(early));
	const inFence = (pos: number): boolean => fences.some((f) => pos >= f.from && pos < f.to);
	for (const span of lineSpans(text)) {
		if (fm && span.start < fm.to) continue;
		if (inFence(span.start)) continue;
		if (DO_NOT_EDIT_HEADING.test(span.line)) {
			ranges.push(early({ from: span.start, to: text.length }));
			break;
		}
		if (isJeLine(span.line)) ranges.push(early({ from: span.start, to: span.end }));
	}
	ranges.push(...inlineProtectedRanges(text));
	return ranges.sort((a, b) => a.from - b.from);
}

export function overlaps(a: TextRange, b: TextRange): boolean {
	// Zero-length ranges (pure insertions) count when they sit strictly inside b.
	if (a.from === a.to) return a.from > b.from && a.from < b.to;
	if (b.from === b.to) return b.from > a.from && b.from < a.to;
	return a.from < b.to && b.from < a.to;
}

export function isProtected(range: TextRange, protectedList: TextRange[]): boolean {
	return protectedList.some((p) => overlaps(range, p));
}

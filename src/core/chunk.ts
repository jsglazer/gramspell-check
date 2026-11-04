import { frontmatterRange, lineSpans } from './protect';

export interface Chunk {
	/** Offset of `text` in the full note. */
	from: number;
	text: string;
}

const HEADING = /^#{1,6}[ \t]/;

/**
 * Split the note body (frontmatter excluded) into chunks of at most `maxChars`,
 * cutting at headings where possible, then at blank lines, then at line ends.
 * Every chunk is a contiguous slice of the note; joining them gives the body.
 */
export function chunkNote(text: string, maxChars = 12000): Chunk[] {
	const fm = frontmatterRange(text);
	const bodyFrom = fm ? fm.to : 0;
	if (bodyFrom >= text.length || text.slice(bodyFrom).trim() === '') return [];

	// Candidate cut points (line starts), ranked: 2 = heading, 1 = after a blank line, 0 = any line.
	const cuts: Array<{ at: number; rank: number }> = [];
	let prevBlank = false;
	for (const span of lineSpans(text)) {
		if (span.start <= bodyFrom) {
			prevBlank = span.line.trim() === '';
			continue;
		}
		const rank = HEADING.test(span.line) ? 2 : prevBlank ? 1 : 0;
		cuts.push({ at: span.start, rank });
		prevBlank = span.line.trim() === '';
	}

	const chunks: Chunk[] = [];
	let start = bodyFrom;
	while (text.length - start > maxChars) {
		const limit = start + maxChars;
		const inWindow = cuts.filter((c) => c.at > start && c.at <= limit);
		let cut: number;
		if (inWindow.length === 0) {
			cut = limit; // one enormous line: hard cut
		} else {
			const best = Math.max(...inWindow.map((c) => c.rank));
			// The last cut of the best rank keeps chunks as large as allowed.
			cut = inWindow.filter((c) => c.rank === best).pop()!.at;
		}
		chunks.push({ from: start, text: text.slice(start, cut) });
		start = cut;
	}
	chunks.push({ from: start, text: text.slice(start) });
	return chunks.filter((c) => c.text.trim() !== '');
}

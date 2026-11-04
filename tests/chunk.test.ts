import { describe, expect, it } from 'vitest';
import { chunkNote } from '../src/core/chunk';

describe('chunkNote', () => {
	it('returns one chunk for a short note and excludes frontmatter', () => {
		const text = '---\na: 1\n---\n# Title\nBody.';
		const chunks = chunkNote(text);
		expect(chunks).toEqual([{ from: 13, text: '# Title\nBody.' }]);
		expect(text.slice(chunks[0].from)).toBe(chunks[0].text);
	});

	it('returns no chunks for an empty body', () => {
		expect(chunkNote('---\na: 1\n---\n\n  \n')).toEqual([]);
	});

	it('cuts at headings, keeps chunks under the limit, and covers the whole body', () => {
		const sec = (h: string): string => `## ${h}\n${'word '.repeat(30)}\n\n${'more '.repeat(30)}\n`;
		const text = `---\nx: y\n---\n${sec('A')}${sec('B')}${sec('C')}${sec('D')}`;
		const chunks = chunkNote(text, 400);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			expect(c.text.length).toBeLessThanOrEqual(400);
			expect(text.slice(c.from, c.from + c.text.length)).toBe(c.text);
			expect(c.text.startsWith('## ')).toBe(true);
		}
		expect(chunks.map((c) => c.text).join('')).toBe(text.slice(text.indexOf('## A')));
	});

	it('falls back to blank lines, then hard cuts for one enormous line', () => {
		const para = 'x'.repeat(50);
		const text = `${para}\n\n${para}\n\n${para}`;
		const chunks = chunkNote(text, 60);
		expect(chunks.map((c) => c.text.trim())).toEqual([para, para, para]);
		const long = 'y'.repeat(130);
		const hard = chunkNote(long, 60);
		expect(hard.map((c) => c.text.length)).toEqual([60, 60, 10]);
	});
});

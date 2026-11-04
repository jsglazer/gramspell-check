import { describe, expect, it } from 'vitest';
import { isOutlineLine, stripOutlineLines } from '../src/core/outline';

describe('outline lines', () => {
	it('recognises entries, paragraph-break flags and comments', () => {
		for (const l of [
			'@ Background',
			'@@ Early history',
			'@@@ Deep',
			'@@p While some succeeded',
			'@% note to myself',
		])
			expect(isOutlineLine(l)).toBe(true);
	});
	it('leaves citations, emails and ordinary text alone', () => {
		for (const l of [
			'@smith2020 argues that',
			'[@smith2020, p. 12]',
			'mail me@ex.com',
			'Plain text',
			'@',
		])
			expect(isOutlineLine(l)).toBe(false);
	});
	it('strips entry lines and keeps the body', () => {
		const text =
			'@ Background\nThe body text.\n@@p Next point\n@smith2020 shows this.\n@% hidden\nEnd.';
		expect(stripOutlineLines(text)).toBe('The body text.\n@smith2020 shows this.\nEnd.');
	});
});

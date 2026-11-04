import { describe, expect, it } from 'vitest';
import { markSpan, minimalChange, tokenize, wordDiff, type DiffPart } from '../src/core/diff';

const join = (parts: DiffPart[], ops: string[]): string =>
	parts
		.filter((p) => ops.includes(p.op))
		.map((p) => p.text)
		.join('');

describe('tokenize', () => {
	it('splits words, whitespace and punctuation, keeping contractions together', () => {
		expect(tokenize("It's a test, ok.")).toEqual([
			"It's",
			' ',
			'a',
			' ',
			'test',
			',',
			' ',
			'ok',
			'.',
		]);
	});
});

describe('wordDiff', () => {
	it('returns a single equal part for identical text', () => {
		expect(wordDiff('same text', 'same text')).toEqual([{ op: 'eq', text: 'same text' }]);
	});

	it('marks a replaced word as delete then insert', () => {
		expect(wordDiff('the teh cat', 'the the cat')).toEqual([
			{ op: 'eq', text: 'the ' },
			{ op: 'del', text: 'teh' },
			{ op: 'ins', text: 'the' },
			{ op: 'eq', text: ' cat' },
		]);
	});

	it('handles insertions, deletions and punctuation, and round-trips both sides', () => {
		const cases: Array<[string, string]> = [
			['I went home I slept.', 'I went home; I slept.'],
			['He go to the the store', 'He goes to the store'],
			['Data is', 'Data are, in fact,'],
		];
		for (const [a, b] of cases) {
			const parts = wordDiff(a, b);
			expect(join(parts, ['eq', 'del'])).toBe(a);
			expect(join(parts, ['eq', 'ins'])).toBe(b);
			expect(parts.some((p) => p.op !== 'eq')).toBe(true);
		}
	});
});

describe('minimalChange', () => {
	it('returns null for equal strings', () => {
		expect(minimalChange('abc', 'abc')).toBeNull();
	});
	it('trims the common prefix and suffix', () => {
		expect(minimalChange('the teh cat', 'the the cat')).toEqual({ start: 5, end: 7, insert: 'he' });
	});
	it('describes a pure insertion', () => {
		expect(minimalChange('home I', 'home; I')).toEqual({ start: 4, end: 4, insert: ';' });
	});
	it('describes a pure deletion', () => {
		expect(minimalChange('the the cat', 'the cat')).toEqual({ start: 4, end: 8, insert: '' });
	});
});

describe('markSpan', () => {
	it('widens a partial-word change to the whole word', () => {
		const t = 'the teh cat';
		const r = markSpan(t, { from: 5, to: 7 });
		expect(t.slice(r.from, r.to)).toBe('teh');
	});
	it('marks the word before a pure insertion', () => {
		const t = 'went home I slept';
		const r = markSpan(t, { from: 9, to: 9 });
		expect(t.slice(r.from, r.to)).toBe('home');
	});
	it('marks the following word for an insertion at the start', () => {
		const t = 'teh start';
		const r = markSpan(t, { from: 0, to: 0 });
		expect(t.slice(r.from, r.to)).toBe('teh');
	});
});

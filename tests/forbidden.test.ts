import { describe, expect, it } from 'vitest';
import { applyPlan, planFixes } from '../src/core/edits';
import {
	findForbidden,
	matchCase,
	parseForbidden,
	termRegex,
	uniqueQuote,
} from '../src/core/forbidden';

describe('parseForbidden', () => {
	it('reads terms, replacements (=> or →), deletions, and skips comments and duplicates', () => {
		expect(
			parseForbidden([
				'utilize => use',
				'very =>',
				'# note',
				'',
				'obviously',
				'in order to → to',
				'Utilize => employ',
			]),
		).toEqual([
			{ term: 'utilize', replacement: 'use' },
			{ term: 'very', replacement: '' },
			{ term: 'obviously', replacement: null },
			{ term: 'in order to', replacement: 'to' },
		]);
	});
});

describe('termRegex / matchCase', () => {
	it('matches whole words case-insensitively, with flexible inner whitespace', () => {
		const re = termRegex('in order to');
		expect('We left In order\nto win.'.match(re)).toEqual(['In order\nto']);
		expect('veryfine very'.match(termRegex('very'))).toEqual(['very']);
	});
	it('keeps the original capitalisation pattern', () => {
		expect(matchCase('Utilize', 'use')).toBe('Use');
		expect(matchCase('UTILIZE', 'use')).toBe('USE');
		expect(matchCase('utilize', 'use')).toBe('use');
	});
});

describe('uniqueQuote', () => {
	it('grows a repeated word until the quote is unique within its line', () => {
		const text = 'We utilize tools. They utilize more.';
		const at = text.indexOf('utilize', 10);
		const q = uniqueQuote(text, { from: at, to: at + 7 });
		const quote = text.slice(q.from, q.to);
		expect(quote).toContain('utilize');
		expect(text.split(quote).length - 1).toBe(1);
	});
});

describe('findForbidden', () => {
	it('finds every use with a fixed replacement and the fixes apply cleanly', () => {
		const text =
			'---\nnote: utilize\n---\nWe utilize tools. Very good. They utilize `utilize` and [[utilize]].';
		const entries = parseForbidden(['utilize => use', 'very =>', 'obviously']);
		const issues = findForbidden(text, entries);
		// Frontmatter, inline code and the wikilink target are skipped; "obviously" is left to Claude.
		expect(issues.map((i) => i.category)).toEqual(['utilize', 'very', 'utilize']);
		const plan = planFixes(
			text,
			issues.map((i, n) => ({ id: String(n), quote: i.quote, replacement: i.replacement })),
		);
		expect(plan.rejected).toEqual([]);
		expect(applyPlan(text, plan.edits)).toBe(
			'---\nnote: utilize\n---\nWe use tools. Good. They use `utilize` and [[utilize]].',
		);
	});
	it('prefers a longer listed phrase over a shorter term inside it', () => {
		const issues = findForbidden(
			'Do it in order to win.',
			parseForbidden(['in order to => to', 'order => sequence']),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ quote: 'in order to', replacement: 'to' });
	});
});

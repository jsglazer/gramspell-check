import { describe, expect, it } from 'vitest';
import { locateQuote } from '../src/core/anchor';
import { applyPlan, planFixes } from '../src/core/edits';

describe('locateQuote', () => {
	it('finds a unique exact match', () => {
		const text = 'alpha $E(u \\mid x) = 0$ beta';
		const r = locateQuote(text, '$E(u \\mid x) = 0$');
		expect(r).toEqual({ status: 'unique', range: { from: 6, to: 23 }, fuzzy: false });
		if (r.status === 'unique')
			expect(text.slice(r.range.from, r.range.to)).toBe('$E(u \\mid x) = 0$');
	});

	it('reports zero matches', () => {
		expect(locateQuote('abc', 'xyz')).toEqual({ status: 'none' });
		expect(locateQuote('abc', '')).toEqual({ status: 'none' });
	});

	it('reports multiple matches', () => {
		expect(locateQuote('beta and beta', 'beta')).toEqual({ status: 'multiple', count: 2 });
	});

	it('accepts a unique whitespace-collapsed match and maps it to the original span', () => {
		const text = 'the  variance of\n  $\\hat\\beta$ is';
		const r = locateQuote(text, 'variance of $\\hat\\beta$');
		expect(r.status).toBe('unique');
		if (r.status === 'unique') {
			expect(r.fuzzy).toBe(true);
			expect(text.slice(r.range.from, r.range.to)).toBe('variance of\n  $\\hat\\beta$');
		}
	});

	it('rejects an ambiguous whitespace-collapsed match', () => {
		expect(locateQuote('a  b and a\tb', 'a b').status).toBe('multiple');
	});

	it('recomputes positions after an earlier edit shifts the text', () => {
		const before = 'intro\nCov(x,u) != 0\nend';
		const plan = planFixes(before, [
			{ id: 'a', quote: 'intro', replacement: 'a much longer intro line' },
		]);
		const after = applyPlan(before, plan.edits);
		const r1 = locateQuote(before, 'Cov(x,u) != 0');
		const r2 = locateQuote(after, 'Cov(x,u) != 0');
		expect(r1.status).toBe('unique');
		expect(r2.status).toBe('unique');
		if (r1.status === 'unique' && r2.status === 'unique') {
			expect(r2.range.from - r1.range.from).toBe(
				'a much longer intro line'.length - 'intro'.length,
			);
		}
	});
});

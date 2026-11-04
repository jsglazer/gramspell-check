import { describe, expect, it } from 'vitest';
import { applyPlan, markRange, planFixes, resolveFix, whitespaceMap } from '../src/core/edits';
import type { Issue } from '../src/core/types';

const issue = (over: Partial<Issue>): Issue => ({
	id: 'x',
	kind: 'spelling',
	quote: '',
	replacement: '',
	explanation: '',
	category: '',
	confidence: 'High',
	sourceUrl: '',
	sourceTitle: '',
	...over,
});

describe('planFixes', () => {
	it('narrows overlapping quotes so disjoint changes in one sentence both apply', () => {
		const text = 'Teh dogs runs fast.';
		const plan = planFixes(text, [
			{ id: 's1', quote: 'Teh dogs', replacement: 'The dogs' },
			{ id: 'g1', quote: 'dogs runs fast', replacement: 'dogs run fast' },
		]);
		expect(plan.applied).toEqual(['s1', 'g1']);
		expect(applyPlan(text, plan.edits)).toBe('The dogs run fast.');
	});

	it('rejects a fix whose change truly overlaps an accepted one', () => {
		const text = 'Their going home.';
		const plan = planFixes(text, [
			{ id: 'a', quote: 'Their going', replacement: "They're going" },
			{ id: 'b', quote: 'Their going', replacement: 'There going' },
		]);
		expect(plan.applied).toEqual(['a']);
		expect(plan.rejected[0].id).toBe('b');
		expect(plan.rejected[0].reason).toMatch(/overlaps/);
	});

	it('rejects a change that touches protected text but allows changes beside it', () => {
		const text = 'The value $x_tehh$ is teh mean.';
		const plan = planFixes(text, [
			{ id: 'bad', quote: '$x_tehh$', replacement: '$x_teh$' },
			{ id: 'ok', quote: '$x_tehh$ is teh mean', replacement: '$x_tehh$ is the mean' },
		]);
		expect(plan.applied).toEqual(['ok']);
		expect(plan.rejected.map((r) => r.id)).toEqual(['bad']);
		expect(applyPlan(text, plan.edits)).toBe('The value $x_tehh$ is the mean.');
	});

	it('allows inserting a word right before a wikilink', () => {
		const text = 'See [[Note]] now.';
		const plan = planFixes(text, [
			{ id: 'a', quote: 'See [[Note]]', replacement: 'See the [[Note]]' },
		]);
		expect(applyPlan(text, plan.edits)).toBe('See the [[Note]] now.');
	});

	it('rejects missing, ambiguous and no-op fixes', () => {
		const text = 'a cat and a cat.';
		const plan = planFixes(text, [
			{ id: 'missing', quote: 'a dog', replacement: 'the dog' },
			{ id: 'many', quote: 'a cat', replacement: 'the cat' },
			{ id: 'noop', quote: 'and', replacement: 'and' },
		]);
		expect(plan.applied).toEqual([]);
		expect(plan.rejected.map((r) => r.reason)).toEqual([
			'The text is no longer in the note.',
			'The text appears 2 times in the note.',
			'The proposed fix makes no change.',
		]);
	});

	it('applies edits in descending order to give the expected text', () => {
		const text = 'one teh two teh2 three';
		const plan = planFixes(text, [
			{ id: 'a', quote: 'one teh', replacement: 'one the' },
			{ id: 'b', quote: 'teh2', replacement: 'the2' },
		]);
		expect(plan.edits.map((e) => e.id)).toEqual(['b', 'a']);
		expect(applyPlan(text, plan.edits)).toBe('one the two the2 three');
	});

	it('maps a whitespace-collapsed quote onto the note text without touching line breaks', () => {
		const text = 'This is teh\nend of it.';
		const res = resolveFix(text, { id: 'a', quote: 'is teh end', replacement: 'is the end' });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(applyPlan(text, [res.edit])).toBe('This is the\nend of it.');
		}
	});
});

describe('whitespaceMap', () => {
	it('maps offsets across differing whitespace runs', () => {
		const map = whitespaceMap('a b', 'a \n b');
		expect(map[0]).toBe(0);
		expect(map[1]).toBe(1);
		expect(map[2]).toBe(4);
		expect(map[3]).toBe(5);
	});
});

describe('markRange', () => {
	it('marks the changed word for spelling and the whole quote for facts', () => {
		const text = 'Paris is the capital of Germany, teh city.';
		const s = markRange(text, issue({ quote: 'teh city', replacement: 'the city' }));
		expect(s && text.slice(s.from, s.to)).toBe('teh');
		const f = markRange(
			text,
			issue({
				kind: 'fact',
				quote: 'Paris is the capital of Germany',
				replacement: 'Paris is the capital of France',
			}),
		);
		expect(f && text.slice(f.from, f.to)).toBe('Paris is the capital of Germany');
	});
	it('returns null when the quote is gone', () => {
		expect(markRange('abc', issue({ quote: 'xyz', replacement: 'xy' }))).toBeNull();
	});
});

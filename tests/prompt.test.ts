import { describe, expect, it } from 'vitest';
import { buildCheckMessage, CHECK_SYSTEM, type CheckOptions } from '../src/core/prompt';

const opts = (over: Partial<CheckOptions>): CheckOptions => ({
	variant: 'en-US',
	spelling: false,
	grammar: false,
	judgement: false,
	facts: false,
	forbidden: [],
	dictionary: [],
	ignored: [],
	...over,
});

describe('split checks', () => {
	it('asks for only the kind requested', () => {
		expect(buildCheckMessage('x', false, opts({ judgement: true }))).toContain(
			'Check for: judgement.',
		);
		expect(buildCheckMessage('x', false, opts({ grammar: true }))).toContain('Check for: grammar.');
	});
	it('puts clear-cut rules under grammar and judgement-call rules under judgement', () => {
		const grammar = CHECK_SYSTEM.slice(
			CHECK_SYSTEM.indexOf('- grammar:'),
			CHECK_SYSTEM.indexOf('- judgement'),
		);
		const judgement = CHECK_SYSTEM.slice(
			CHECK_SYSTEM.indexOf('- judgement'),
			CHECK_SYSTEM.indexOf('- forbidden'),
		);
		expect(grammar).toContain('subject-verb agreement');
		expect(grammar).toContain('comma splices');
		expect(grammar).not.toContain('modifiers');
		expect(judgement).toContain('misplaced modifiers');
		expect(judgement).toContain('that/which');
		expect(judgement).toContain('parallelism');
	});
});

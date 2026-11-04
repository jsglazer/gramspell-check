import { describe, expect, it } from 'vitest';
import {
	addToDictionary,
	filterByDictionary,
	flaggedWord,
	parseDictionary,
} from '../src/core/dictionary';
import type { RawIssue } from '../src/core/types';

const sp = (quote: string, replacement: string, kind: RawIssue['kind'] = 'spelling') => ({
	kind,
	quote,
	replacement,
});

describe('parseDictionary', () => {
	it('reads one word per line, skipping frontmatter, headings, comments and list markers', () => {
		const d = parseDictionary(
			'---\ntags: x\n---\n# My words\n- Heteroskedasticity\n2. `logit`\n%% note\n\n[[Wooldridge]]\nOLS’s\n',
		);
		expect([...d].sort()).toEqual(['heteroskedasticity', 'logit', 'ols', 'wooldridge']);
	});
});

describe('addToDictionary', () => {
	it('appends a new word with a newline and skips existing ones (case-insensitive)', () => {
		expect(addToDictionary('', 'Probit')).toBe('Probit\n');
		expect(addToDictionary('logit', 'Probit')).toBe('logit\nProbit\n');
		expect(addToDictionary('Probit\n', 'probit')).toBe('Probit\n');
	});
});

describe('flaggedWord / filterByDictionary', () => {
	it('finds the whole original word a fix changes', () => {
		expect(flaggedWord(sp('the probitt model', 'the probit model'))).toBe('probitt');
		expect(flaggedWord(sp('Wooldrige says', 'Wooldridge says'))).toBe('Wooldrige');
	});
	it('drops only spelling issues whose word is in the dictionary', () => {
		const dict = new Set(['wooldrige']);
		const issues = [
			sp('Wooldrige says', 'Wooldridge says'),
			sp('Wooldrige says', 'Wooldridge said', 'grammar'),
			sp('teh cat', 'the cat'),
		];
		expect(filterByDictionary(issues, dict).map((i) => i.quote + i.kind)).toEqual([
			'Wooldrige saysgrammar',
			'teh catspelling',
		]);
	});
});

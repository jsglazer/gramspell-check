import { describe, expect, it } from 'vitest';
import {
	checkSchema,
	extractJson,
	parseCheck,
	parseFactAnswer,
	parseScores,
} from '../src/core/schema';

describe('checkSchema', () => {
	it('includes only the requested keys', () => {
		const s = checkSchema(['spelling', 'grammar']) as {
			required: string[];
			properties: Record<string, unknown>;
		};
		expect(s.required).toEqual(['spelling', 'grammar']);
		expect(Object.keys(s.properties)).toEqual(['spelling', 'grammar']);
	});
});

describe('parseCheck', () => {
	it('parses a valid response into issues', () => {
		const raw = JSON.stringify({
			spelling: [{ quote: 'teh cat', replacement: 'the cat', explanation: 'Typo.' }],
			grammar: [
				{
					quote: 'he go',
					replacement: 'he goes',
					category: 'Subject-verb agreement',
					explanation: 'Agreement.',
				},
			],
			facts: [
				{
					quote: 'in 1493',
					replacement: 'in 1492',
					explanation: 'Columbus sailed in 1492.',
					confidence: 'High',
				},
			],
		});
		const r = parseCheck(raw, ['spelling', 'grammar', 'facts']);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.map((i) => i.kind)).toEqual(['spelling', 'grammar', 'fact']);
			expect(r.value[1].category).toBe('Subject-verb agreement');
			expect(r.value[2].confidence).toBe('High');
		}
	});

	it('rejects malformed JSON and schema violations without partial results', () => {
		expect(parseCheck('{not json', ['spelling']).ok).toBe(false);
		expect(parseCheck('[]', ['spelling']).ok).toBe(false);
		expect(parseCheck('{"spelling": {}}', ['spelling']).ok).toBe(false);
		expect(parseCheck('{"spelling": [{"quote": "a"}]}', ['spelling']).ok).toBe(false);
		const badConf = {
			facts: [{ quote: 'a', replacement: 'b', explanation: 'c', confidence: 'Low' }],
		};
		expect(parseCheck(JSON.stringify(badConf), ['facts']).ok).toBe(false);
	});
});

describe('extractJson / parseFactAnswer', () => {
	it('takes the last json fenced block from a free-text answer', () => {
		const text =
			'Searching…\n```json\n{"facts": []}\n```\nMore thought.\n```json\n{"facts": [{"quote": "q", "replacement": "r", "explanation": "e", "confidence": "Med", "source_url": "https://ex.org/a", "source_title": "Ex"}]}\n```';
		const r = parseFactAnswer(text);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toHaveLength(1);
			expect(r.value[0]).toMatchObject({
				kind: 'fact',
				confidence: 'Med',
				sourceUrl: 'https://ex.org/a',
				sourceTitle: 'Ex',
			});
		}
	});

	it('falls back to a bare JSON object and drops non-http sources', () => {
		const text =
			'Result: {"facts": [{"quote": "q", "replacement": "r", "explanation": "e", "confidence": "High", "source_url": "javascript:alert(1)"}]}';
		const r = parseFactAnswer(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value[0].sourceUrl).toBe('');
	});

	it('fails when no JSON is present or it is invalid', () => {
		expect(extractJson('nothing here')).toBeNull();
		expect(parseFactAnswer('nothing here').ok).toBe(false);
		expect(parseFactAnswer('```json\n{"facts": "x"}\n```').ok).toBe(false);
	});
});

describe('parseScores', () => {
	it('parses and clamps scores', () => {
		const raw = JSON.stringify({
			flow: { score: 140, reason: 'a' },
			clarity: { score: 0, reason: 'b' },
			reasoning: { score: 72.6, reason: 'c' },
		});
		const r = parseScores(raw);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.flow.score).toBe(100);
			expect(r.value.clarity.score).toBe(1);
			expect(r.value.reasoning.score).toBe(73);
		}
	});
	it('rejects missing dimensions', () => {
		expect(parseScores('{"flow": {"score": 5, "reason": "x"}}').ok).toBe(false);
	});
});

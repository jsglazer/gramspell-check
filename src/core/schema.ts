import { clampScore } from './review-state';
import type { Confidence, IssueKind, ParseOutcome, RawIssue, Score, Scores } from './types';

const BASE_ITEM = {
	quote: { type: 'string' },
	replacement: { type: 'string' },
	explanation: { type: 'string' },
} as const;

const ITEM_SCHEMAS = {
	spelling: {
		type: 'object',
		additionalProperties: false,
		required: ['quote', 'replacement', 'explanation'],
		properties: BASE_ITEM,
	},
	grammar: {
		type: 'object',
		additionalProperties: false,
		required: ['quote', 'replacement', 'category', 'explanation'],
		properties: { ...BASE_ITEM, category: { type: 'string' } },
	},
	forbidden: {
		type: 'object',
		additionalProperties: false,
		required: ['quote', 'replacement', 'term', 'explanation'],
		properties: { ...BASE_ITEM, term: { type: 'string' } },
	},
	facts: {
		type: 'object',
		additionalProperties: false,
		required: ['quote', 'replacement', 'explanation', 'confidence'],
		properties: { ...BASE_ITEM, confidence: { type: 'string', enum: ['High', 'Med'] } },
	},
} as const;

export type CheckKey = 'spelling' | 'grammar' | 'facts' | 'forbidden';

const KEY_KIND: Record<CheckKey, IssueKind> = {
	spelling: 'spelling',
	grammar: 'grammar',
	facts: 'fact',
	forbidden: 'forbidden',
};

/** JSON schema for a check call covering only the requested keys. */
export function checkSchema(keys: CheckKey[]): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	for (const k of keys) properties[k] = { type: 'array', items: ITEM_SCHEMAS[k] };
	return { type: 'object', additionalProperties: false, required: [...keys], properties };
}

const SCORE_ITEM = {
	type: 'object',
	additionalProperties: false,
	required: ['score', 'reason'],
	properties: { score: { type: 'integer' }, reason: { type: 'string' } },
} as const;

export const SCORES_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['flow', 'clarity', 'reasoning'],
	properties: { flow: SCORE_ITEM, clarity: SCORE_ITEM, reasoning: SCORE_ITEM },
} as const;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Obj, key: string, where: string, optional = false): string {
	const v = o[key];
	if (v === undefined && optional) return '';
	if (typeof v !== 'string') throw new Error(`${where}.${key} must be a string`);
	return v;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new Error('Response was not valid JSON.');
	}
}

function parseItems(data: Obj, key: CheckKey, withSource: boolean): RawIssue[] {
	const arr = data[key];
	if (!Array.isArray(arr)) throw new Error(`${key} must be an array`);
	return arr.map((item, i) => {
		const where = `${key}[${i}]`;
		if (!isObj(item)) throw new Error(`${where} must be an object`);
		let confidence: Confidence = 'High';
		if (key === 'facts') {
			const c = str(item, 'confidence', where);
			if (c !== 'High' && c !== 'Med') throw new Error(`${where}.confidence must be High or Med`);
			confidence = c;
		}
		return {
			kind: KEY_KIND[key],
			quote: str(item, 'quote', where),
			replacement: str(item, 'replacement', where),
			explanation: str(item, 'explanation', where),
			category:
				key === 'grammar'
					? str(item, 'category', where)
					: key === 'forbidden'
						? str(item, 'term', where)
						: '',
			confidence,
			sourceUrl: withSource ? str(item, 'source_url', where, true) : '',
			sourceTitle: withSource ? str(item, 'source_title', where, true) : '',
		};
	});
}

/** Parse and schema-check a check response. Never returns a partial result. */
export function parseCheck(raw: string, keys: CheckKey[]): ParseOutcome<RawIssue[]> {
	try {
		const data = parseJson(raw);
		if (!isObj(data)) throw new Error('Response must be a JSON object.');
		return { ok: true, value: keys.flatMap((k) => parseItems(data, k, false)) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * The JSON object in a free-text answer: the last ```json fenced block, else
 * the last fenced block, else the text from the first `{` to the last `}`.
 */
export function extractJson(text: string): string | null {
	const fences = [...text.matchAll(/```([a-zA-Z]*)[ \t]*\n([\s\S]*?)```/g)];
	const json = fences.filter((m) => m[1].toLowerCase() === 'json');
	const pick = json.length ? json[json.length - 1] : fences[fences.length - 1];
	if (pick) return pick[2].trim();
	const a = text.indexOf('{');
	const b = text.lastIndexOf('}');
	return a !== -1 && b > a ? text.slice(a, b + 1) : null;
}

/** Parse a web-search fact-check answer: `{"facts":[…]}` with optional source fields. */
export function parseFactAnswer(text: string): ParseOutcome<RawIssue[]> {
	try {
		const raw = extractJson(text);
		if (raw === null) throw new Error('No JSON found in the fact-check answer.');
		const data = parseJson(raw);
		if (!isObj(data)) throw new Error('Response must be a JSON object.');
		const issues = parseItems(data, 'facts', true).map((f) => ({
			...f,
			sourceUrl: /^https?:\/\//i.test(f.sourceUrl) ? f.sourceUrl : '',
		}));
		return { ok: true, value: issues };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function parseScore(data: Obj, key: keyof Scores): Score {
	const v = data[key];
	if (!isObj(v)) throw new Error(`${key} must be an object`);
	if (typeof v.score !== 'number') throw new Error(`${key}.score must be a number`);
	return { score: clampScore(v.score), reason: str(v, 'reason', key) };
}

/** Parse and schema-check a scores response; scores are clamped to 1–100. */
export function parseScores(raw: string): ParseOutcome<Scores> {
	try {
		const data = parseJson(raw);
		if (!isObj(data)) throw new Error('Response must be a JSON object.');
		return {
			ok: true,
			value: {
				flow: parseScore(data, 'flow'),
				clarity: parseScore(data, 'clarity'),
				reasoning: parseScore(data, 'reasoning'),
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

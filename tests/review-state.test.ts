import { describe, expect, it } from 'vitest';
import {
	assignIds,
	clampScore,
	fingerprint,
	formatStamp,
	nothingOpen,
	scoreBand,
	sortByPosition,
} from '../src/core/review-state';
import type { RawIssue } from '../src/core/types';

const raw = (kind: RawIssue['kind'], quote: string, replacement: string): RawIssue => ({
	kind,
	quote,
	replacement,
	explanation: '',
	category: '',
	confidence: 'High',
	sourceUrl: '',
	sourceTitle: '',
});

describe('formatStamp', () => {
	it('formats a fixed clock as YYYY-MM-DD HH:MM:SS', () => {
		expect(formatStamp(new Date(2026, 10, 3, 9, 5, 7))).toBe('2026-11-03 09:05:07');
	});
});

describe('assignIds', () => {
	it('numbers per kind, continues after existing issues, and drops duplicates and no-ops', () => {
		const first = assignIds(
			[],
			[
				raw('spelling', 'teh', 'the'),
				raw('grammar', 'he go', 'he goes'),
				raw('spelling', 'teh', 'the'),
				raw('fact', 'x', 'x'),
			],
		);
		expect(first.map((i) => i.id)).toEqual(['s1', 'g1']);
		const second = assignIds(first, [
			raw('spelling', 'recieve', 'receive'),
			raw('grammar', 'he  go', 'he goes'),
		]);
		expect(second.map((i) => i.id)).toEqual(['s2']);
	});
	it('fingerprints are whitespace-insensitive and include the kind', () => {
		expect(fingerprint(raw('grammar', 'a  b', 'c'))).toBe(fingerprint(raw('grammar', 'a b', 'c')));
		expect(fingerprint(raw('grammar', 'a', 'b'))).not.toBe(fingerprint(raw('spelling', 'a', 'b')));
	});
});

describe('nothingOpen / sortByPosition', () => {
	it('detects open items', () => {
		const items = assignIds([], [raw('spelling', 'a', 'b'), raw('spelling', 'c', 'd')]);
		expect(nothingOpen(items, () => 'applied')).toBe(true);
		expect(nothingOpen(items, (id) => (id === 's2' ? 'open' : 'ignored'))).toBe(false);
	});
	it('sorts by position with unanchored items last', () => {
		const pos: Record<string, number | null> = { a: 5, b: null, c: 1 };
		expect(sortByPosition(['a', 'b', 'c'], (x) => pos[x])).toEqual(['c', 'a', 'b']);
	});
});

describe('scores', () => {
	it('clamps to 1–100 and bands at 90/75/60', () => {
		expect(clampScore(NaN)).toBe(1);
		expect(clampScore(150)).toBe(100);
		expect([95, 90, 89, 75, 74, 60, 59].map(scoreBand)).toEqual([
			'excellent',
			'excellent',
			'good',
			'good',
			'fair',
			'fair',
			'weak',
		]);
	});
});

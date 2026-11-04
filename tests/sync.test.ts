import { describe, expect, it } from 'vitest';
import { cardAtNotePosition } from '../src/core/sync';

describe('cardAtNotePosition', () => {
	const cards = [
		{ id: 'b', from: 50, to: 60 },
		{ id: 'a', from: 10, to: 20 },
		{ id: 'c', from: 90, to: 95 },
	];
	it('picks the first card at or below the top of the note view', () => {
		expect(cardAtNotePosition(cards, 0)).toBe('a');
		expect(cardAtNotePosition(cards, 15)).toBe('a');
		expect(cardAtNotePosition(cards, 20)).toBe('b');
		expect(cardAtNotePosition(cards, 61)).toBe('c');
	});
	it('falls back to the last card past the end, and null with no cards', () => {
		expect(cardAtNotePosition(cards, 500)).toBe('c');
		expect(cardAtNotePosition([], 5)).toBeNull();
	});
});

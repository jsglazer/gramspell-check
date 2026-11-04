/** A card's place in the note, for keeping the panel and the note aligned. */
export interface CardPos {
	id: string;
	from: number;
	to: number;
}

/**
 * The card to align with a note whose first visible character is at `top`:
 * the first card (in note order) whose text ends after `top`, else the last card.
 */
export function cardAtNotePosition(cards: CardPos[], top: number): string | null {
	if (cards.length === 0) return null;
	const sorted = [...cards].sort((a, b) => a.from - b.from);
	return (sorted.find((c) => c.to > top) ?? sorted[sorted.length - 1]).id;
}

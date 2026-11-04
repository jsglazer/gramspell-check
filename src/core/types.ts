/** Shared data shapes for the pure checking core. No obsidian / SDK imports. */

export type IssueKind = 'spelling' | 'grammar' | 'fact';

export const ISSUE_KINDS: readonly IssueKind[] = ['spelling', 'grammar', 'fact'];

export type Confidence = 'High' | 'Med';

/** One proposed correction. `replacement` replaces the whole `quote`. */
export interface Issue {
	id: string;
	kind: IssueKind;
	/** Exact text from the note, long enough to occur only once. */
	quote: string;
	/** The corrected version of `quote`. */
	replacement: string;
	explanation: string;
	/** Grammar rule name (grammar only; empty otherwise). */
	category: string;
	/** Fact issues only; 'High' for the others. */
	confidence: Confidence;
	/** Source supporting a fact correction, when web search found one. */
	sourceUrl: string;
	sourceTitle: string;
}

/** An issue as the model returns it, before ids are assigned. */
export type RawIssue = Omit<Issue, 'id'>;

export interface Score {
	score: number;
	reason: string;
}

export interface Scores {
	flow: Score;
	clarity: Score;
	reasoning: Score;
}

/** Half-open character range [from, to) in the note text. */
export interface TextRange {
	from: number;
	to: number;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

import type { Issue, IssueKind, RawIssue } from './types';

export type ItemStatus = 'open' | 'applied' | 'ignored';

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD HH:MM:SS` in local time, from an injected clock value. */
export function formatStamp(d: Date): string {
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Stable fingerprint for "ignore" memory: kind, quote and replacement, whitespace-normalised. */
export function fingerprint(issue: Pick<RawIssue, 'kind' | 'quote' | 'replacement'>): string {
	return `${issue.kind}|${norm(issue.quote)}|${norm(issue.replacement)}`;
}

/**
 * Give issues stable ids (`s1`, `g1`, `f1`…) in arrival order, dropping
 * duplicates (same fingerprint) and fixes that change nothing.
 */
export function assignIds(existing: Issue[], incoming: RawIssue[]): Issue[] {
	const seen = new Set(existing.map(fingerprint));
	const prefix: Record<IssueKind, string> = { spelling: 's', grammar: 'g', fact: 'f' };
	const count: Record<IssueKind, number> = { spelling: 0, grammar: 0, fact: 0 };
	for (const e of existing) count[e.kind]++;
	const out: Issue[] = [];
	for (const raw of incoming) {
		if (raw.quote === raw.replacement || raw.quote.trim() === '') continue;
		const fp = fingerprint(raw);
		if (seen.has(fp)) continue;
		seen.add(fp);
		count[raw.kind]++;
		out.push({ ...raw, id: `${prefix[raw.kind]}${count[raw.kind]}` });
	}
	return out;
}

/** Sort items by where their quote sits in the text; unanchored items go last. */
export function sortByPosition<T>(items: T[], position: (item: T) => number | null): T[] {
	return items
		.map((item, index) => ({ item, index, pos: position(item) }))
		.sort((a, b) => {
			if (a.pos === null && b.pos === null) return a.index - b.index;
			if (a.pos === null) return 1;
			if (b.pos === null) return -1;
			return a.pos - b.pos || a.index - b.index;
		})
		.map((x) => x.item);
}

/** True when a finished check has no open issues left. */
export function nothingOpen(issues: Issue[], status: (id: string) => ItemStatus): boolean {
	return issues.every((i) => status(i.id) !== 'open');
}

/** Score 1–100 (rounded, clamped). */
export function clampScore(n: number): number {
	if (!Number.isFinite(n)) return 1;
	return Math.min(100, Math.max(1, Math.round(n)));
}

export type Band = 'excellent' | 'good' | 'fair' | 'weak';

/** 90–100 excellent, 75–89 good, 60–74 fair, below 60 needs work. */
export function scoreBand(score: number): Band {
	const s = clampScore(score);
	if (s >= 90) return 'excellent';
	if (s >= 75) return 'good';
	if (s >= 60) return 'fair';
	return 'weak';
}

export const BAND_LABEL: Record<Band, string> = {
	excellent: 'Excellent',
	good: 'Good',
	fair: 'Fair',
	weak: 'Needs work',
};

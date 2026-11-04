import { describe, expect, it } from 'vitest';
import { runPool } from '../src/core/pool';

describe('runPool', () => {
	it('never exceeds the limit and reports every result, including failures', async () => {
		let live = 0;
		let peak = 0;
		const tasks = Array.from({ length: 7 }, (_, i) => async () => {
			live++;
			peak = Math.max(peak, live);
			// eslint-disable-next-line obsidianmd/prefer-window-timers -- Node test environment has no window
			await new Promise((r) => setTimeout(r, 5));
			live--;
			if (i === 3) throw new Error('boom');
			return i;
		});
		const seen: Array<[number, string]> = [];
		await runPool(tasks, 3, (i, r) => seen.push([i, r.status]));
		expect(peak).toBeLessThanOrEqual(3);
		expect(seen).toHaveLength(7);
		expect(seen.find(([i]) => i === 3)?.[1]).toBe('rejected');
	});
	it('handles an empty task list', async () => {
		await expect(runPool([], 3, () => undefined)).resolves.toBeUndefined();
	});
});

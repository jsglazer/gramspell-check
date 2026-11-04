/**
 * Run async tasks with at most `limit` in flight, calling `onResult` as each
 * settles (in completion order). Resolves when all have settled; never rejects.
 */
export async function runPool<T>(
	tasks: Array<() => Promise<T>>,
	limit: number,
	onResult: (index: number, result: PromiseSettledResult<T>) => void,
): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < tasks.length) {
			const i = next++;
			try {
				onResult(i, { status: 'fulfilled', value: await tasks[i]() });
			} catch (reason) {
				onResult(i, { status: 'rejected', reason });
			}
		}
	};
	const n = Math.max(1, Math.min(limit, tasks.length));
	await Promise.all(Array.from({ length: n }, () => worker()));
}

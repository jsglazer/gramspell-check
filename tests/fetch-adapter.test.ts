import { describe, expect, it } from 'vitest';
import { makeRequestFetch, type RequestLikeParam } from '../src/core/fetch-adapter';

function fakeRequest(status: number, body: string) {
	const calls: RequestLikeParam[] = [];
	const fn = (p: RequestLikeParam) => {
		calls.push(p);
		return Promise.resolve({
			status,
			headers: { 'content-type': 'application/json', 'request-id': 'req_1' },
			arrayBuffer: new TextEncoder().encode(body).buffer,
		});
	};
	return { fn, calls };
}

describe('makeRequestFetch', () => {
	it('forwards url, method, headers and body', async () => {
		const { fn, calls } = fakeRequest(200, '{"ok":true}');
		const f = makeRequestFetch(fn);
		const res = await f('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'k' },
			body: '{"a":1}',
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			url: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
			body: '{"a":1}',
			contentType: 'application/json',
			throw: false,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('request-id')).toBe('req_1');
		expect(await res.json()).toEqual({ ok: true });
	});

	it('returns non-2xx responses instead of throwing', async () => {
		const { fn } = fakeRequest(429, '{"type":"error"}');
		const res = await makeRequestFetch(fn)(new URL('https://example.test/x'));
		expect(res.status).toBe(429);
		expect(res.ok).toBe(false);
		expect(await res.text()).toBe('{"type":"error"}');
	});

	it('handles null-body statuses and byte bodies', async () => {
		const { fn, calls } = fakeRequest(204, '');
		const res = await makeRequestFetch(fn)('https://example.test', {
			method: 'PUT',
			body: new Uint8Array([104, 105]),
		});
		expect(res.status).toBe(204);
		expect(new TextDecoder().decode(calls[0].body as ArrayBuffer)).toBe('hi');
	});
});

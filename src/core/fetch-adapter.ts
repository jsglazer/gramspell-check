/**
 * Adapts an Obsidian-style `requestUrl` function into a WHATWG `fetch` so the
 * Anthropic SDK can run on desktop and mobile without CORS limits. The
 * requestUrl function is injected, so this module imports nothing from obsidian.
 */

export interface RequestLikeParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestLikeResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
}

export type RequestLike = (param: RequestLikeParam) => Promise<RequestLikeResponse>;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function toHeaderRecord(h: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!h) return out;
	new Headers(h).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

async function toBody(
	body: BodyInit | null | undefined,
): Promise<string | ArrayBuffer | undefined> {
	if (body === null || body === undefined) return undefined;
	if (typeof body === 'string') return body;
	if (body instanceof ArrayBuffer) return body;
	if (ArrayBuffer.isView(body)) {
		const copy = new Uint8Array(body.byteLength);
		copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
		return copy.buffer;
	}
	// Blob, URLSearchParams, FormData, streams: let Response serialise them.
	return new Response(body).arrayBuffer();
}

/** Statuses that must not carry a body when building a Response. */
const NULL_BODY = new Set([101, 204, 205, 304]);

export function makeRequestFetch(request: RequestLike): FetchLike {
	return async (input, init) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const headers = toHeaderRecord(init?.headers);
		const res = await request({
			url,
			method: init?.method ?? 'GET',
			headers,
			body: await toBody(init?.body),
			contentType: headers['content-type'],
			throw: false,
		});
		return new Response(NULL_BODY.has(res.status) ? null : res.arrayBuffer, {
			status: res.status,
			headers: res.headers,
		});
	};
}

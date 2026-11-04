import Anthropic from '@anthropic-ai/sdk';
import { requestUrl } from 'obsidian';
import { makeRequestFetch } from './core/fetch-adapter';
import type { Effort } from './settings';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-fable-5-1',
	'claude-sonnet-5-5',
]);

/** How many times a paused server-tool turn (web search) is resumed. */
const MAX_CONTINUATIONS = 4;

export interface CallResult {
	text: string;
	usage: string;
	searches: number;
}

export interface WebSearchOptions {
	maxUses: number;
	blockedDomains: string[];
}

export interface CallOptions {
	apiKey: string;
	model: string;
	effort: Effort;
	system: string;
	user: string;
	/** JSON schema for structured output, or null for a free-text answer. */
	schema: Record<string, unknown> | null;
	/** Enable the server-side web search tool (free-text answers only). */
	webSearch?: WebSearchOptions;
}

function friendlyError(e: unknown): Error {
	if (e instanceof Anthropic.AuthenticationError)
		return new Error('The API key was rejected. Check the secret in settings.');
	if (e instanceof Anthropic.PermissionDeniedError)
		return new Error('This API key cannot use the selected model.');
	if (e instanceof Anthropic.NotFoundError)
		return new Error('Model not found. Check the model in settings.');
	if (e instanceof Anthropic.RateLimitError)
		return new Error('Rate limited by the API. Try again in a minute.');
	if (e instanceof Anthropic.BadRequestError)
		return new Error(`The API rejected the request: ${e.message}`);
	if (e instanceof Anthropic.APIError)
		return new Error(`API error ${String(e.status ?? '')}: ${e.message}`);
	return e instanceof Error ? e : new Error(String(e));
}

/** One Claude call over Obsidian's requestUrl (no CORS limits on mobile). */
export async function callClaude(opts: CallOptions): Promise<CallResult> {
	const client = new Anthropic({
		apiKey: opts.apiKey,
		dangerouslyAllowBrowser: true,
		fetch: makeRequestFetch(requestUrl),
	});
	const useFallback = FALLBACK_MODELS.has(opts.model);
	const tools: Anthropic.Beta.BetaToolUnion[] = opts.webSearch
		? [
				{
					type: 'web_search_20260209',
					name: 'web_search',
					max_uses: opts.webSearch.maxUses,
					...(opts.webSearch.blockedDomains.length
						? { blocked_domains: opts.webSearch.blockedDomains }
						: {}),
				},
			]
		: [];
	const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.user }];
	let input = 0;
	let cached = 0;
	let output = 0;
	let searches = 0;
	try {
		for (let turn = 0; ; turn++) {
			const message = await client.beta.messages
				.stream({
					model: opts.model,
					max_tokens: 32000,
					thinking: { type: 'adaptive' },
					output_config: {
						effort: opts.effort,
						...(opts.schema ? { format: { type: 'json_schema', schema: opts.schema } } : {}),
					},
					cache_control: { type: 'ephemeral' },
					system: [{ type: 'text', text: opts.system }],
					messages,
					...(tools.length ? { tools } : {}),
					...(useFallback
						? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
						: {}),
				})
				.finalMessage();

			const u = message.usage;
			cached += u.cache_read_input_tokens ?? 0;
			input +=
				u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
			output += u.output_tokens;
			searches += u.server_tool_use?.web_search_requests ?? 0;

			if (message.stop_reason === 'refusal') {
				const category = message.stop_details?.category ?? 'unspecified';
				throw new Error(`Claude declined this request (category: ${category}).`);
			}
			if (message.stop_reason === 'max_tokens') {
				throw new Error(
					'The response was cut off (output limit reached). Try a lower effort or a shorter note.',
				);
			}
			if (message.stop_reason === 'pause_turn') {
				if (turn >= MAX_CONTINUATIONS)
					throw new Error('The fact check took too many search rounds. Try again.');
				// Resume: send the paused assistant turn back unchanged; the server continues it.
				messages.push({
					role: 'assistant',
					content: message.content as Anthropic.Beta.BetaContentBlockParam[],
				});
				continue;
			}
			const text = message.content
				.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
				.map((b) => b.text)
				.join('');
			const usage =
				`${input} in (${cached} cached) · ${output} out` +
				(searches ? ` · ${searches} search${searches === 1 ? '' : 'es'}` : '');
			return { text, usage, searches };
		}
	} catch (e) {
		throw friendlyError(e);
	}
}

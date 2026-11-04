import { describe, expect, it } from 'vitest';
import { isProtected, protectedRanges } from '../src/core/protect';

const slice = (text: string): string[] =>
	protectedRanges(text).map((r) => text.slice(Math.max(0, r.from), r.to));
const prot = (text: string, sub: string, at = 0): boolean => {
	const from = text.indexOf(sub, at);
	return isProtected({ from, to: from + sub.length }, protectedRanges(text));
};

describe('protectedRanges', () => {
	it('protects frontmatter, including an insertion at offset 0', () => {
		const t = '---\ntitle: Teh\n---\nBody teh text.';
		expect(prot(t, 'Teh')).toBe(true);
		expect(isProtected({ from: 0, to: 0 }, protectedRanges(t))).toBe(true);
		expect(prot(t, 'teh')).toBe(false);
	});

	it('protects fenced code blocks, including unclosed ones', () => {
		const t = 'Text.\n```js\nconst teh = 1;\n```\nMore teh.';
		expect(prot(t, 'const teh')).toBe(true);
		expect(prot(t, 'More teh')).toBe(false);
		expect(prot('a\n~~~\nopen fence', 'open fence')).toBe(true);
	});

	it('protects inline code and math but not the prose around them', () => {
		const t = 'Use `foo teh` and $x_teh$ and $$y$$ here.';
		expect(prot(t, 'foo teh')).toBe(true);
		expect(prot(t, 'x_teh')).toBe(true);
		expect(prot(t, '$$y$$')).toBe(true);
		expect(prot(t, 'here')).toBe(false);
		expect(prot(t, 'Use')).toBe(false);
	});

	it('ignores escaped dollars', () => {
		expect(slice('It costs \\$5 and \\$6.')).toEqual([]);
	});

	it('protects wikilink targets but not aliases, and markdown link URLs but not text', () => {
		const t = 'See [[Teh Note|teh alias]] and [[Other Note]] and [link teh](http://x.com/teh).';
		expect(prot(t, 'Teh Note')).toBe(true);
		expect(prot(t, 'teh alias')).toBe(false);
		expect(prot(t, 'Other Note')).toBe(true);
		expect(prot(t, 'link teh')).toBe(false);
		expect(prot(t, 'http://x.com/teh')).toBe(true);
	});

	it('protects embeds, bare URLs, HTML tags, footnote keys, tags, block ids and comments', () => {
		const t =
			'![[img teh.png]] go https://ex.com/teh <span class="teh">ok</span> note[^teh] #tag/teh %%hid teh%% end ^blk-1';
		expect(prot(t, 'img teh.png')).toBe(true);
		expect(prot(t, 'https://ex.com/teh')).toBe(true);
		expect(prot(t, 'class="teh"')).toBe(true);
		expect(prot(t, 'ok')).toBe(false);
		expect(prot(t, '[^teh]')).toBe(true);
		expect(prot(t, '#tag/teh')).toBe(true);
		expect(prot(t, 'hid teh')).toBe(true);
		expect(prot(t, '^blk-1')).toBe(true);
		expect(prot(t, 'go')).toBe(false);
	});

	it('does not treat headings or "#1" numbers as tags', () => {
		expect(prot('# Heading teh', 'Heading')).toBe(false);
		expect(prot('Item #1 is fine', '#1')).toBe(false);
	});

	it('protects JE: lines (with prefixes) and everything below DO NOT EDIT', () => {
		const t = 'ok teh\n- JE: teh kept\n> JE: also\n## DO NOT EDIT\nteh below';
		expect(prot(t, 'teh kept')).toBe(true);
		expect(prot(t, 'also')).toBe(true);
		expect(prot(t, 'teh below')).toBe(true);
		expect(prot(t, 'ok teh')).toBe(false);
		// An insertion at the very start of a JE: line counts as inside it.
		const start = t.indexOf('- JE:');
		expect(isProtected({ from: start, to: start }, protectedRanges(t))).toBe(true);
	});
});

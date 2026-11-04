/**
 * Virtual-outliner entry lines: one or more `@` sigils, an optional `p`
 * (paragraph break) or `%` (comment) flag, then a space, e.g. `@ Background`,
 * `@@p While…`, `@% note to self`. Pandoc citations such as `@smith2020` have
 * no space after the sigil and are body text, not entries.
 */
const OUTLINE_LINE = /^[ \t]*@+[p%]? /;

export function isOutlineLine(line: string): boolean {
	return OUTLINE_LINE.test(line);
}

/** The text with every outline entry and `@%` comment line removed. */
export function stripOutlineLines(text: string): string {
	return text
		.split('\n')
		.filter((line) => !isOutlineLine(line))
		.join('\n');
}

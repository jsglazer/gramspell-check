# Gramspell Check

An Obsidian plugin that checks a note for spelling, grammar and factual errors with Claude. Problems are marked in the note, the proposed fixes are listed with diffs in a right-sidebar pane, and the pane also scores the writing's flow, clarity and reasoning. Works on desktop and iOS.

## What it does

- **Check spelling, grammar & facts** (command, ribbon icon, or the pane's **Check note** button) sends the note to Claude.
- **Spelling** errors get a light-yellow background in the note. Real-word mistakes (*their/there*, *affect/effect*, *form/from*) are caught as well as typos. Proper nouns, technical terms and words in your dictionary are left alone.
- **Grammar** errors get a red wavy underline. The checker works at sentence and paragraph level: agreement across long phrases, pronoun reference, tense consistency, comma splices, fragments, dangling modifiers, parallelism, who/whom, that/which, fewer/less, apostrophes, articles, doubled words and punctuation. Style preferences such as passive voice are not flagged.
- **Facts** get a maroon underline. Claude verifies them with web search on reputable sources, skipping blocked sites, and each card links its source.
- **Forbidden words** get a purple dotted underline. You list the words or phrases in settings. For `word => replacement` entries the plugin finds every use itself and offers the replacement, keeping the capitalisation; `word =>` deletes the word. For a word listed on its own, Claude suggests a minimal rewording in context.
- It **only corrects**: it never adds content or rewrites for style, and each fix is the smallest change that makes the text correct.
- Each problem is a card with a **pre-ticked Fix** checkbox, a red/green word diff, and an explanation. Click anywhere on a card to jump to its text in the note (both flash briefly). Hovering a card outlines its text in the note, and hovering a mark in the note highlights its card. Clicking a mark brings its card into view and flashes it.
- **Apply selected** applies every ticked fix in one change, so a single undo reverts all of them. Fixes in the same sentence are narrowed to the words they change, so they don't collide.
- **Ignore** hides a fix and remembers it for that note. For spelling, **Add to dictionary** adds the word to your dictionary note.
- Cards are one list in **note order**, each tagged with its kind; a setting groups them by kind instead. The panel and the note **stay aligned**: scrolling the note brings the panel to the first issue at the top of the note, and scrolling the panel brings the note to the card at the top of the panel. The aligned card gets an accent border.
- Filter chips show or hide each kind of issue, both the cards and the marks in the note.
- **Scores** at the bottom of the pane rate the note's Flow, Clarity and Reasoning from 1 to 100, each with a one-line reason. **Rescore** runs them again. The arrow beside **Scores** collapses the section to one line (Flow · Clarity · Reasoning), and the choice is remembered. Virtual-outliner entry lines (`@ …`, `@@ …`, `@@p …`) and `@%` comment lines are left out of the scoring.
- **Stamp gramcheck** writes `gramcheck: YYYY-MM-DD HH:MM:SS` to the frontmatter, adding the field if it isn't there. By default the stamp is written automatically once nothing is left open.

These are never checked or changed: frontmatter, code, math, URLs, link and embed targets (link aliases are checked), HTML tags, footnote keys, tags, block ids, `%%` comments, `JE: ` lines, and anything below a `DO NOT EDIT` heading.

Long notes are split at headings and checked in parallel, and results appear as each part finishes.

## Settings

- **Anthropic API key**: a secret in Obsidian's keychain. The default secret name (`anthropic-api-key`) is the one Note Check uses, so the two plugins share the key. Only the secret's name is saved in `data.json`.
- **Model**: Claude Sonnet 5.5 by default. Opus 5.5, Fable 5.1 or Haiku 5.5 can be selected.
- **Effort**: Medium by default.
- **Checks**: Spelling, Grammar, Facts and Scores can each be switched off.
- **English variant**: US (default), UK, Canada or Australia.
- **Dictionary note**: default `gramspell-check/Dictionary.md`, one word per line.
- **Verify facts with web search** (on by default) and **Blocked sites** (default reddit.com, quora.com, pinterest.com, answers.com and fandom.com). With web search off, facts are checked from Claude's own knowledge.
- **Forbidden words**: one per line, as `word`, `word => replacement` or `word =>`. Lines starting with `#` are ignored.
- **Keep panel and note aligned** (on by default) and **Group cards by kind** (off by default).
- **Stamp automatically** (on by default).
- **Highlight colours** for spelling, grammar, facts and forbidden words.

## Development

```bash
npm install
npm test        # Vitest, headless core tests
npm run lint
npm run build   # typecheck + esbuild → main.js
```

Pure logic lives in `src/core/` and imports nothing from `obsidian` or the Anthropic SDK. That covers protected regions, quote anchoring, narrowing fixes to their minimal change, edit planning, word diffs, chunking, response parsing, prompts, the dictionary, scores and the stamp format. All network calls go through Obsidian's `requestUrl`. The only use of Obsidian internals is `editor.cm`, in `src/cm-marks.ts`.

## License

MIT

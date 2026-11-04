# gramspell-check log

## 2026-11-03 20:40 — v1.0.1: skip virtual-outline lines when scoring; forbidden word list

**Prompt:**
- "it needs to ignore the virtual outline lines, which start with "@", for the scoring"
- "add an option in settings for a forbidden word list"

**Changes:** Version 1.0.0 → 1.0.1. Lint clean, 72/72 tests pass (10 new), build OK. Commit `78fb802` pushed. Deployed to VaultSchar and reloaded. Before reloading I checked that the one check in memory (TheoryHypo.md) had nothing open. Running version confirmed as 1.0.1.

| # | Issue | Fix |
|---|---|---|
| 1 | Virtual-outliner entry lines (`@ …`, `@@ …`) were being scored as prose | New `src/core/outline.ts` (`isOutlineLine`, `stripOutlineLines`): a line counts as an entry when it is one or more `@`, an optional `p` or `%` flag, then a space. The scores request gets the body with those lines removed (so `@%` comment lines are dropped too). Pandoc citations such as `@smith2020` have no space after the `@`, so they stay. A body that is empty after stripping gives "There is no body text to score". Spelling, grammar and fact checks are unchanged |
| 2 | No way to ban words | New setting **Forbidden words** (one per line; `#` lines ignored). `word => replacement` (or `→`) and `word =>` (delete) are found locally by `src/core/forbidden.ts`: whole-word, case-insensitive, flexible whitespace inside phrases, skipping frontmatter and protected Markdown, longer listed phrases winning over shorter terms inside them. The fixes keep the original capitalisation, a deletion takes one neighbouring space with it and passes a capital to the next word, and each quote grows until it is unique. A word with no replacement is sent to Claude in the check request (new `forbidden` schema key), and Claude rewords each use minimally. New **Forbidden** kind: cards tagged with the term, a filter chip, a purple dotted underline, and a colour setting |

### Summary

Both changes are in 1.0.1, which is installed and running in VaultSchar (pushed as `78fb802`). Lint is clean and all 72 tests pass, 10 of them new.

1. **Virtual-outline lines are left out of the scores.** Before the note goes to Claude for Flow/Clarity/Reasoning, lines starting with `@`, `@@`, `@@p`, … and `@%` comments are removed. Pandoc citations such as `@smith2020` at the start of a line are kept, because they have no space after the `@`. Spelling, grammar and fact checking still look at those lines, since you only asked about scoring. If you'd like the outline lines skipped there too, that's a small change.
2. **Forbidden word list:** Settings → Gramspell Check → **Forbidden words**, one per line:
   - `utilize => use`: every use is found and replaced, keeping capitals (*Utilize* → *Use*).
   - `very =>`: the word is deleted, along with its space ("Very good" → "Good").
   - `obviously`: on its own line, Claude rewords each use in context.
   These show up as a fourth group, **Forbidden**, with a purple dotted underline, pre-ticked like the others. Code, math, links and frontmatter are never touched.

I haven't run either change on a real note in the app yet; the tests cover the matching and replacement logic.

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

## 2026-11-03 21:00 — v1.0.2: keep the panel and note aligned; collapsible Scores

**Prompt:**
- "scrolling the main window should also scroll the checker panel -- always keep the two aligned"
- "give "Scores" an arrow to collapse/expand that section"

**Changes:** Version 1.0.1 → 1.0.2. Lint clean, 74/74 tests pass (2 new), build OK. Commit `f93fcc1` pushed. Deployed to VaultSchar and reloaded (no checks were in progress). Running version confirmed as 1.0.2. I checked the top-of-note calculation against your open note (scrollTop 1778 px → document offset 4360). The alignment itself hasn't been seen on a real check yet.

| # | Issue | Fix |
|---|---|---|
| 1 | Scrolling the note didn't move the panel | New setting **Keep panel and note aligned** (default on), working both ways. Scrolling the note (capture-phase `scroll` listener, filtered to this note's CodeMirror scroller) finds the first card whose text ends below the top of the note (new pure `cardAtNotePosition` in `src/core/sync.ts`) and scrolls the panel so that card sits at the top. Scrolling the panel scrolls the note so the top card's text sits near the top (`EditorView.scrollIntoView`, `y: 'start'`), without moving the cursor. Each side ignores scroll events for 250 ms after we scroll it ourselves, and panel re-renders that restore scroll position are also ignored, so nothing bounces back. Events are throttled with `requestAnimationFrame`. The aligned card gets an accent border. The `editor.cm` helpers (`editorScroller`, `topVisibleOffset`, `scrollOffsetToTop`) live in `src/cm-marks.ts`, still the only module that uses `editor.cm` |
| 2 | Cards grouped by kind can't line up with the note | Cards are now one list in note order, each tagged with its kind. New setting **Group cards by kind** (default off) brings back the per-kind lists; alignment still works there, but the panel jumps between groups |
| 3 | Scores section couldn't be collapsed | Chevron toggle on the Scores header (click, Enter or Space; `aria-expanded`). Collapsed shows "Flow · Clarity · Reasoning" as one line of numbers. The state is saved in settings (`scoresCollapsed`) |

### Summary

Both are in 1.0.2, which is installed and running in VaultSchar (pushed as `f93fcc1`). Lint is clean and all 74 tests pass.

1. **Note and panel stay aligned.** Scroll the note and the panel moves to the first issue at the top of the note. Scroll the panel and the note follows the card at the top. The card that's lined up gets an accent border. To make this work, the cards are now **one list in the order they appear in the note** (each tagged Spelling / Grammar / Fact / Forbidden) instead of four separate groups. If you prefer the groups, turn on **Group cards by kind** in settings. Alignment can be switched off with **Keep panel and note aligned**.
2. **Scores collapse.** Click the arrow next to **Scores** to fold it to one line showing the three numbers (Flow · Clarity · Reasoning). Click again to expand. It remembers your choice.

I checked that the plugin reads the top of your open note correctly. I haven't seen the alignment run against a real check yet, because there was no check open. Run one and scroll both ways; if it feels jumpy or lags, tell me and I'll tune it.

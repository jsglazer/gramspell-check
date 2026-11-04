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

## 2026-11-03 21:20 — v1.0.3: hover and click work with a single issue

**Prompt:** "neither hover nor click work when there is only 1 item in the fix list"

**Diagnosis:** I inspected the live panel on TheoryHypo.md (one grammar card, g1). The panel's hover state was stuck on g1: it was set by focus, by pointerdown, or by clicking the mark in the note, and it only cleared when the pointer left the whole panel. With the outline already permanently on, hovering the only card changed nothing. Clicking a mark scrolled the panel to its card and tinted it faintly, and with one card no scroll was needed, so nothing visible happened. With several cards the movement between them hid both problems. Only the diff line jumped to the text; the rest of the card did nothing.

**Changes:** Version 1.0.2 → 1.0.3. Lint clean, 74/74 tests pass, build OK. Commit `cd23502` pushed. Deployed to VaultSchar and reloaded (the one check in memory had nothing open). Disabling the plugin closed its panel, so I reopened it. **Verified in the live app** with a temporary one-issue check on TheoryHypo.md (removed afterwards, cursor restored): card hover on/off ✓, click on the card body jumps to the text and flashes the card and mark ✓, hovering the mark highlights the card and leaving it clears ✓, clicking the mark flashes the card ✓.

| # | Issue | Fix |
|---|---|---|
| 1 | Hover highlight could stick on, so with one card hovering showed no change | Hover is transient and two-way. A card's `mouseenter`/`mouseleave` outlines and clears its mark and gives the card an accent `is-hover` style. A pointer over a mark in the note (document `mouseover`, filtered to this note's editor) highlights its card, and moving off clears it. The sticky `focusin`/`pointerdown` triggers are gone. The hover state survives re-renders |
| 2 | Clicking gave no visible response when no scrolling was needed | `flash(id)` pulses the card (accent ring animation) and outlines plus tints the mark for ~1.4 s, then clears unless the pointer is still on the card. Used when jumping from a card and when clicking a mark (`scrollIntoView` now uses `nearest`, with the panel→note sync paused during the smooth scroll) |
| 3 | Only the diff line was clickable | Clicking anywhere on a card jumps to its text, except on the checkbox, buttons and links |

### Summary

Fixed in 1.0.3, which is installed and running in VaultSchar (pushed as `cd23502`).

The cause was the panel's "hovered" item getting stuck on. Clicking the mark in the note, or clicking into the card, set it, and only moving the mouse out of the whole panel cleared it. With a single card the outline was already on, so hovering looked dead. Clicking a mark only scrolled the panel and tinted the card faintly, and with one card there was nothing to scroll, so nothing seemed to happen. With several cards the movement between them hid it.

Now:
- **Hover works both ways:** hover a card and its text in the note gets an outline and tint. Hover the underlined text in the note and its card lights up. Moving away clears both.
- **Click anywhere on a card** (not just the diff) to jump to the text. The card pulses and the text in the note flashes, so you always see where you landed.
- **Clicking the underlined text in the note** brings its card into view and pulses it, even when it's the only one.

I tested all of these in your vault with a temporary one-issue check on TheoryHypo, then removed it and put your cursor back. Reloading the plugin closed its panel, so I reopened it.

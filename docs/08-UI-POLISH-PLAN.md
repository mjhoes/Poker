# 08 — Interface Polish Plan

Goal: make Perfect Draw look and feel like a finished product, not a prototype. This plan covers the first round of
feedback (items F1–F10), the problems found while reviewing the code and screenshots, the graphical assets to create, and
the order to build it in.

Guiding rules for every change:

- **The table is the stage.** Play information (cards, result, bet, win, credits) lives on the machine screen, not
  in panels stacked under it.
- **Quiet by default, detail on request.** Show the short answer first. Put the long explanation behind "Details".
- **Every coin amount carries its dollar value.**
- **No native browser UI.** No `window.confirm`, `alert` or `prompt`, and no unstyled `<select>` where a visual
  picker would read better.
- **Say each thing once.** Disclaimers and explanations appear where they matter, not on every screen.

---

## Part A — Feedback items

### F1. Replace browser pop-ups with in-app dialogs

**Found:** three `window.confirm` calls in `apps/web/src/App.tsx` (delete machine, close session, restore backup).

**Plan**

- Add a `ConfirmDialog` component and a promise-based `useConfirm()` hook built on the existing `Modal` (which already
  traps focus and handles Escape). Calls look like
  `if (!await confirm({ title, body, confirmLabel, tone: "danger" })) return;`.
- Tones: `default` (felt-green button) and `danger` (coral button with a warning icon). Danger dialogs focus
  **Cancel** first, so Enter/Space never confirms by accident.
- The close-session dialog shows a small session summary (hands, net in $, errors) so it is useful as well as a
  confirmation.
- Restoring a backup also needs a checkbox: "I understand this replaces all data on this device".
- Add a lint rule (`no-restricted-globals` for `confirm`, `alert` and `prompt`) so they cannot come back.

### F2. Replace sticky inline notices with toasts

**Found:** `notice` and `error` in `App.tsx` render as full-width banners that stay until you click "Dismiss" or start
another action. Examples: "Session closed and saved.", "Free Play session ready…", "Session selected. Its saved hand was
not changed."

**Plan**

- Add a small toast system (`ToastProvider`, `toast.success/info/error`), shown bottom-center on mobile and
  bottom-right on desktop, with an icon, an optional action (for example "Undo" or "View report"), and an `aria-live`
  region.
- Success and info toasts close themselves after about 3.5 s and pause while hovered or focused. Error toasts stay
  until dismissed.
- **Delete the messages that just confirm what the screen already shows.** Selecting a session, preparing a session and
  closing a session already change the screen, so they need no notice. Keep toasts for backup exported, wallet
  top-up/transfer and machine saved.
- Form errors go inside the dialog (this already works). Play errors stay inline on the table, because they need a
  retry button there.
- Clear any notice when the route changes.
- The backup reminder becomes a slim, dismissible "nudge" chip in the header instead of a page banner.

### F3. Color the playing cards by suit

**Found:** the red-suit rule exists (`.hand-card.red-suit` at `styles.css:167`), but `.play-table .hand-card`
(`styles.css:233`) sets `color` later with the same specificity. The later rule wins, so every card renders black.
Completed hands also inherit `button:disabled { opacity: .55 }`, so the final hand looks grey and washed out (see the
screenshots).

**Plan**

- Replace the text-glyph cards with an SVG `<CardFace>` component (see Part C): proper corner indices, a center pip
  layout per rank, and original face-card art for J, Q and K.
- Colors are suit tokens: `--suit-hearts`, `--suit-diamonds`, `--suit-clubs`, `--suit-spades`.
  - Default: classic two-color (hearts/diamonds red `#C8312B`, clubs/spades near-black `#1B1F1D`).
  - Settings option: a **four-color deck** (spades black, hearts red, diamonds blue, clubs green), which helps
    when reading flush draws quickly.
- Completed or locked cards are not styled as disabled. Use `aria-disabled` and a "locked" style (no hover lift) instead
  of the faded look.
- Use the same `<CardFace>` everywhere cards appear: the table, feedback, line results, the statistics examples and the
  closed-session report. That replaces text such as "Ks · 6s · 6d".

### F4. Show dollar values next to coins

**Found:** coin amounts appear without dollars in: hold EVs and EV lost (`SessionPage` `formatEv`), settlement line
payouts, closed-session "EV lost", the "credits" meters, and Statistics EV figures (`StatsPage` `coins()`).

**Plan**

- Add one formatter and component: `formatCoins(coins, denominationCents)` → `2.470 coins ($0.62)`, with a
  `<CoinAmount coins denom />` component that styles the dollar part slightly quieter. Small values keep useful
  precision (`0.004 coins (<$0.01)`).
- Session screens: always available, using `session.machineSnapshot.denominationCents`.
- Credits meter: `1,985 credits · $496.25`.
- **Statistics:** decision records already store `denominationCents`, so add up dollar EV per decision (the coin loss
  times that decision's denomination) instead of converting a total afterward. **One gap:** `dailyAggregates` (decisions
  older than 90 days) do not store denomination.
  - Add `denominationCents` to the aggregate bucket key (Dexie v4 migration).
  - Older aggregate rows show dollars as "—", with a tooltip saying the data was archived before dollar tracking.
  - Add an optional Denomination filter to Statistics, so "EV lost per 1,000" can be stated in dollars cleanly.

### F5. Quieter feedback when the optimal hold is chosen

**Found:** every graded hand shows a large panel: three EV boxes, two label lines and a card breakdown. That happens even
when the hold was correct.

**Plan — three levels of feedback**

1. **Optimal:** no panel. The held cards get a short gold shimmer, an **"Optimal ✓" stamp** appears on the table
   (about 600 ms scale-and-fade, off when `prefers-reduced-motion` is set), and a small pill stays under the cards:
   `✓ Optimal · Low pair` with a ⓘ toggle. Clicking it opens the detail drawer.
2. **Suboptimal (shown after the draw):** one compact bar: `✗ Best was Low pair (6♠ 6♦) · −2.47 coins ($0.62)`,
   with the best-hold cards drawn as small cards and the details drawer already open below it.
3. **Details drawer (any case):** the current full content (both EVs, labels, original deal and holds), restyled with
   mini cards.

- **Warn-before-draw:** instead of the big panel, the table goes into a "review" state. The best-hold cards get a dashed
  outline, a bar above the action row reads "A stronger hold exists", and two buttons appear: **Use best hold** and
  **Draw anyway**. The main Draw button is replaced by these buttons rather than shown dimmed. In the screenshot the dim
  Draw button is nearly invisible.
- **Default state (confirmed):** the drawer is **open** after a suboptimal hold and **closed** after an optimal one.
  The player can still toggle it on any hand.
- Rapid Drill uses the same three levels. There, "Optimal" also offers a one-key **Next hand** (Space).

### F6. Show the settlement on the table

**Found:** after a Free Play draw, a separate "Settlement · $0.00" panel lists each line as text. Only line 1 appears as
cards.

**Plan — a machine-style screen**

- **Pay table marquee** at the top of the table: a compact pay table for the machine's game and coin count. The winning
  row lights up and pulses once on a win.
- **Multi-line layout** (3, 5 or 10 lines): the extra lines appear as rows of small cards stacked above the main hand,
  as on real multi-play machines. Each row shows its hand name and win on the right (`FULL HOUSE · 45 ($11.25)`).
  Losing lines dim and winning lines glow. 10-play uses denser rows, and on phones the rows can be scrolled
  horizontally.
- **Main hand:** after the draw, cards that are part of the winning combination lift slightly and the others dim. The
  hand name appears as a banner across the cards ("TWO PAIR").
- **Credit meter** along the bottom edge of the table, replacing the current bottom line:
  `BET 15 · $3.75 | WIN 45 · $11.25 | CREDITS 1,985 · $496.25`. WIN counts up over about 400 ms (instant when reduced
  motion is set).
- Remove the separate Settlement panel. Its information now lives on the screen.

### F7. Fewer "pretend money" disclaimers

**Found:** about 30 mentions ("play-money", "not real money", "no purchases", "simulated practice funds", "no cash
value") across `App.tsx`, `HomePage.tsx`, `WalletsPage.tsx`, `SessionPage.tsx` and the service error messages.

**Plan — say it in three places only**

1. First-run welcome (a single onboarding card).
2. The Create wallet dialog: one line under the amount field.
3. The page footer, shortened to `Practice credits only · Data stays on this device`.

Everywhere else:

- "Play-money wallet" → **Wallet** or **Bankroll**.
- "Practice bet/win" → **Bet/Win**.
- "Insufficient play-money balance" → "Not enough credits in this wallet."
- Remove the "Not a casino. Not real money." card, the "Play-money balances; no cash value" subtitle, the
  "All amounts are simulated…" warning card and the "· PLAY MONEY" table label.

The same copy pass removes other over-explaining:

- "Frozen at start", "Machine edits do not rewrite this session snapshot", "engine-backed" and "saved session ·
  active. Real engine decisions and…".
- The "Private training room" and "Your private practice room" eyebrows.
- Raw family IDs such as "jacks or better" (lowercase, from `familyName`). Use proper display names instead.
- Plurals such as "1 lines".

All user-facing strings move into `apps/web/src/copy.ts`, so wording is reviewed in one place.

### F8. Machines screen: a casino floor

**Found:** one machine at a time in a carousel (‹ ●○ ›). Playing takes Prepare session → a dialog → choosing a wallet and
mode → Prepare session. Adding a machine is a secondary "+ Add another configuration" button in the sidebar. A wallet has
to exist before anything else works.

**Plan**

- **Floor grid:** every machine shows at once as a **cabinet tile** (SVG illustration, see Part C), 2–4 per row on
  desktop and 1–2 on phones. Each cabinet shows:
  - Marquee: the machine name, tinted with the machine's felt color.
  - Screen: the game short code and pay table (`9/6 JoB`, `DDB 9/6`) and the computed return (`99.54%`).
  - Badges: denomination (`25¢`), `5 coins × 3 lines`, and a "● In play · $496.25" ribbon if a session is open.
  - Buttons: **Play** (primary) and **Drill**, plus a "⋯" menu for Edit, Duplicate and Delete.
- **One click to play.** Play starts Free Play right away with the machine's default wallet. If that machine already
  has an open session, Play resumes it. The Prepare dialog only appears when there is a real choice to make (for example
  no wallet, or not enough balance), and "Change wallet" becomes a link in the session sidebar.
- **Adding a machine is obvious:** the last tile in the grid is an empty cabinet outline marked **"+ New machine"**. The
  page header also gets a "+ New machine" button, and the empty state is a big version of the same tile.
- **New machine flow:** a sheet with a live cabinet preview that updates as you choose:
  1. **Game:** visual tiles per game family, then pay-table chips inside the family (`9/6`, `8/5`, …) with return %,
     plus **"Enter a pay table…"** (F9).
  2. **Bet:** segmented controls for denomination (`1¢ 5¢ 25¢ $1 $5 Custom`), coins (1–5) and lines (1/3/5/10).
  3. **Look:** felt swatches (F10).
  - Name is optional and defaults to something sensible (`9/6 Jacks · 25¢ · 3-play`). Casino, location and notes go
    under "More details".
- **No wallet gate:** on first run, automatically create a "Bankroll" wallet with a starting balance chosen on the
  welcome card ($100 / $500 / $1,000 / custom). The Wallets page is still there for anyone who wants more than one.
- The sidebar ("Engine status" and the wallet card) goes away. A small bankroll total sits in the header instead.

### F9. Enter a pay table by hand

**Found:** `paytableSchema` already allows `source: "manual"` and Dexie has a `paytables` table, but the machine form
only lists the 8 library tables. The worker resolves tables with `getLibraryPayTable`, so custom tables cannot be
played yet.

**Plan**

- **Pay table editor** (opened from "Enter a pay table…" in the game step, and from a new Pay tables section in
  Settings):
  - Pick a game family. The grid fills in from the closest library table, as a "start from" choice.
  - Rows are the family's hand ranks. By default you edit only the **per-coin pay** (what is printed on the glass at
    1 coin) plus the **royal at 5 coins** (default 4000). A toggle shows all five coin columns for unusual machines.
  - **Quick fill:** type the usual shorthand (`9/6`, `8/5`, `9/6/4`) to set the key rows for that family.
  - **Paste:** accept a tab- or space-separated block copied from a website or a note.
  - **Live check:** flags values out of order (a flush paying more than a full house) and missing rows, and shows the
    **computed return %** from the worker's `analyzeGame` (debounced, with a spinner and a "Computing…" state).
  - Save as a named table. Its ID is the content hash (`payTableId`), so entering a library table again is recognized
    ("This matches 9/6 Jacks or Better").
- **Engine and worker:** the worker looks tables up in Dexie as well as the library. Hold EVs are computed per hand, so
  play works at once. Custom tables have no precomputed strategy charts, so Statistics shows "baseline computing" the
  first time and stores the result in `analyses`.
- The photo pay-table reader (spec F2.1) will later end on **this same editor** as its confirmation screen, so the
  manual and photo paths share one UI.

### F10. Apply the felt to the table

**Found:** `machine.theme` is saved and shown as text ("FELT TABLE") but never used for styling. `.play-table` and
`.machine-visual` hard-code green.

**Plan**

- Define theme tokens per felt: `--felt-base`, `--felt-light`, `--felt-dark`, `--felt-line`, `--felt-ink`, and
  `--accent` for the hold border and win glow. Apply them with `data-felt="…"` on the play table, the cabinet tile and
  the session room's page background (a subtle tint plus a vignette, so the whole room changes, not only the box).
- **Felts:** keep `felt` (green), `midnight` (navy) and `classic` (burgundy with gold accents), and add `royal`
  (purple), `ocean` (teal) and `onyx` (charcoal). The schema enum gets the new values; existing data keeps working.
- Each felt has a subtle **SVG noise or weave texture** so it reads as cloth, not a flat gradient.
- The machine form shows round felt swatches with a live preview, and the setting moves into the "Look" step. Changing
  the felt on a machine with an open session applies at once: appearance is not part of the frozen terms, unlike pay
  table, coins and denomination.
- Also apply or remove the unused `speed` setting (relaxed/normal/fast). It should control deal and draw animation
  timing; otherwise remove it from the form.

---

## Part B — Other problems found in review

| # | Problem | Fix |
|---|---|---|
| B1 | The session page stacks "Feedback setting" and "Saved table terms" panels under the table, so the table competes with forms | Move both into a ⚙ **Table settings** popover on the table and a collapsible "Session info" section in the sidebar. Rename the feedback options: *Coach me before I draw* / *Show after the draw* / *Quiet — report only*. |
| B2 | The session heading (a 58 px machine name plus a paragraph) pushes the table below the fold on laptops | A compact session header bar: name, game, denomination, status chip, Pause and Close. On phones the table is the first thing on screen. |
| B3 | The Draw button looks disabled while a hold review is showing (screenshot: dark on dark) | Covered by F5's review state. Also fix `.btn.gold:disabled` contrast generally. |
| B4 | The machine name wraps badly in the carousel ("Deck 5 / Jacks", caused by `max-width: 70%`) | Goes away with the F8 cabinet tiles. Use text-wrap balance and truncation with a tooltip. |
| B5 | Keyboard hints and HOLD captions are tiny monospace text | Larger hold labels on cards ("HELD" chip in the accent color). Keyboard hints only on devices with a fine pointer. |
| B6 | No deal or draw animation, so hands just appear | A deal flip (staggered 40 ms), a draw-replacement flip for non-held cards, and a win count-up, all timed by the `speed` setting and turned off with reduced motion. |
| B7 | Generic system fonts and monospace everywhere make it feel like a dev tool | Bundle one display font and one UI font (self-hosted, so it works offline in the PWA). Use tabular numerals instead of monospace for money. Keep monospace only for real code-like data. |
| B8 | The header says "PRIVATE · ON THIS DEVICE" and the footer repeats it | Covered by F7. |
| B9 | The open-sessions rail shows "No open tables" and a CTRL hint even when empty | Hide the rail when there are no open sessions. Show the shortcut hint as a tooltip. |
| B10 | The Statistics and Wallets pages use the same panel style, which is functional but plain | Second pass after Phase 3: chart theming to match the felts, mini cards in the confusion pairs, wallet cards as chip stacks. |
| B11 | There is no visual empty state or onboarding | Welcome card with illustration → bankroll amount → "Pick your first machine" (the floor, with starter suggestions such as 9/6 JoB and DDB). |

---

## Part C — Graphical assets to create

All assets are original, made in-repo as SVG (or CSS), themeable through CSS custom properties, and bundled for offline
PWA use. They do not copy any real manufacturer's cabinet, card art or branding.

| Asset | Description | Location |
|---|---|---|
| **Card faces** | SVG `<CardFace rank suit size>`: corner index, pip layouts for A–10, and original simple court art for J/Q/K (geometric, two-tone, tinted by suit color). Sizes: `lg` table, `md` multi-line, `sm` feedback, `xs` stats. | `apps/web/src/assets/cards/` + `components/CardFace.tsx` |
| **Card back** | Patterned SVG back that takes the felt accent color. Used for deal and draw flips and for empty line slots. | `assets/cards/back.svg` |
| **Suit glyphs** | Four custom SVG suit shapes (cleaner than font glyphs, which render differently on each OS). | `assets/cards/suits.tsx` |
| **Felt textures** | Six felt tokens plus one tileable SVG noise/weave overlay (`feTurbulence`, tiny file). | `styles/felts.css`, `assets/felt-texture.svg` |
| **Machine cabinet** | One parameterized SVG cabinet: marquee, bezel, screen area (HTML overlay for text), button deck and a base. Tinted by felt. Variants: tile (floor) and "new machine" outline (dashed, + icon). | `components/MachineCabinet.tsx` |
| **Game family badges** | A small emblem per family (Jacks or Better, Bonus, Double Bonus, Double Double Bonus, Bonus Poker Deluxe, Deuces Wild…) for game tiles and marquees. | `assets/families/*.svg` |
| **Feedback marks** | "Optimal ✓" stamp, ✗ "Stronger hold" mark, warning badge, and a gold-shimmer keyframe for held cards. | `assets/feedback/`, `styles/animations.css` |
| **Win treatments** | Hand-name banner, winning pay-row highlight, and a subtle coin-sparkle burst for large wins (four of a kind and up). | `components/WinBanner.tsx` |
| **Icon set** | About 20 stroke icons sharing one grid: deal, draw, hold, play, drill, pause, close, settings, wallet, chart, info, check, x, warning, more (⋯), plus, edit, duplicate, trash, backup. Inline SVG components, no icon font. | `components/icons.tsx` |
| **Chip / credit icon** | A small casino-chip glyph used in credit meters and wallet totals. | `components/icons.tsx` |
| **Illustrations** | Empty states: empty floor (no machines), no sessions, no statistics yet; welcome hero. A simple two-tone style matching the cabinet. | `assets/illustrations/` |
| **App icon refresh** | Redraw `public/icon.svg` and add PWA maskable PNG icons (192/512) plus an Apple touch icon, to prepare for the Capacitor/iOS phase. | `apps/web/public/` |

---

## Part D — Foundations to build first

1. **Design tokens:** colors (paper, ink and felt sets), suit colors, spacing scale, radius, elevation, motion
   durations, and type scale, all in `styles/tokens.css`. Today about 400 lines of ad-hoc hex values sit in
   `styles.css`; split it into `tokens.css`, `components.css` and per-page files.
2. **UI primitives:** `Button` (with icon and loading state), `IconButton`, `Segmented`, `SwatchPicker`, `Menu`
   (⋯ dropdown), `Toast`, `ConfirmDialog`, `Drawer`/`Disclosure`, `Badge`/`Chip`, `Tooltip`, `CoinAmount`, `CardFace`.
   *Status:* built in Phase 2 except `Menu` (arrives with the machine tiles in Phase 4, its first use) and
   `CardFace` (Phase 3, with the card art).
3. **Split `App.tsx`** (about 30 KB, which holds every modal and handler): move the machine wizard, wallet dialogs and
   session actions into their own modules and hooks (`useSessionActions`, `useMachineEditor`). This is not cosmetic: it
   makes the changes above much safer to make.
4. **Visual regression:** add Playwright screenshot tests for the key states (floor, empty floor, new machine sheet,
   dealt hand, optimal feedback, suboptimal feedback, warn review, multi-line settlement for 3 and 10 lines, each felt,
   mobile 390 px). The existing e2e tests match on button names such as "Prepare session" and "Create play-money
   wallet", so they will need updating along with the copy changes.

---

## Part E — Build order

Each phase can ship on its own and leaves the app better than before.

| Phase | Scope | Items |
|---|---|---|
| **1. Quick wins** (small) ✅ done | Fix the suit-color CSS bug and the faded completed cards; apply felt tokens to the table and background; replace `window.confirm` with `ConfirmDialog`; toasts plus deleting redundant notices; copy pass for play-money and over-explaining text. | F1, F2, F3 (color fix), F7, F10 (apply), B3, B9 |
| **2. Foundations** ✅ done | Tokens, primitives, icon set, fonts, `App.tsx` split, `CoinAmount` everywhere in sessions. | Part D, F4 (sessions) |
| **3. The table** ✅ done | `CardFace` SVG cards and back; machine-screen layout with pay table marquee, multi-line rows and credit meter; three-level feedback; warn-review state; deal/draw/win animations; table settings popover; compact session header. | F3, F5, F6, B1, B2, B5, B6 |
| **4. The floor** ✅ done | Cabinet SVG and floor grid; one-click Play/Drill; new-machine sheet with live preview, segmented controls and felt swatches; auto bankroll and welcome flow; new felts. | F8, F10 (new felts), B4, B11 |
| **5. Custom pay tables** ✅ done | Worker lookup of custom tables; pay table editor with quick-fill, paste, validation and live return; Settings pay table list. | F9 |
| **6. Statistics in dollars and polish** | Dollar EV in Statistics; aggregate denomination migration (Dexie v4); denomination filter; chart theming; four-color deck setting; app icons. | F4 (stats), B10, Part C icons |

---

## Decisions (confirmed)

1. **Deck colors:** classic red/black by default. A four-color deck is an option in Settings.
2. **Play click:** Play skips the session dialog and uses the machine's default wallet. The dialog appears only when
   there is a real choice to make (no wallet, or not enough balance).
3. **Disclaimer placement:** the welcome card, the Create wallet dialog and the footer. The footer stays.
4. **Feedback detail:** after a suboptimal hold, the details drawer opens by default. After an optimal hold it stays
   closed, behind the ⓘ toggle.

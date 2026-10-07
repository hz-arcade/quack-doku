# Quack-doku · 鸭鸭数独

A cozy logic puzzle with rubber ducks. Place one duck in every row, every column and every
colour region, and no two ducks may touch, not even diagonally. Every puzzle has exactly one
answer and can be solved by pure logic, without guessing. The rules are those of the "Queens"
puzzle family; the levels, art, sounds and text here are all original.

**Play:** https://arcade.hz.ax/quack-doku/

- **400 levels**, from 5×5 up to 10×10. Levels 1–3 are gentle tutorials. The next three
  unsolved levels are always open, so one tough puzzle never blocks the way.
- **Daily Duck.** A new puzzle every day at 00:00 UTC, the same for everyone. It grows through
  the week: 7×7 on Monday and Tuesday, 8×8 on Wednesday and Thursday, 9×9 on Friday and
  Saturday, 10×10 on Sunday. Solving on the day keeps your streak; past days stay playable.
- **Controls.** Tap a cell to mark an X, tap again to clear it. Double-tap (or right-click)
  to place a duck. Swipe across cells to mark many Xs. Keyboard: arrows move, `Space` marks,
  `Enter` places a duck, `Z` undoes, `H` gives a hint.
- **Hints that teach.** A hint first points out wrong marks, then explains the next logical
  step in words ("the pink region only has free cells in row 3, so…") and highlights it on
  the board. **Show me** carries it out.
- **Settings.** Auto-cross (X the cells a duck rules out), timer, colour patterns for
  colour-blind players, sound and vibration.
- **Languages.** English, 简体中文, 繁體中文 and Español; `?lang=zh-TW` picks one.
  The Taiwan table says 橫列/直行 for row/column, because 行 and 列 swap meaning there.
- **Installable.** It is a PWA and works offline once loaded.

## How the puzzles are made

Puzzles are generated once by `node scripts/puzzles.ts` and committed under `puzzles/`. Every
slot has its own seed, so regenerating one never changes another, and published puzzles never
change.

1. **Plant a solution:** a random permutation with no two ducks touching.
2. **Grow regions** from each duck with skewed weights, giving big and small, blobby and
   snaky shapes.
3. **Repair:** while other solutions exist, move a cell that those solutions use into a
   neighbouring region (it then holds two of their ducks, which kills them), carrying along
   any piece it cut off.
4. **Smooth** ragged borders, then **hill-climb** with border moves until the difficulty lands
   in the slot's band.

The logic engine (`src/engine/logic.ts`) solves like a person would, easiest step first:
singles, *confine* (a region squeezed into one row clears the rest of that row), *block*
(cells every candidate of a unit rules out), *pigeonhole* (k regions inside k rows) and short
*what-if* chains. It grades puzzles for the ladder in `src/engine/ladder.ts`, and the same code
writes the hints. `npm test` re-checks every packed puzzle (unique solution, solvable within
its stored technique, score in band) and replays hints from an empty board to the end on all
of them.

```sh
node scripts/puzzles.ts --daily-until 2029-06-30   # extend the daily pack (appends only)
node scripts/puzzles.ts --only-level 42 --force    # regenerate one level (avoid once published)
```

A test warns when fewer than 180 days of dailies are left and fails below 60. Past the end
of the pack, a day reuses an earlier one of the same weekday, rotated or mirrored.

## Develop

```sh
npm install
npm run dev        # http://localhost:5187/quack-doku/
npm test           # vitest: solver, generator, packs, hints, gestures, saves, rules, i18n
npm run build      # tsc + vite → dist/
npm run smoke      # headless Chromium on desktop and phone, screenshots to /tmp
npm run assets     # regenerate icons, iOS launch screens and cover.png into public/
                   # (ONLY=cover npm run assets for just the link-preview image)

npm run scores:dev # the leaderboard Worker locally on :8795 (npm run dev talks to it)
npm run scores:e2e # API checks against a throwaway local Worker
npm run smoke:lb   # the leaderboard in a browser against a throwaway local Worker
```

The browser scripts expect Playwright's Chromium in `~/.cache/ms-playwright/chromium-1223`
(override with `CHROME_PATH`). They use their own ports (4187–4189, 8795–8798), so other
projects' preview servers can keep running. Add `?test` to the URL to expose solution helpers
on `window.__game` for automated tests.

Pushes to `main` deploy through GitHub Actions to GitHub Pages.

## Daily leaderboard

The fastest Daily Duck solves of each day live in a small Cloudflare Worker (`worker/`) backed
by one SQLite Durable Object, which fits the free tier. The game stays a static site.

**Setup.** Add two repository secrets, then re-run the workflow. Until they exist the Worker
job is skipped and the game is published without any leaderboard UI.

```sh
gh secret set CLOUDFLARE_API_TOKEN   # a token from the "Edit Cloudflare Workers" template
gh secret set CLOUDFLARE_ACCOUNT_ID
gh workflow run deploy.yml
```

The workflow deploys the Worker and bakes its address into the build as `VITE_SCORES_URL`.
The repository variable `SCORES_URL` fills in when the Worker job reports no address (for a
custom domain, say).

**What counts.** Only a solve finished on the puzzle's own UTC day, without hints, can be
submitted, once. The submission carries the solution found; the Worker checks it against
`shared/dailyAnswers.ts` (generated with the packs) and rejects wrong answers, other days
(two hours of clock slack either side of midnight), times under 300 ms per duck, duplicates,
floods and requests from other websites. Times are measured in the player's browser, so a
believable invented time cannot be told apart.

**What is stored.** The name as entered (cleaned of invisible characters, at most 16
characters), the time, the day and when it was submitted. No account, cookie or device id;
for rate limiting the Worker keeps a salted, truncated hash of the network address for a day.
Boards of the last 7 days can be read. Older days keep their 50 fastest rows after 30 days.

**Removing an entry.** Set `SCORES_ADMIN_TOKEN`, re-run the workflow, then
`curl -X DELETE -H "Authorization: Bearer $TOKEN" https://<worker>/daily/<id>`. Without that
secret the route does not exist.

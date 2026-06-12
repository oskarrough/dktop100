# TOP100

Website for DR's TOP100 — the 100 best Danish songs, voted by the listeners (2026).

DR invited Danes to help compile a shared top 100 of the best Danish songs ever. The goal was not only the final list but also conversation about music, different tastes, and Danish song heritage. The chart was revealed in stages; the last 20 slots were the songs that received the most votes.

The list was built in three steps. Listeners on DR's music channels (P2, P3, P4, P5, P6, P8) suggested Danish songs that deserved a place. Those nominations were narrowed to 400 tracks, and Danes then voted for their five favorites on dr.dk. All votes were tallied to produce Danes' Top100.

## Data (fixed snapshot)

DR's pages are saved once (`raw.html`, `raw400.html`) and will not be updated — this is a historical snapshot (chart ranks 21–100 in the saved reveal HTML; top 20 were never captured).

Two JSON files, built from two different pages:

- **`top100.json`** — chart (`scripts/parse-chart-html-to-json.py` ← `raw.html`): rank, fun fact, credits, cover, 30s mp3 snippet. Used by the site.
- **`top400.json`** — voting shortlist (`scripts/parse-shortlist-html-to-json.py` ← `raw400.html`): all 400 nominees in page order. Chart songs are the same DR ids as in `top100.json`; run `scripts/annotate-shortlist-from-chart.py` once to set `in_top100`, `rank`, and copy fun facts onto those rows.

YouTube URLs (Radio4000 + full playback): `python3 scripts/enrich-songs-with-youtube.py` on `top100.json` → `radio4000-tracks.json`; `--input top400.json` → `radio4000-tracks-top400.json`. Uses `yt-dlp` search; skips existing urls and reuses peer/id/query lookups so each track is fetched at most once. Converters preserve existing `youtube` fields by song id if you re-run them. DR mp3 snippets work for instant previews meanwhile.

### Radio4000 (r4 CLI)

Auth once: `r4 auth login`. Channel: `dktop100`. Tracks: `radio4000-tracks.json` (from `scripts/enrich-songs-with-youtube.py`).

Radio4000 orders tracks by `created_at` DESC (newest first). For a countdown chart (#100 at top, #1 at bottom), **do not** bulk-create tracks in chart order — each new track jumps to the top. Use the placeholder strategy in `scripts/seed-radio4000-placeholders.py`:

1. Create placeholders **#1 first → #100 last** (ascending rank). Oldest slot = #1 (bottom), newest = #100 (top).
2. **UPDATE** each slot with real title/URL from `radio4000-tracks.json`. `r4 track update` changes title/url/description but **preserves `created_at`**, so order stays fixed.

```bash
python3 scripts/seed-radio4000-placeholders.py status              # check current order
python3 scripts/seed-radio4000-placeholders.py test-created-at     # verify update keeps created_at
python3 scripts/seed-radio4000-placeholders.py reset --dry-run     # preview full re-seed
python3 scripts/seed-radio4000-placeholders.py reset --confirm     # delete all → seed 100 → fill from JSON
python3 scripts/seed-radio4000-placeholders.py fill --confirm      # update slots after manual seed
```

Re-run `fill --confirm` after `scripts/enrich-songs-with-youtube.py` fills more YouTube URLs. Ranks without URLs stay as placeholders until filled.

## Dev

`bun run dev` — local preview at http://localhost:5173 (Vite).

## The site

Static, accessible HTML list as the base (done, `index.html`), cool layer on top:

- Canvas/WebGL field of 100 covers — zoomable, drifting; click to focus + play.
- Scroll countdown #100 → #1, big typography.
- Scroll-driven reveal (canvas/three.js): covers emerge one by one through masks/frames as you scroll — shader wipes, shapes cutting the cover out of black, frames that scale/rotate into place. Scroll position = playhead; works with the countdown idea.
- Reveal effects are **pluggable**: one small interface (e.g. `effect(ctx, cover, progress 0–1)`), effects in `effects/*.js`. Mix per track, pick randomly, or let the user switch. Easy to add new ones without touching the core scroll/render loop.
- Filters: decade, artist, shuffle. Fun facts on flip/hover.
- Global sticky player: play/pause, prev/next, shuffle, radio mode (autoplay the chart). Queue = current view. Keyboard: space/←/→.

## Voting / your TOPx

- **Your TOPx**: pick your top 10, localStorage + share via URL hash — no backend.
- **Compare** vs official ranking ("you agree 34%").
- **This-or-that**: pairwise picks → personal Elo ranking. Local-only.
- **Global re-vote** (later): aggregate into a "people's recount" via the Worker.

## Stack

All-in Cloudflare Workers, nothing else: one Worker serves static assets + the vote API. KV for vote counters (D1 if we need real queries). Deploy with `wrangler`.

Vote abuse: unsolvable for anonymous voting, stakes are zero — aim for "not embarrassing": Turnstile (verify in Worker), per-IP rate limiting, percentages over raw counts, pairwise voting is hard to game. Accept the rest.

## TODO

- [x] Parse raw.html → top100.json
- [x] Basic accessible HTML list
- [x] Fixed snapshot (ranks 21–100; no live DR updates)
- [ ] Global player bar
- [ ] Your-TOPx picker + share URL
- [ ] Download cover images locally
- [x] Find YouTube URLs for all tracks (`scripts/enrich-songs-with-youtube.py`)
- [x] Prototype the canvas exploration (list/canvas views in index.html)

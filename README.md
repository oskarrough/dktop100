# DKTOP100

Unofficial player for DR's TOP100 — the 100 best Danish songs, voted by the listeners (2026).

https://dktop100.0sk.ar
https://radio4000.com/dktop100

## Voting process

dr.dk invited to help compile a shared top 100 of the best Danish songs ever. The goal was a conversation about music, different tastes, and Danish song heritage.

The list was built in three steps. Listeners on DR's music channels (P2, P3, P4, P5, P6, P8) suggested Danish songs that deserved a place. Those nominations were narrowed to 400 tracks, and Danes then voted for their five favorites on dr.dk. All votes were tallied to produce this top 100.

## Data

Fixed snapshot — will never be updated. It went like this

- scrape dr.dk for the 400 songs
- convert to JSON
- enhance with mp3 links, youtube urls

See `top100.json` and `top400.json` (the first 100 are duplicated in this one)

YouTube URLs (Radio4000 + full playback): `python3 scripts/enrich-songs-with-youtube.py` on `top100.json` → `radio4000-tracks.json`; `--input top400.json` → `radio4000-tracks-top400.json`. Uses `yt-dlp` search; skips existing urls and reuses peer/id/query lookups so each track is fetched at most once. Converters preserve existing `youtube` fields by song id if you re-run them. DR mp3 snippets work for instant previews meanwhile.

### Radio4000 (r4 CLI)

Auth once: `r4 auth login`. Channel: `dktop100`. Tracks: `radio4000-tracks.json` (from `scripts/enrich-songs-with-youtube.py`).

Radio4000 orders tracks by `created_at` DESC (newest first). For a countdown chart (#100 at top, #1 at bottom), **do not** bulk-create tracks in chart order — each new track jumps to the top. Use the placeholder strategy in `scripts/seed-radio4000-placeholders.py`:

1. Create placeholders **#1 first → #100 last** (ascending rank). Oldest slot = #1 (bottom), newest = #100 (top).
2. **UPDATE** each slot with real title/URL from `radio4000-tracks.json` (rank is in the title; description stays empty). `r4 track update` changes title/url/description but **preserves `created_at`**, so order stays fixed.

```bash
python3 scripts/seed-radio4000-placeholders.py status              # check current order
python3 scripts/seed-radio4000-placeholders.py test-created-at     # verify update keeps created_at
python3 scripts/seed-radio4000-placeholders.py reset --dry-run     # preview full re-seed
python3 scripts/seed-radio4000-placeholders.py reset --confirm     # delete all → seed 100 → fill from JSON
python3 scripts/seed-radio4000-placeholders.py fill --confirm      # update slots after manual seed
```

Re-run `fill --confirm` after `scripts/enrich-songs-with-youtube.py` fills more YouTube URLs. Ranks without URLs stay as placeholders until filled.

## Stack

All-in Cloudflare Workers, nothing else: one Worker serves static assets + the vote API. KV for vote counters (D1 if we need real queries). Deploy with `wrangler`. Vote abuse: unsolvable for anonymous voting, stakes are zero — aim for "not embarrassing": Turnstile (verify in Worker), per-IP rate limiting, percentages over raw counts, pairwise voting is hard to game. Accept the rest.

`bun run dev` — local preview at [http://localhost:5173](http://localhost:5173)

## TODO

- [x] Parse raw.html → top100.json
- [x] Basic accessible HTML list
- [x] Fixed snapshot (ranks 1–100; no live DR updates)
- [x] Global player bar
- [ ] Your-TOPx picker + share URL
- [ ] Download cover images locally
- [ ] Download tracks locally? May we? Maybe, it's only 30 secs of each.
- [x] Find YouTube URLs for all tracks (`scripts/enrich-songs-with-youtube.py`)
- [x] Prototype the canvas exploration (list/canvas views in index.html)

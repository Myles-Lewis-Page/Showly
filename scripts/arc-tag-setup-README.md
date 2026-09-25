# One Piece saga/arc/tag setup script

`arc-tag-setup.js` connects directly to your Postgres DB and to TMDB
(same env vars your app already uses) and:

1. Fetches One Piece's real TMDB season/episode structure and builds a map
   from absolute episode number (1, 2, 3... across the whole series) to
   TMDB's actual `(season_number, episode_number)` pairs — recomputed live
   every run, nothing about TMDB's season boundaries is hardcoded.
2. Groups episodes into Saga (display season) / Arc (display sub-season)
   using `episode_display`. Arcs with non-contiguous episode ranges (e.g.
   Enies Lobby: 264–290, 293–302, 304–312, since other arcs' episodes are
   interleaved) are handled correctly, numbered continuously across all
   their ranges. Any range crossing a raw TMDB season boundary is also
   split automatically.
3. Tags every episode Canon / Filler / Special using `episode_tags`, based
   on the classification each arc carries in the data below.

Both steps use the same `ON CONFLICT` upsert logic as the app's own
`/api/display/bulk` and `/api/tags/bulk` endpoints, so it's safe to re-run.

## Data source

Saga/arc names, episode ranges, and canon/filler/special classification
were transcribed directly from wikihow.com/One-Piece-Anime-Arcs. Arcs
marked on that page as "(Cover page serial)" — self-contained manga
side-stories that ran in the corner of unrelated chapters rather than the
main narrative (e.g. Buggy's Crew Adventure Chronicles, Diary of
Koby-Meppo, Straw Hat's Separation) — are tagged **Special** here,
alongside the official crossovers/recaps, since neither is mainline canon
nor anime-original filler.

The arc list is a complete, gap-free partition of episodes 1–1085 (East
Blue through Wano). Egghead and Elbaph are each a single open-ended arc,
clamped at runtime to whatever TMDB actually has aired — you can split
those further later as more of the Final Saga airs.

## Requirements

- Node 18+ (needs built-in `fetch`)
- `pg` installed (`npm install pg` if not already in your project)

## Usage

```
DATABASE_URL=postgres://...  TMDB_TOKEN=...  node arc-tag-setup.js --dry-run
```

Review the printed plan (which saga/part each arc lands in, its tag, and
the raw TMDB `S{season}E{ep}` ranges it maps to), then actually write it:

```
DATABASE_URL=postgres://...  TMDB_TOKEN=...  node arc-tag-setup.js --apply
```

## Optional env vars

- `USER_ID` — which Showly account to write under (default: `admin`)
- `SHOW_TMDB_ID` — override the TMDB show id (default: `37854`)

## Notes

- **TMDB's episode numbering can be scrambled.** For at least part of One
  Piece's season 1, TMDB's own `episode_number` field doesn't match real
  broadcast order (an episode that actually aired 6th is filed under episode
  45 in TMDB's data). The script sorts by `air_date` instead of trusting
  `episode_number` for chronological order, so this is handled automatically
  — but if you see an episode that looks out of place after running this,
  it could be a similar TMDB data quirk elsewhere in the season list.
- If any individual episode's arc or tag looks off after running this, fix
  it directly in the app, nothing here is meant to be perfect. The ⚙️
  button on each episode row reassigns its season/part, and 🏷️ edits its
  tags.
- Re-running is safe: it upserts, it won't create duplicates. If you're
  re-running after a logic fix (like the air_date change above) and want to
  make sure no stale, incorrectly-classified rows are left behind, add
  `--reset` to clear this show's existing rows before writing fresh ones.
- The script prints a warning if it finds any aired episode not covered by
  the arc list (shouldn't happen — the list was checked to fully cover
  1–1085 with no gaps and no overlaps).

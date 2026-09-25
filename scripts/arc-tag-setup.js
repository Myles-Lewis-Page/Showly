#!/usr/bin/env node
/**
 * One Piece saga/arc/tag setup for Showly.
 *
 * Connects directly to your Postgres DB and to TMDB (same env vars your app
 * already uses) — no login/HTTP calls to your running server needed.
 *
 * 1. Fetches One Piece's real TMDB season/episode structure and builds a map
 *    from "absolute" episode number (1, 2, 3... across the whole series) to
 *    TMDB's actual (season_number, episode_number) pairs — computed live
 *    every run, nothing about TMDB's season boundaries is hardcoded.
 * 2. GROUPING: each arc below becomes one display_season/display_sub_season
 *    (saga = season, arc = part) via episode_display. Arcs whose absolute
 *    episode ranges are non-contiguous (e.g. Enies Lobby: 264–290, 293–302,
 *    304–312, because other arcs' episodes are interleaved) are handled as
 *    multiple ranges under the same arc, numbered continuously. Any range
 *    that crosses a raw TMDB season boundary is also split automatically.
 * 3. TAGGING: every arc also carries a Canon/Filler/Special tag, applied via
 *    episode_tags to every episode in its range(s). Anything left uncovered
 *    (shouldn't happen — the arc list below is a complete, gap-free
 *    partition of episodes 1–1085 plus Egghead/Elbaph) falls back to Canon.
 *
 * Both steps use the same ON CONFLICT upsert logic as the app's own
 * /api/display/bulk and /api/tags/bulk endpoints, so re-running is safe.
 *
 * Source: saga/arc names, episode ranges, and canon/filler/special
 * classification transcribed directly from wikihow.com/One-Piece-Anime-Arcs
 * (screenshots reviewed manually). "(Cover page serial)" arcs — self-
 * contained manga side-stories that ran in the corner of unrelated chapters,
 * rather than the main narrative — are tagged Special alongside the
 * official crossover/recap specials, since neither is mainline canon nor
 * anime-original filler.
 *
 * USAGE:
 *   DATABASE_URL=postgres://...  TMDB_TOKEN=...  node arc-tag-setup.js --dry-run
 *   DATABASE_URL=postgres://...  TMDB_TOKEN=...  node arc-tag-setup.js --apply
 *
 * Optional env vars:
 *   USER_ID            which Showly user_id to write under (default: admin)
 *   SHOW_TMDB_ID  override the TMDB show id (default: 37854)
 */

const { Pool } = require('pg');

const TMDB_ID = parseInt(process.env.SHOW_TMDB_ID || '37854'); // default show: One Piece — override with SHOW_TMDB_ID for a different show
const USER_ID = process.env.USER_ID || 'admin';
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_TOKEN = process.env.TMDB_TOKEN;
const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }
if (!TMDB_TOKEN) { console.error('Set TMDB_TOKEN'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function tmdb(endpoint) {
  const r = await fetch(`${TMDB}${endpoint}?language=en-US`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } });
  if (!r.ok) throw new Error(`TMDB ${endpoint} -> ${r.status}`);
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────
// SAGA / ARC / TAG data. `ranges` are ABSOLUTE episode numbers (episode
// "629" as fans count it), not TMDB's per-season numbering — the script
// converts these using TMDB's real live season structure. A gap-free
// partition of episodes 1–1085, plus Egghead/Elbaph as open-ended arcs.
// ─────────────────────────────────────────────────────────────────────────
const SAGAS = [
  { name: 'East Blue Saga', arcs: [
    { name: 'Romance Dawn', tag: 'Canon', ranges: [[1,3]] },
    { name: 'Orange Town', tag: 'Canon', ranges: [[4,8]] },
    { name: 'Syrup Village', tag: 'Canon', ranges: [[9,18]] },
    { name: 'Baratie', tag: 'Canon', ranges: [[19,30]] },
    { name: 'Arlong Park', tag: 'Canon', ranges: [[31,44]] },
    { name: 'Loguetown', tag: 'Canon', ranges: [[45,45],[48,53]] },
    { name: "Buggy's Crew Adventure Chronicles", tag: 'Special', ranges: [[46,47]] },
    { name: 'Warship Island', tag: 'Filler', ranges: [[54,60]] },
  ]},
  { name: 'Alabasta Saga', arcs: [
    { name: 'Reverse Mountain', tag: 'Canon', ranges: [[61,63]] }, // 61 folded in to close the East Blue -> Alabasta gap
    { name: 'Whisky Peak', tag: 'Canon', ranges: [[64,67]] },
    { name: 'Diary of Koby-Meppo', tag: 'Special', ranges: [[68,69]] },
    { name: 'Little Garden', tag: 'Canon', ranges: [[70,77]] },
    { name: 'Drum Island', tag: 'Canon', ranges: [[78,91]] },
    { name: 'Alabasta', tag: 'Canon', ranges: [[92,130]] },
    { name: 'Post-Alabasta', tag: 'Filler', ranges: [[131,135]] },
  ]},
  { name: 'Sky Island Saga', arcs: [
    { name: 'Goat Island', tag: 'Filler', ranges: [[136,138]] },
    { name: 'Reluka Island', tag: 'Filler', ranges: [[139,143]] },
    { name: 'Jaya', tag: 'Canon', ranges: [[144,152]] },
    { name: 'Skypiea', tag: 'Canon', ranges: [[153,195]] },
    { name: 'G-8', tag: 'Filler', ranges: [[196,206]] },
  ]},
  { name: 'Water 7 Saga', arcs: [
    { name: 'Long Ring Long Land', tag: 'Canon', ranges: [[207,219]] },
    { name: "Ocean's Dream", tag: 'Filler', ranges: [[220,224]] },
    { name: "Foxy's Return", tag: 'Filler', ranges: [[225,228]] },
    { name: 'Water 7', tag: 'Canon', ranges: [[229,263]] },
    { name: 'Enies Lobby', tag: 'Canon', ranges: [[264,290],[293,302],[304,312]] },
    { name: 'Boss Luffy Historical Special', tag: 'Special', ranges: [[291,292],[303,303],[406,407]] },
    { name: 'Post-Enies Lobby', tag: 'Canon', ranges: [[313,325]] },
  ]},
  { name: 'Thriller Bark Saga', arcs: [
    { name: 'Ice Hunter', tag: 'Filler', ranges: [[326,335]] },
    { name: 'Chopper Man Special', tag: 'Special', ranges: [[336,336]] },
    { name: 'Thriller Bark', tag: 'Canon', ranges: [[337,381]] },
    { name: 'Spa Island', tag: 'Filler', ranges: [[382,384]] },
  ]},
  { name: 'Summit War Saga', arcs: [
    { name: 'Sabaody Archipelago', tag: 'Canon', ranges: [[385,405]] },
    { name: 'Amazon Lily', tag: 'Canon', ranges: [[408,417]] },
    { name: "Straw Hat's Separation", tag: 'Special', ranges: [[418,421],[453,456]] },
    { name: 'Impel Down', tag: 'Canon', ranges: [[422,425],[430,452]] },
    { name: 'Little East Blue', tag: 'Filler', ranges: [[426,429]] },
    { name: 'Marineford', tag: 'Canon', ranges: [[457,489]] },
    { name: 'Toriko Crossover I', tag: 'Special', ranges: [[492,492]] },
    { name: 'Post-War', tag: 'Canon', ranges: [[490,491],[493,516]] },
  ]},
  { name: 'Fish-Man Island Saga', arcs: [
    { name: 'Return to Sabaody', tag: 'Canon', ranges: [[517,522]] },
    { name: 'Fish-Man Island', tag: 'Canon', ranges: [[523,541],[543,574]] },
    { name: 'Toriko Crossover II', tag: 'Special', ranges: [[542,542]] },
  ]},
  { name: 'Dressrosa Saga', arcs: [
    { name: "Z's Ambition", tag: 'Filler', ranges: [[575,578]] },
    { name: 'Punk Hazard', tag: 'Canon', ranges: [[579,589],[591,625]] },
    { name: 'Toriko & Dragon Ball Crossover', tag: 'Special', ranges: [[590,590]] },
    { name: 'Caesar Retrieval', tag: 'Filler', ranges: [[626,628]] },
    { name: 'Dressrosa', tag: 'Canon', ranges: [[629,746]] },
  ]},
  { name: 'Whole Cake Island Saga', arcs: [
    { name: 'Silver Mine', tag: 'Filler', ranges: [[747,750]] },
    { name: 'Zou', tag: 'Canon', ranges: [[751,779]] },
    { name: 'Marine Rookie', tag: 'Filler', ranges: [[780,782]] },
    { name: 'Whole Cake Island', tag: 'Canon', ranges: [[783,877]] },
    { name: 'Reverie', tag: 'Canon', ranges: [[878,889]] },
  ]},
  { name: 'Wano Country Saga', arcs: [
    { name: 'Wano Country', tag: 'Canon', ranges: [[890,894],[897,906],[908,1028],[1031,1085]] },
    { name: 'Cidre Guild', tag: 'Filler', ranges: [[895,896]] },
    { name: 'Romance Dawn Special', tag: 'Special', ranges: [[907,907]] },
    { name: "Uta's Past", tag: 'Filler', ranges: [[1029,1030]] },
  ]},
  { name: 'Final Saga', arcs: [
    { name: 'Egghead', tag: 'Canon', ranges: [[1086,1155]] },
    { name: 'Elbaph', tag: 'Canon', ranges: [[1156,1400]] }, // clamped at runtime to whatever's actually aired
  ]},
];

// ─────────────────────────────────────────────────────────────────────────

async function buildAbsoluteMap() {
  const showData = await tmdb(`/tv/${TMDB_ID}`);
  const rawSeasons = (showData.seasons || []).filter(s => s.season_number > 0).sort((a,b)=>a.season_number-b.season_number);
  const map = new Map(); // absolute -> {season_number, episode_number}
  let absolute = 0;
  for (const season of rawSeasons) {
    const seasonData = await tmdb(`/tv/${TMDB_ID}/season/${season.season_number}`);
    const episodes = (seasonData.episodes || []).sort((a,b)=>a.episode_number-b.episode_number);
    for (const ep of episodes) {
      absolute++;
      map.set(absolute, { season_number: season.season_number, episode_number: ep.episode_number });
    }
  }
  return { map, maxAbsolute: absolute, showName: showData.name };
}

// Convert one absolute from/to range into contiguous runs grouped by raw TMDB season
function toRawRuns(map, from, to) {
  const runs = [];
  let current = null;
  for (let abs = from; abs <= to; abs++) {
    const raw = map.get(abs);
    if (!raw) continue; // not aired / beyond what TMDB has yet
    if (current && current.season_number === raw.season_number && raw.episode_number === current.lastEp + 1) {
      current.lastEp = raw.episode_number;
      current.count++;
    } else {
      if (current) runs.push(current);
      current = { season_number: raw.season_number, firstEp: raw.episode_number, lastEp: raw.episode_number, count: 1 };
    }
  }
  if (current) runs.push(current);
  return runs;
}

async function upsertDisplay(season_number, from_episode, to_episode, display_season, display_sub_season, sub_season_label, start_display_episode) {
  let dispEp = start_display_episode;
  for (let ep = from_episode; ep <= to_episode; ep++) {
    await pool.query(
      `INSERT INTO episode_display
         (tmdb_id,season_number,episode_number,display_season,display_sub_season,display_episode_number,sub_season_label,is_modified,user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
       ON CONFLICT (tmdb_id,season_number,episode_number,user_id)
       DO UPDATE SET display_season=$4, display_sub_season=$5, display_episode_number=$6, sub_season_label=$7, is_modified=TRUE, updated_at=NOW()`,
      [TMDB_ID, season_number, ep, display_season, display_sub_season, dispEp, sub_season_label, USER_ID]
    );
    dispEp++;
  }
}

async function upsertTag(season_number, episode_number, tag) {
  await pool.query(
    `INSERT INTO episode_tags (tmdb_id,season_number,episode_number,tag,user_id)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tmdb_id,season_number,episode_number,tag,user_id) DO NOTHING`,
    [TMDB_ID, season_number, episode_number, tag, USER_ID]
  );
}

async function main() {
  console.log(`Fetching TMDB season structure for show ${TMDB_ID}...`);
  const { map, maxAbsolute, showName } = await buildAbsoluteMap();
  console.log(`"${showName}" — ${maxAbsolute} aired episodes found on TMDB.\n`);

  let dispSeason = 0;
  const plan = [];
  const coveredAbsolutes = new Set();
  for (const saga of SAGAS) {
    dispSeason++;
    let subSeason = 0;
    for (const arc of saga.arcs) {
      subSeason++;
      const allRuns = [];
      for (const [from, to] of arc.ranges) {
        if (from > maxAbsolute) continue;
        const clampedTo = Math.min(to, maxAbsolute);
        for (let abs = from; abs <= clampedTo; abs++) coveredAbsolutes.add(abs);
        allRuns.push(...toRawRuns(map, from, clampedTo));
      }
      if (!allRuns.length) continue;
      plan.push({ saga: saga.name, arc: arc.name, tag: arc.tag, displaySeason: dispSeason, subSeason, runs: allRuns });
    }
  }

  const tagCounts = { Canon: 0, Filler: 0, Special: 0 };
  for (const p of plan) for (const r of p.runs) tagCounts[p.tag] += r.count;

  const uncovered = [];
  for (let abs = 1; abs <= maxAbsolute; abs++) if (!coveredAbsolutes.has(abs)) uncovered.push(abs);

  console.log(`Grouping plan: ${plan.length} arcs across ${dispSeason} sagas.`);
  console.log(`Tag plan: Canon ${tagCounts.Canon}, Filler ${tagCounts.Filler}, Special ${tagCounts.Special}.`);
  if (uncovered.length) console.log(`⚠ ${uncovered.length} aired episodes aren't covered by any arc (will fall back to Canon-only, no grouping): ${uncovered.slice(0,20).join(',')}${uncovered.length>20?'...':''}`);
  console.log('');

  if (!APPLY) {
    console.log('--- DRY RUN (pass --apply to actually write) ---\n');
    for (const p of plan) {
      const runStr = p.runs.map(r => `S${r.season_number}E${r.firstEp}${r.count>1?`-${r.lastEp}`:''}`).join(', ');
      console.log(`Season ${p.displaySeason} Part ${p.subSeason} — "${p.arc}" [${p.tag}] (${p.saga}) -> ${runStr}`);
    }
    console.log(`\nWould write ${plan.reduce((s,p)=>s+p.runs.reduce((a,r)=>a+r.count,0),0)} display rows and a matching number of tag rows for user_id="${USER_ID}".`);
    return;
  }

  console.log('Applying grouping + tags...');
  let n = 0;
  const total = plan.reduce((s,p)=>s+p.runs.reduce((a,r)=>a+r.count,0),0);
  for (const p of plan) {
    let startEp = 1;
    for (const run of p.runs) {
      await upsertDisplay(run.season_number, run.firstEp, run.lastEp, p.displaySeason, p.subSeason, p.arc, startEp);
      for (let ep = run.firstEp; ep <= run.lastEp; ep++) {
        await upsertTag(run.season_number, ep, p.tag);
        n++;
      }
      startEp += run.count;
    }
    process.stdout.write(`\r  ${n}/${total}`);
  }
  console.log(`\r  ${n}/${total} done.\n`);

  if (uncovered.length) {
    console.log('Tagging safety-net Canon episodes...');
    for (const abs of uncovered) {
      const raw = map.get(abs);
      if (raw) await upsertTag(raw.season_number, raw.episode_number, 'Canon');
    }
  }

  console.log('All done. Open the show in Showly and hit "Edit Seasons" to review.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

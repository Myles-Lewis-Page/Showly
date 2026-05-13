const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_TOKEN = process.env.TMDB_TOKEN;
const TMDB = 'https://api.themoviedb.org/3';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-secret', resave: false, saveUninitialized: false, cookie: { secure: false, httpOnly: true, maxAge: 30*24*60*60*1000 } }));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shows (
      id SERIAL PRIMARY KEY, tmdb_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
      poster_path TEXT, year TEXT, overview TEXT, status TEXT NOT NULL DEFAULT 'watching',
      last_air_date TEXT, tmdb_status TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS watched_episodes (
      id SERIAL PRIMARY KEY, tmdb_id INTEGER NOT NULL, season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL, watched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tmdb_id, season_number, episode_number)
    );
  `);
  await pool.query(`
    ALTER TABLE shows DROP CONSTRAINT IF EXISTS shows_status_check;
    ALTER TABLE shows ADD CONSTRAINT shows_status_check
      CHECK (status IN ('watching','caughtup','finished','watchlist','paused','dropped'));
  `).catch(() => {});
  // Add new columns if they don't exist
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS last_air_date TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS tmdb_status TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS platform TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS genres TEXT`).catch(()=>{});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

const requireLogin = (req, res, next) => req.session?.ok ? next() : res.status(401).json({ error: 'Not logged in' });

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) { req.session.ok = true; res.json({ ok: true }); }
  else res.status(401).json({ error: 'Wrong credentials' });
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ ok: !!req.session?.ok }));

async function tmdb(endpoint, params = {}) {
  const url = new URL(TMDB + endpoint);
  url.searchParams.set('language', 'en-US');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } });
  return r.json();
}

app.get('/api/search', requireLogin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.json([]);
    const data = await tmdb('/search/tv', { query: q, include_adult: false });
    res.json((data.results || []).slice(0, 8).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date || '').slice(0, 4), overview: s.overview,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id', requireLogin, async (req, res) => {
  try {
    const [details, credits, providers] = await Promise.all([
      tmdb(`/tv/${req.params.id}`),
      tmdb(`/tv/${req.params.id}/credits`),
      tmdb(`/tv/${req.params.id}/watch/providers`),
    ]);
    const usProviders = providers.results?.US || {};
    const streamingProviders = usProviders.flatrate || usProviders.free || [];
    res.json({ ...details, credits, streaming_providers: streamingProviders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM user_settings');
    const settings = {};
    r.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', requireLogin, async (req, res) => {
  try {
    const { key, value } = req.body;
    await pool.query(
      'INSERT INTO user_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      [key, value]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id/providers', requireLogin, async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}/watch/providers`);
    const us = data.results?.US || {};
    const providers = (us.flatrate || us.free || []).map(p => ({ provider_name: p.provider_name, logo_path: p.logo_path }));
    res.json(providers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id/season/:season', requireLogin, async (req, res) => {
  try { res.json(await tmdb(`/tv/${req.params.id}/season/${req.params.season}`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recommendations', requireLogin, async (req, res) => {
  try {
    const myShows = await pool.query("SELECT tmdb_id FROM shows WHERE status IN ('watching','caughtup','paused') LIMIT 5");
    const myIds = new Set((await pool.query('SELECT tmdb_id FROM shows')).rows.map(r => r.tmdb_id));
    let recs = [];
    if (myShows.rows.length) {
      for (const row of myShows.rows) { const d = await tmdb(`/tv/${row.tmdb_id}/recommendations`); recs.push(...(d.results||[])); }
    } else { recs = (await tmdb('/tv/popular')).results || []; }
    const seen = new Set();
    res.json(recs.filter(r => { if (seen.has(r.id)||myIds.has(r.id)) return false; seen.add(r.id); return true; }).slice(0,24).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date||'').slice(0,4), overview: s.overview, rating: s.vote_average,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', requireLogin, async (req, res) => {
  try {
    const showsData = await pool.query('SELECT * FROM shows');
    const epData = await pool.query('SELECT tmdb_id, COUNT(*) as ep_count FROM watched_episodes GROUP BY tmdb_id ORDER BY ep_count DESC LIMIT 10');
    res.json({ shows: showsData.rows, topEps: epData.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/next-episode/:tmdb_id', requireLogin, async (req, res) => {
  try {
    const tmdb_id = parseInt(req.params.tmdb_id);
    const watched = await pool.query('SELECT season_number, episode_number FROM watched_episodes WHERE tmdb_id=$1', [tmdb_id]);
    const watchedSet = new Set(watched.rows.map(r => `${r.season_number}_${r.episode_number}`));
    const showData = await tmdb(`/tv/${tmdb_id}`);
    const seasons = (showData.seasons||[]).filter(s => s.season_number > 0);
    const showEnded = ['Ended','Canceled','Cancelled'].includes(showData.status);
    const nextEpData = showData.next_episode_to_air;
    const lastEpData = showData.last_episode_to_air;
    const activelyReleasing = nextEpData?.air_date &&
      (new Date(nextEpData.air_date) - new Date()) <= 7*24*60*60*1000 &&
      (new Date(nextEpData.air_date) - new Date()) >= -24*60*60*1000; // within 1 day past
    const baseInfo = {
      show_ended: showEnded, first_air_date: showData.first_air_date,
      last_air_date: showData.last_air_date, tmdb_status: showData.status,
      actively_releasing: activelyReleasing,
      next_air_date: nextEpData?.air_date || null,
      next_air_season: nextEpData?.season_number || null,
      next_air_ep: nextEpData?.episode_number || null,
    };

    // First pass: collect ALL aired episodes across all seasons
    const allSeasonEps = [];
    for (const season of seasons) {
      const seasonData = await tmdb(`/tv/${tmdb_id}/season/${season.season_number}`);
      const episodes = (seasonData.episodes||[]).filter(e => e.air_date && new Date(e.air_date) <= new Date());
      allSeasonEps.push({ season_number: season.season_number, episodes });
    }
    const totalAired = allSeasonEps.reduce((sum, s) => sum + s.episodes.length, 0);

    // Second pass: find first unwatched episode
    for (const { season_number, episodes } of allSeasonEps) {
      for (const ep of episodes) {
        if (!watchedSet.has(`${season_number}_${ep.episode_number}`)) {
          // Save date/status/genre info back to shows table
          const genreStr2 = (showData.genres||[]).map(g=>g.name).join(',');
          await pool.query('UPDATE shows SET last_air_date=$1, tmdb_status=$2, genres=$3 WHERE tmdb_id=$4',
            [showData.last_air_date||null, showData.status||null, genreStr2||null, tmdb_id]).catch(()=>{});
          return res.json({
            ...baseInfo,
            season_number, episode_number: ep.episode_number,
            name: ep.name, air_date: ep.air_date, still_path: ep.still_path,
            total_watched: watchedSet.size, total_aired: totalAired,
            suggested_status: 'watching',
          });
        }
      }
    }

    // Save date/status/genre info back to shows table for instant card display
    const genreStr = (showData.genres||[]).map(g=>g.name).join(',');
    await pool.query(
      'UPDATE shows SET last_air_date=$1, tmdb_status=$2, genres=$3 WHERE tmdb_id=$4',
      [showData.last_air_date||null, showData.status||null, genreStr||null, tmdb_id]
    ).catch(()=>{});

    // All aired episodes watched
    res.json({
      ...baseInfo,
      all_watched: true, total_watched: watchedSet.size, total_aired: totalAired,
      suggested_status: showEnded ? 'finished' : 'caughtup',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shows', requireLogin, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM shows ORDER BY title ASC')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shows', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, title, poster_path, year, overview, status } = req.body;
    const r = await pool.query(
      `INSERT INTO shows (tmdb_id,title,poster_path,year,overview,status) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tmdb_id) DO UPDATE SET status=$6, updated_at=NOW() RETURNING *`,
      [tmdb_id, title, poster_path||null, year||null, overview||null, status||'watching']
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/shows/:id', requireLogin, async (req, res) => {
  try {
    const { status, platform, genres } = req.body;
    const fields = [], vals = [];
    if (status !== undefined) { fields.push(`status=$${fields.length+1}`); vals.push(status); }
    if (platform !== undefined) { fields.push(`platform=$${fields.length+1}`); vals.push(platform); }
    if (genres !== undefined) { fields.push(`genres=$${fields.length+1}`); vals.push(genres); }
    fields.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE shows SET ${fields.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shows/:id', requireLogin, async (req, res) => {
  try { await pool.query('DELETE FROM shows WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/episodes/all', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) as total FROM watched_episodes');
    res.json({ total: parseInt(r.rows[0].total) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/episodes/:tmdb_id', requireLogin, async (req, res) => {
  try { res.json((await pool.query('SELECT season_number, episode_number FROM watched_episodes WHERE tmdb_id=$1', [req.params.tmdb_id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/episodes', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episode_number } = req.body;
    await pool.query('INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [parseInt(tmdb_id), parseInt(season_number), parseInt(episode_number)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/episodes', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episode_number } = req.body;
    await pool.query('DELETE FROM watched_episodes WHERE tmdb_id=$1 AND season_number=$2 AND episode_number=$3', [parseInt(tmdb_id), parseInt(season_number), parseInt(episode_number)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/episodes/season', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episodes } = req.body;
    for (const ep of episodes) await pool.query('INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [parseInt(tmdb_id), parseInt(season_number), parseInt(ep)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/episodes/season', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM watched_episodes WHERE tmdb_id=$1 AND season_number=$2', [parseInt(req.body.tmdb_id), parseInt(req.body.season_number)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
initDB().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`))).catch(e => { console.error(e); process.exit(1); });

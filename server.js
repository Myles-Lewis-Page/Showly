const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_TOKEN = process.env.TMDB_TOKEN;
const TMDB = 'https://api.themoviedb.org/3';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shows (
      id SERIAL PRIMARY KEY,
      tmdb_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      poster_path TEXT,
      year TEXT,
      overview TEXT,
      status TEXT NOT NULL DEFAULT 'watching'
        CHECK (status IN ('watching','plan','paused','dropped')),
      added_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS watched_episodes (
      id SERIAL PRIMARY KEY,
      tmdb_id INTEGER NOT NULL,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      watched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tmdb_id, season_number, episode_number)
    );
  `);
  console.log('DB ready');
}

function requireLogin(req, res, next) {
  if (req.session?.ok) return next();
  res.status(401).json({ error: 'Not logged in' });
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.ok = true; res.json({ ok: true });
  } else { res.status(401).json({ error: 'Wrong credentials' }); }
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { res.json({ ok: !!req.session?.ok }); });

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
    const [details, credits] = await Promise.all([
      tmdb(`/tv/${req.params.id}`),
      tmdb(`/tv/${req.params.id}/credits`),
    ]);
    res.json({ ...details, credits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id/season/:season', requireLogin, async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}/season/${req.params.season}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id/season/:season/episode/:ep', requireLogin, async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}/season/${req.params.season}/episode/${req.params.ep}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recommendations', requireLogin, async (req, res) => {
  try {
    const myShows = await pool.query("SELECT tmdb_id FROM shows WHERE status IN ('watching','paused') LIMIT 5");
    const myIds = new Set((await pool.query('SELECT tmdb_id FROM shows')).rows.map(r => r.tmdb_id));
    let recs = [];
    if (myShows.rows.length) {
      for (const row of myShows.rows) {
        const data = await tmdb(`/tv/${row.tmdb_id}/recommendations`);
        recs.push(...(data.results || []));
      }
    } else {
      recs = (await tmdb('/tv/popular')).results || [];
    }
    const seen = new Set();
    res.json(recs.filter(r => {
      if (seen.has(r.id) || myIds.has(r.id)) return false;
      seen.add(r.id); return true;
    }).slice(0, 24).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date || '').slice(0, 4), overview: s.overview, rating: s.vote_average,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shows', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM shows ORDER BY updated_at DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shows', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, title, poster_path, year, overview, status } = req.body;
    const r = await pool.query(
      `INSERT INTO shows (tmdb_id, title, poster_path, year, overview, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tmdb_id) DO UPDATE SET status=$6, updated_at=NOW() RETURNING *`,
      [tmdb_id, title, poster_path||null, year||null, overview||null, status||'watching']
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/shows/:id', requireLogin, async (req, res) => {
  try {
    const { status } = req.body;
    const r = await pool.query('UPDATE shows SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shows/:id', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM shows WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/episodes/:tmdb_id', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT season_number, episode_number FROM watched_episodes WHERE tmdb_id=$1',
      [req.params.tmdb_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/episodes', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episode_number } = req.body;
    await pool.query(
      'INSERT INTO watched_episodes (tmdb_id, season_number, episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [tmdb_id, season_number, episode_number]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/episodes', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episode_number } = req.body;
    await pool.query(
      'DELETE FROM watched_episodes WHERE tmdb_id=$1 AND season_number=$2 AND episode_number=$3',
      [tmdb_id, season_number, episode_number]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/episodes/season', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episodes } = req.body;
    for (const ep of episodes) {
      await pool.query(
        'INSERT INTO watched_episodes (tmdb_id, season_number, episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [tmdb_id, season_number, ep]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/episodes/season', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number } = req.body;
    await pool.query('DELETE FROM watched_episodes WHERE tmdb_id=$1 AND season_number=$2', [tmdb_id, season_number]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
initDB().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`))).catch(e => { console.error(e); process.exit(1); });

const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_TOKEN = process.env.TMDB_TOKEN;
const TMDB_BASE = 'https://api.themoviedb.org/3';

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

// ── DB INIT ───────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
      title TEXT NOT NULL,
      poster_path TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tmdb_id, media_type)
    );
    CREATE TABLE IF NOT EXISTS watched_movies (
      id SERIAL PRIMARY KEY,
      tmdb_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      poster_path TEXT,
      rating INTEGER CHECK (rating BETWEEN 1 AND 10),
      watched_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS watched_episodes (
      id SERIAL PRIMARY KEY,
      show_tmdb_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      show_poster TEXT,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      episode_name TEXT,
      watched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(show_tmdb_id, season_number, episode_number)
    );
    CREATE TABLE IF NOT EXISTS show_status (
      id SERIAL PRIMARY KEY,
      tmdb_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      poster_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('paused','dropped')),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isLoggedIn = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => { res.json({ isLoggedIn: !!req.session?.isLoggedIn }); });

function requireLogin(req, res, next) {
  if (req.session?.isLoggedIn) return next();
  res.status(401).json({ error: 'Please log in' });
}

// ── TMDB PROXY ────────────────────────────────────────────────────────────────
async function tmdb(endpoint, params = {}) {
  const url = new URL(TMDB_BASE + endpoint);
  url.searchParams.set('language', 'en-US');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }
  });
  return res.json();
}

// Discovery
app.get('/api/tmdb/trending', async (req, res) => {
  try {
    const { type = 'all', time = 'week' } = req.query;
    const data = await tmdb(`/trending/${type}/${time}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/popular/:type', async (req, res) => {
  try {
    const data = await tmdb(`/${req.params.type}/popular`, { page: req.query.page || 1 });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/top-rated/:type', async (req, res) => {
  try {
    const data = await tmdb(`/${req.params.type}/top_rated`, { page: req.query.page || 1 });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Search
app.get('/api/tmdb/search', async (req, res) => {
  try {
    const { q, type = 'multi' } = req.query;
    if (!q) return res.json({ results: [] });
    const data = await tmdb(`/search/${type}`, { query: q, include_adult: false });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Details
app.get('/api/tmdb/movie/:id', async (req, res) => {
  try {
    const [details, credits, similar] = await Promise.all([
      tmdb(`/movie/${req.params.id}`, { append_to_response: 'videos' }),
      tmdb(`/movie/${req.params.id}/credits`),
      tmdb(`/movie/${req.params.id}/similar`),
    ]);
    res.json({ ...details, credits, similar: similar.results?.slice(0, 12) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/tv/:id', async (req, res) => {
  try {
    const [details, credits, similar] = await Promise.all([
      tmdb(`/tv/${req.params.id}`, { append_to_response: 'videos' }),
      tmdb(`/tv/${req.params.id}/credits`),
      tmdb(`/tv/${req.params.id}/similar`),
    ]);
    res.json({ ...details, credits, similar: similar.results?.slice(0, 12) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/tv/:id/season/:season', async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}/season/${req.params.season}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WATCHLIST ─────────────────────────────────────────────────────────────────
app.get('/api/watchlist', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM watchlist ORDER BY added_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/watchlist', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, media_type, title, poster_path } = req.body;
    const r = await pool.query(
      'INSERT INTO watchlist (tmdb_id, media_type, title, poster_path) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id, media_type) DO NOTHING RETURNING *',
      [tmdb_id, media_type, title, poster_path]
    );
    res.json(r.rows[0] || { exists: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/watchlist/:tmdb_id/:media_type', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM watchlist WHERE tmdb_id=$1 AND media_type=$2', [req.params.tmdb_id, req.params.media_type]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WATCHED MOVIES ────────────────────────────────────────────────────────────
app.get('/api/watched/movies', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM watched_movies ORDER BY watched_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/watched/movies', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, title, poster_path, rating } = req.body;
    const r = await pool.query(
      'INSERT INTO watched_movies (tmdb_id, title, poster_path, rating) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id) DO UPDATE SET rating=$4, watched_at=NOW() RETURNING *',
      [tmdb_id, title, poster_path, rating || null]
    );
    await pool.query('DELETE FROM watchlist WHERE tmdb_id=$1 AND media_type=$2', [tmdb_id, 'movie']);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/watched/movies/:tmdb_id', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM watched_movies WHERE tmdb_id=$1', [req.params.tmdb_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WATCHED EPISODES ──────────────────────────────────────────────────────────
app.get('/api/watched/episodes', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM watched_episodes ORDER BY watched_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watched/episodes/:show_id', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM watched_episodes WHERE show_tmdb_id=$1 ORDER BY season_number, episode_number',
      [req.params.show_id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/watched/episodes', requireLogin, async (req, res) => {
  try {
    const { show_tmdb_id, show_title, show_poster, season_number, episode_number, episode_name } = req.body;
    const r = await pool.query(
      `INSERT INTO watched_episodes (show_tmdb_id, show_title, show_poster, season_number, episode_number, episode_name)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (show_tmdb_id, season_number, episode_number) DO UPDATE SET watched_at=NOW() RETURNING *`,
      [show_tmdb_id, show_title, show_poster, season_number, episode_number, episode_name]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/watched/episodes/:show_id/:season/:episode', requireLogin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM watched_episodes WHERE show_tmdb_id=$1 AND season_number=$2 AND episode_number=$3',
      [req.params.show_id, req.params.season, req.params.episode]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark entire season
app.post('/api/watched/episodes/season', requireLogin, async (req, res) => {
  try {
    const { show_tmdb_id, show_title, show_poster, season_number, episodes } = req.body;
    for (const ep of episodes) {
      await pool.query(
        `INSERT INTO watched_episodes (show_tmdb_id, show_title, show_poster, season_number, episode_number, episode_name)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (show_tmdb_id, season_number, episode_number) DO NOTHING`,
        [show_tmdb_id, show_title, show_poster, season_number, ep.episode_number, ep.name]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SHOW STATUS ───────────────────────────────────────────────────────────────
app.get('/api/show-status', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM show_status ORDER BY updated_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/show-status', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, title, poster_path, status } = req.body;
    const r = await pool.query(
      'INSERT INTO show_status (tmdb_id, title, poster_path, status) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id) DO UPDATE SET status=$4, updated_at=NOW() RETURNING *',
      [tmdb_id, title, poster_path, status]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/show-status/:tmdb_id', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM show_status WHERE tmdb_id=$1', [req.params.tmdb_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PROFILE / STATS ───────────────────────────────────────────────────────────
app.get('/api/stats', requireLogin, async (req, res) => {
  try {
    const [movies, episodes, watchlist, ratings] = await Promise.all([
      pool.query('SELECT COUNT(*) as count, AVG(rating) as avg_rating FROM watched_movies'),
      pool.query(`SELECT COUNT(*) as count, COUNT(DISTINCT show_tmdb_id) as shows FROM watched_episodes`),
      pool.query('SELECT COUNT(*) as count FROM watchlist'),
      pool.query('SELECT * FROM show_status ORDER BY updated_at DESC'),
    ]);

    const recentMovies = await pool.query('SELECT * FROM watched_movies ORDER BY watched_at DESC LIMIT 6');
    const recentEps = await pool.query(`
      SELECT show_tmdb_id, show_title, show_poster, MAX(watched_at) as last_watched,
             COUNT(*) as ep_count, MAX(season_number) as last_season, MAX(episode_number) as last_episode
      FROM watched_episodes GROUP BY show_tmdb_id, show_title, show_poster ORDER BY last_watched DESC LIMIT 6`);

    res.json({
      movies: { count: parseInt(movies.rows[0].count), avg_rating: parseFloat(movies.rows[0].avg_rating) || 0 },
      episodes: { count: parseInt(episodes.rows[0].count), shows: parseInt(episodes.rows[0].shows) },
      watchlist: parseInt(watchlist.rows[0].count),
      showStatuses: ratings.rows,
      recentMovies: recentMovies.rows,
      recentShows: recentEps.rows,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`Showly running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });

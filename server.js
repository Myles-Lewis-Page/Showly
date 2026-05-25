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
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS last_air_date TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS tmdb_status TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS platform TEXT`).catch(()=>{});
  await pool.query(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS genres TEXT`).catch(()=>{});
  await pool.query(`
CREATE TABLE IF NOT EXISTS user_settings (key TEXT PRIMARY KEY, value TEXT);
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
    // Known streaming subscription services (flexible matching)
    const isSubscriptionService = (name) => {
      const n = name.toLowerCase().replace(/\+/g,'plus').replace(/\s+/g,' ').trim();
      return ['disney plus','disney+','apple tv plus','apple tv+','max','hulu','netflix',
        'peacock','paramount plus','paramount+','amazon prime','prime video','mgm plus','mgm+',
        'crunchyroll','amc plus','amc+','showtime','fubo','espn plus','espn+','youtube tv'
      ].some(s => n.startsWith(s.replace(/\+/g,'plus')));
    };
    const flatrate = [...(usProviders.flatrate||[]), ...(usProviders.free||[])];
    const buyRentSubs = [...(usProviders.buy||[]), ...(usProviders.rent||[])]
      .filter(p => isSubscriptionService(p.provider_name));
    const allProviders = [...flatrate, ...buyRentSubs];
    const seen = new Set();
    const streamingProviders = allProviders.filter(p => {
      const base = p.provider_name
        .replace(/\s+(with Ads?|Standard with Ads?|Standard|Basic|Premium Plus|Premium)\s*$/i, '')
        .trim();
      if (seen.has(base)) return false;
      seen.add(base);
      p.provider_name = base;
      return true;
    });
    // If no providers found, check networks and inject known ones
    const networks = (details.networks||[]).map(n=>n.name.toLowerCase());
    if(!streamingProviders.length) {
      if(networks.some(n=>n.includes('disney')||n.includes('freeform')||n.includes('nat geo')))
        streamingProviders.push({ provider_name:'Disney+', logo_path:'/7rwgEs15tFwyR9NPen12l5KvyMR.jpg' });
      else if(networks.some(n=>n.includes('hbo')||n.includes('max')))
        streamingProviders.push({ provider_name:'Max', logo_path:'/Ajqyt5aNxNx9pi2ViL1oT.jpg' });
      else if(networks.some(n=>n.includes('netflix')))
        streamingProviders.push({ provider_name:'Netflix', logo_path:'/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg' });
      else if(networks.some(n=>n.includes('hulu')))
        streamingProviders.push({ provider_name:'Hulu', logo_path:'/zxrVdFjIjLqkfnwyghnfywTn3Lh.jpg' });
      else if(networks.some(n=>n.includes('peacock')))
        streamingProviders.push({ provider_name:'Peacock', logo_path:'/8VCV78prwd9QzZnEm0ReO6bERDa.jpg' });
      else if(networks.some(n=>n.includes('paramount')))
        streamingProviders.push({ provider_name:'Paramount+', logo_path:'/h5DcR0J2EESLitnhR8xLG1QymTE.jpg' });
      else if(networks.some(n=>n.includes('apple')))
        streamingProviders.push({ provider_name:'Apple TV+', logo_path:'/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' });
      else if(networks.some(n=>n.includes('amazon')||n.includes('prime')))
        streamingProviders.push({ provider_name:'Amazon Prime', logo_path:'/dQeAar5H991VYporEjUspolDarG.jpg' });
    }
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

app.get('/api/tmdb/trending', requireLogin, async (req, res) => {
  try {
    const data = await tmdb('/trending/tv/week');
    const myIds = new Set((await pool.query('SELECT tmdb_id FROM shows')).rows.map(r => r.tmdb_id));
    res.json((data.results||[]).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date||'').slice(0,4), overview: s.overview,
      rating: s.vote_average, in_list: myIds.has(s.id),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/show/:id/similar', requireLogin, async (req, res) => {
  try {
    const myIds = new Set((await pool.query('SELECT tmdb_id FROM shows')).rows.map(r => r.tmdb_id));
    const data = await tmdb(`/tv/${req.params.id}/similar`);
    res.json((data.results||[]).slice(0,12).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date||'').slice(0,4), overview: s.overview,
      rating: s.vote_average, in_list: myIds.has(s.id),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tmdb/genres', requireLogin, async (req, res) => {
  try {
    const data = await tmdb('/genre/tv/list');
    res.json(data.genres||[]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recommendations/genre/:genre_id', requireLogin, async (req, res) => {
  try {
    const myIds = new Set((await pool.query('SELECT tmdb_id FROM shows')).rows.map(r => r.tmdb_id));
    const data = await tmdb('/discover/tv', { with_genres: req.params.genre_id, sort_by: 'popularity.desc', 'vote_count.gte': 100 });
    res.json((data.results||[]).filter(r => !myIds.has(r.id)).slice(0,24).map(s => ({
      tmdb_id: s.id, title: s.name, poster_path: s.poster_path,
      year: (s.first_air_date||'').slice(0,4), overview: s.overview, rating: s.vote_average,
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});



app.get('/api/tmdb/show/:id/providers', requireLogin, async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}/watch/providers`);
    const us = data.results?.US || {};
    const isSubscriptionService = (name) => {
      const n = name.toLowerCase().replace(/\+/g,'plus').replace(/\s+/g,' ').trim();
      return ['disney plus','apple tv plus','max','hulu','netflix','peacock',
        'paramount plus','amazon prime','prime video','mgm plus','crunchyroll',
        'amc plus','showtime','fubo','espn plus','youtube tv'
      ].some(s => n.startsWith(s));
    };
    const flatrate = [...(us.flatrate||[]), ...(us.free||[])];
    const buyRentSubs = [...(us.buy||[]), ...(us.rent||[])]
      .filter(p => isSubscriptionService(p.provider_name));
    const allProviders = [...flatrate, ...buyRentSubs];
    const seen = new Set();
    const providers = allProviders.filter(p => {
      const base = p.provider_name
        .replace(/\s+(with Ads?|Standard with Ads?|Standard|Basic|Premium Plus|Premium)\s*$/i, '')
        .trim();
      if (seen.has(base)) return false;
      seen.add(base);
      p.provider_name = base;
      return true;
    }).map(p => ({ provider_name: p.provider_name, logo_path: p.logo_path }));
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
    const [showsData, epData, yearData, undatedCount] = await Promise.all([
      pool.query('SELECT * FROM shows'),
      pool.query('SELECT tmdb_id, COUNT(*) as ep_count FROM watched_episodes GROUP BY tmdb_id ORDER BY ep_count DESC LIMIT 10'),
      pool.query(`SELECT EXTRACT(YEAR FROM watched_at)::int as yr, COUNT(*)::int as ep_count
                  FROM watched_episodes WHERE watched_at IS NOT NULL
                  GROUP BY yr ORDER BY yr DESC`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM watched_episodes
                  WHERE watched_at IS NULL OR watched_at = '1970-01-01'`),
    ]);
    res.json({ shows: showsData.rows, topEps: epData.rows, byYear: yearData.rows, undatedCount: undatedCount.rows[0]?.cnt || 0 });
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
    const now = new Date();
    const sevenDays = 7*24*60*60*1000;
    const recentEp = lastEpData?.air_date && (now - new Date(lastEpData.air_date)) <= sevenDays && (now - new Date(lastEpData.air_date)) >= 0;
    const upcomingEp = nextEpData?.air_date && (new Date(nextEpData.air_date) - now) >= 0 && (new Date(nextEpData.air_date) - now) <= sevenDays;
    const activelyReleasing = recentEp && upcomingEp;
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
  try { res.json((await pool.query('SELECT season_number, episode_number, watched_at FROM watched_episodes WHERE tmdb_id=$1', [req.params.tmdb_id])).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/episodes', requireLogin, async (req, res) => {
  try {
    const { tmdb_id, season_number, episode_number, watched_at } = req.body;
    if (watched_at) {
      await pool.query(
        'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number,watched_at) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id,season_number,episode_number) DO UPDATE SET watched_at=$4',
        [parseInt(tmdb_id), parseInt(season_number), parseInt(episode_number), watched_at]
      );
    } else {
      await pool.query('INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [parseInt(tmdb_id), parseInt(season_number), parseInt(episode_number)]);
    }
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
    const { tmdb_id, season_number, episodes, watched_ats } = req.body;
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const wat = watched_ats?.[i] || null;
      if (wat) {
        await pool.query(
          'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number,watched_at) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id,season_number,episode_number) DO UPDATE SET watched_at=$4',
          [parseInt(tmdb_id), parseInt(season_number), parseInt(ep), wat]
        );
      } else {
        await pool.query('INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [parseInt(tmdb_id), parseInt(season_number), parseInt(ep)]);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/episodes/season', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM watched_episodes WHERE tmdb_id=$1 AND season_number=$2', [parseInt(req.body.tmdb_id), parseInt(req.body.season_number)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HISTORY IMPORT ────────────────────────────────────────────────────────────
app.post('/api/history/import', requireLogin, async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

    // Build map of our shows by tmdb_id
    const ourShows = await pool.query('SELECT tmdb_id FROM shows');
    const ourIds = new Set(ourShows.rows.map(r => r.tmdb_id));

    // Group by show, then deduplicate per season+episode keeping most recent watched_at
    // Format: show.ids.tmdb, episode.season, episode.number, watched_at, type
    const byShow = {};
    for (const entry of entries) {
      if (entry?.type !== 'episode') continue; // skip movies, seasons, shows
      const tmdbId = entry?.show?.ids?.tmdb;
      const season = entry?.episode?.season;
      const epNum = entry?.episode?.number;
      const watchedAt = entry?.watched_at || null;
      const showTitle = entry?.show?.title || 'Unknown';
      if (!tmdbId || season == null || epNum == null) continue;
      if (!byShow[tmdbId]) byShow[tmdbId] = { tmdb_id: tmdbId, title: showTitle, epMap: {} };
      const epKey = `${season}_${epNum}`;
      const existing = byShow[tmdbId].epMap[epKey];
      // Keep most recent watched_at when duplicates exist
      if (!existing || (watchedAt && (!existing.watched_at || watchedAt > existing.watched_at))) {
        byShow[tmdbId].epMap[epKey] = { season, episode: epNum, watched_at: watchedAt };
      }
    }

    let matched = 0, imported = 0;
    const unmatched = [];

    for (const [tmdbId, data] of Object.entries(byShow)) {
      const id = parseInt(tmdbId);
      const episodes = Object.values(data.epMap);
      if (ourIds.has(id)) {
        matched++;
        for (const ep of episodes) {
          const wat = ep.watched_at || null;
          if (wat) {
            await pool.query(
              'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number,watched_at) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id,season_number,episode_number) DO UPDATE SET watched_at=$4',
              [id, parseInt(ep.season), parseInt(ep.episode), wat]
            );
          } else {
            await pool.query(
              'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [id, parseInt(ep.season), parseInt(ep.episode)]
            );
          }
          imported++;
        }
      } else {
        unmatched.push({
          tmdb_id: id,
          title: data.title,
          episode_count: episodes.length,
          episodes,
        });
      }
    }

    // Persist unmatched to user_settings so UI can display it
    await pool.query(
      'INSERT INTO user_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      ['trakt_unmatched', JSON.stringify(unmatched)]
    );

    res.json({ matched, imported, unmatched_shows: unmatched.length, unmatched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history/undated', requireLogin, async (req, res) => {
  try {
    // Returns all watched episodes that have no explicit watch date (NULL watched_at)
    // grouped by show, with show title from shows table
    const r = await pool.query(`
      SELECT we.tmdb_id, we.season_number, we.episode_number,
             s.title, s.poster_path
      FROM watched_episodes we
      JOIN shows s ON s.tmdb_id = we.tmdb_id
      WHERE we.watched_at IS NULL
      ORDER BY s.title ASC, we.season_number ASC, we.episode_number ASC
    `);
    // Group by show
    const byShow = {};
    for (const row of r.rows) {
      if (!byShow[row.tmdb_id]) byShow[row.tmdb_id] = { tmdb_id: row.tmdb_id, title: row.title, poster_path: row.poster_path, episodes: [] };
      byShow[row.tmdb_id].episodes.push({ season_number: row.season_number, episode_number: row.episode_number });
    }
    res.json(Object.values(byShow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/year/:year', requireLogin, async (req, res) => {
  try {
    const yr = parseInt(req.params.year);
    const [epData, topShows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as ep_count FROM watched_episodes WHERE EXTRACT(YEAR FROM watched_at) = $1`, [yr]),
      pool.query(`SELECT we.tmdb_id, COUNT(*)::int as ep_count, s.title, s.poster_path, s.id
                  FROM watched_episodes we JOIN shows s ON s.tmdb_id = we.tmdb_id
                  WHERE EXTRACT(YEAR FROM we.watched_at) = $1
                  GROUP BY we.tmdb_id, s.title, s.poster_path, s.id
                  ORDER BY ep_count DESC LIMIT 5`, [yr]),
    ]);
    res.json({ year: yr, ep_count: epData.rows[0]?.ep_count || 0, top_shows: topShows.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history/unmatched', requireLogin, async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM user_settings WHERE key='trakt_unmatched'");
    const unmatched = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
    res.json(unmatched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/history/unmatched/resolve', requireLogin, async (req, res) => {
  try {
    // After user adds a show, import its pending episodes and remove from unmatched list
    const { tmdb_id, episodes } = req.body;
    const id = parseInt(tmdb_id);
    for (const ep of episodes) {
      const wat = ep.watched_at || null;
      if (wat) {
        await pool.query(
          'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number,watched_at) VALUES ($1,$2,$3,$4) ON CONFLICT (tmdb_id,season_number,episode_number) DO UPDATE SET watched_at=$4',
          [id, parseInt(ep.season), parseInt(ep.episode), wat]
        );
      } else {
        await pool.query(
          'INSERT INTO watched_episodes (tmdb_id,season_number,episode_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, parseInt(ep.season), parseInt(ep.episode)]
        );
      }
    }
    // Remove this show from unmatched list
    const r = await pool.query("SELECT value FROM user_settings WHERE key='trakt_unmatched'");
    let unmatched = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
    unmatched = unmatched.filter(u => u.tmdb_id !== id);
    await pool.query(
      'INSERT INTO user_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      ['trakt_unmatched', JSON.stringify(unmatched)]
    );
    res.json({ ok: true, remaining: unmatched.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/history/unmatched/:tmdb_id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.tmdb_id);
    const r = await pool.query("SELECT value FROM user_settings WHERE key='trakt_unmatched'");
    let unmatched = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
    unmatched = unmatched.filter(u => u.tmdb_id !== id);
    await pool.query(
      'INSERT INTO user_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      ['trakt_unmatched', JSON.stringify(unmatched)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
initDB().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`))).catch(e => { console.error(e); process.exit(1); });

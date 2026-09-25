// ── STATS ─────────────────────────────────────────────────────────────────────
let statsSortMode = 'episodes';
let statsYearFilter = null;

async function loadStats(){
  const container=document.getElementById('stats-content');
  container.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)">Loading...</div>';
  const statsData = await api('/api/stats');
  const allShows = statsData.shows || [];
  const topEpsRaw = statsData.topEps || [];
  const byYear = statsData.byYear || [];
  const beforeTracker = statsData.beforeTracker || 0;
  const totalWatched = byYear.reduce((s,r)=>s+r.ep_count,0) + beforeTracker;
  const totalMins = totalWatched * 45;

  const counts = {watching:0,caughtup:0,finished:0,watchlist:0,paused:0,dropped:0};
  allShows.forEach(s=>{if(counts[s.status]!==undefined)counts[s.status]++;});

  const genreCounts = {};
  allShows.forEach(s => {
    if (s.genres) s.genres.split(',').filter(Boolean).forEach(g => { genreCounts[g.trim()] = (genreCounts[g.trim()]||0) + 1; });
  });
  const topGenres = Object.entries(genreCounts).sort((a,b) => b[1]-a[1]).slice(0,10);
  const maxGenre = topGenres[0]?.[1] || 1;

  const avgRuntime = 45;
  const topShows = topEpsRaw.map(r => {
    const show = allShows.find(s => s.tmdb_id === parseInt(r.tmdb_id));
    return show ? {...show, ep_count: parseInt(r.ep_count), hours: Math.round(parseInt(r.ep_count) * avgRuntime / 60)} : null;
  }).filter(Boolean).slice(0, 10);

  renderStatsContent(container, counts, totalWatched, totalMins, topShows, topGenres, maxGenre, byYear, allShows, beforeTracker);
}

async function loadYearStats(year, allShows) {
  const container = document.getElementById('year-detail-content');
  if (!container) return;
  container.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:13px">Loading...</div>';
  const data = await api(`/api/stats/year/${year}`);
  const eps = data.ep_count || 0;
  const mins = eps * 45;
  const label = year === 'before' ? 'Before Tracker (pre Apr 2025)' : year;
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:14px">
      <div class="stat-box"><div class="stat-num">${eps}</div><div class="stat-label">Episodes</div></div>
      <div class="stat-box"><div class="stat-num" style="font-size:clamp(11px,2vw,16px)">${fmtTimeFull(mins)}</div><div class="stat-label">Time Watched</div></div>
    </div>
    ${data.top_shows?.length ? `
      <div class="stats-title" style="margin-bottom:8px">Top Shows — ${label}</div>
      ${data.top_shows.map((s,i) => `
        <div class="stats-row" onclick="openDetail(${s.tmdb_id},${s.id})" style="cursor:pointer;margin-bottom:6px">
          <div class="stats-rank">#${i+1}</div>
          ${s.poster_path?`<img src="${IMG}/w92${s.poster_path}" style="width:28px;height:42px;border-radius:4px;object-fit:cover;flex-shrink:0" alt=""/>`:`<div style="width:28px;height:42px;border-radius:4px;background:var(--surface3);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px">📺</div>`}
          <div class="stats-name">${esc(s.title)}</div>
          <div class="stats-val">${fmtTimeFull(s.ep_count*45)}</div>
        </div>`).join('')}` : '<div style="color:var(--muted);font-size:13px">No dated episodes for this period yet.</div>'}`;
}

function renderStatsContent(container, counts, totalWatched, totalMins, topShows, topGenres, maxGenre, byYear, allShows, beforeTracker) {
  const byTime = statsSortMode === 'time';
  const sorted = [...topShows].sort((a,b) => byTime ? b.hours - a.hours : b.ep_count - a.ep_count);
  const maxYearEps = Math.max(...byYear.map(r=>r.ep_count), beforeTracker, 1);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-num">${counts.watching + counts.caughtup}</div><div class="stat-label">Currently Active</div></div>
      <div class="stat-box"><div class="stat-num">${counts.finished}</div><div class="stat-label">Shows Finished</div></div>
      <div class="stat-box"><div class="stat-num">${counts.watchlist}</div><div class="stat-label">In Watchlist</div></div>
      <div class="stat-box"><div class="stat-num">${totalWatched}</div><div class="stat-label">Episodes Watched</div></div>
      <div class="stat-box"><div class="stat-num" style="font-size:clamp(11px,2vw,14px)">${fmtTimeFull(totalMins)}</div><div class="stat-label">Total Time Watched</div></div>
      <div class="stat-box"><div class="stat-num">${Object.values(counts).reduce((a,b)=>a+b,0)}</div><div class="stat-label">Total Shows</div></div>
    </div>

    ${(byYear.length || beforeTracker > 0) ? `
    <div class="stats-section">
      <div class="stats-title">By Year</div>
      <div class="year-tabs" id="year-tabs">
        <button class="year-tab ${!statsYearFilter?'on':''}" onclick="selectYear(null,${JSON.stringify(allShows).replace(/"/g,'&quot;')})">All Time</button>
        ${byYear.map(r=>`<button class="year-tab ${statsYearFilter===r.yr?'on':''}" onclick="selectYear(${r.yr},${JSON.stringify(allShows).replace(/"/g,'&quot;')})">${r.yr}</button>`).join('')}
        ${beforeTracker > 0 ? `<button class="year-tab ${statsYearFilter==='before'?'on':''}" onclick="selectYear('before',${JSON.stringify(allShows).replace(/"/g,'&quot;')})">📼 Before Tracker</button>` : ''}
      </div>
      ${byYear.map(r=>`
        <div class="stats-row" style="${statsYearFilter===r.yr?'border-color:var(--accent);':''}cursor:pointer" onclick="selectYear(${r.yr},${JSON.stringify(allShows).replace(/"/g,'&quot;')})">
          <div class="stats-rank" style="font-size:12px;width:36px">${r.yr}</div>
          <div class="stats-val" style="flex:1;text-align:right">${r.ep_count} eps</div>
          <div class="stats-val" style="min-width:160px;text-align:right">${fmtTimeFull(r.ep_count*45)}</div>
        </div>`).join('')}
      ${beforeTracker > 0 ? `
        <div class="stats-row" style="${statsYearFilter==='before'?'border-color:var(--accent);':''} cursor:pointer; opacity:0.6" onclick="selectYear('before',${JSON.stringify(allShows).replace(/"/g,'&quot;')})">
          <div class="stats-rank" style="font-size:11px;width:36px;color:var(--muted)">📼</div>
          <div class="stats-name" style="color:var(--muted)">Before Tracker</div>
          <div class="stats-val" style="flex:1;text-align:right">${beforeTracker} eps</div>
          <div class="stats-val" style="min-width:160px;text-align:right">${fmtTimeFull(beforeTracker*45)}</div>
        </div>` : ''}
      <div id="year-detail-content" style="margin-top:12px"></div>
    </div>` : `<div style="color:var(--muted);font-size:14px;margin-bottom:20px">Year-by-year stats appear once you have watch dates on your episodes.</div>`}

    ${sorted.length?`
    <div class="stats-section">
      <div class="stats-title">Top 10 Shows</div>
      <div class="stats-sort">
        <button class="sort-btn ${!byTime?'on':''}" onclick="statsSortMode='episodes';loadStats()">By Episodes</button>
        <button class="sort-btn ${byTime?'on':''}" onclick="statsSortMode='time';loadStats()">By Time</button>
      </div>
      ${sorted.map((s,i)=>`
        <div class="stats-row" onclick="openDetail(${s.tmdb_id},${s.id})" style="cursor:pointer">
          <div class="stats-rank">#${i+1}</div>
          ${s.poster_path?`<img src="${IMG}/w92${s.poster_path}" style="width:32px;height:48px;border-radius:4px;object-fit:cover;flex-shrink:0" alt=""/>`:`<div style="width:32px;height:48px;border-radius:4px;background:var(--surface3);flex-shrink:0;display:flex;align-items:center;justify-content:center">📺</div>`}
          <div class="stats-name">${esc(s.title)}</div>
          <div class="stats-val">${byTime ? fmtTimeFull(s.ep_count*45) : s.ep_count+' eps'}</div>
        </div>`).join('')}
    </div>`:''}

    ${topGenres.length?`
    <div class="stats-section">
      <div class="stats-title">Top Genres</div>
      ${topGenres.map(([g,c],i)=>`
        <div class="stats-row">
          <div class="stats-rank">#${i+1}</div>
          <div class="stats-name">${esc(g)}</div>
          <div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round((c/maxGenre)*100)}%"></div></div>
          <div class="stats-val">${c} show${c!==1?'s':''}</div>
        </div>`).join('')}
    </div>`:`<div style="color:var(--muted);font-size:14px;margin-top:16px">Genre data loads as you browse shows.</div>`}
  `;

  if (statsYearFilter) loadYearStats(statsYearFilter, allShows);
}

async function selectYear(year, allShows) {
  statsYearFilter = year;
  document.querySelectorAll('.year-tab').forEach(b => {
    const txt = b.textContent.trim();
    b.classList.toggle('on',
      year === null ? txt === 'All Time' :
      year === 'before' ? txt === '📼 Before Tracker' :
      parseInt(txt) === year
    );
  });
  if (year === null) {
    const el = document.getElementById('year-detail-content');
    if (el) el.innerHTML = '';
  } else {
    loadYearStats(year, allShows);
  }
}

// ── HISTORY IMPORT ────────────────────────────────────────────────────────────
let traktUnmatched = [];
let pendingResolveData = null;

async function loadHistory() {
  const container = document.getElementById('history-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Loading...</div>';
  traktUnmatched = await api('/api/history/unmatched');
  renderHistoryTab(container);
  loadUndatedSection(container);
}

function renderHistoryTab(container) {
  container.innerHTML = `
    <div id="undated-section"><div style="text-align:center;padding:20px;color:var(--muted)">Loading undated episodes...</div></div>
    <div class="history-card">
      <h3>Import from Trakt</h3>
      <p>Export your watch history from Trakt, then upload the JSON file here.</p>
      <div class="history-instructions">
        <strong>How to export from Trakt:</strong>
        <ol>
          <li>Go to <a href="https://trakt.tv/settings/data" target="_blank">trakt.tv/settings/data</a></li>
          <li>Click <strong>Export Data</strong> → <strong>History</strong></li>
          <li>Download the JSON file and upload it below</li>
        </ol>
      </div>
      <div style="margin-top:14px">
        <div class="history-drop" id="history-drop-zone">
          <input type="file" accept=".json,application/json" onchange="handleTraktFile(event)"/>
          <div class="history-drop-icon">📂</div>
          <div class="history-drop-label">Drop Trakt JSON here or click to browse</div>
          <div class="history-drop-sub">history.json from Trakt data export</div>
        </div>
        <div id="history-import-result"></div>
      </div>
    </div>
    ${traktUnmatched.length ? `
    <div class="history-card">
      <h3>Unmatched Shows <span style="background:var(--surface2);border:1px solid var(--border);border-radius:99px;padding:1px 10px;font-size:12px;margin-left:6px">${traktUnmatched.length}</span></h3>
      <p>These shows were in your Trakt history but aren't in your tracker yet.</p>
      <div class="unmatched-list" id="unmatched-list">
        ${traktUnmatched.map((u, i) => unmatchedRowHTML(u, i)).join('')}
      </div>
    </div>` : traktUnmatched !== null ? `
    <div class="history-card" style="text-align:center;padding:32px;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:8px">✅</div>
      <div style="font-size:14px">No unmatched shows — everything is accounted for!</div>
    </div>` : ''}
  `;

  const dz = document.getElementById('history-drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
  }
}

function unmatchedRowHTML(u, i) {
  return `<div class="unmatched-row" id="unmatched-row-${u.tmdb_id}">
    <div class="unmatched-poster" style="display:flex;align-items:center;justify-content:center;font-size:20px">📺</div>
    <div class="unmatched-info">
      <div class="unmatched-title">${esc(u.title)}</div>
      <div class="unmatched-meta">${u.episode_count} episode${u.episode_count!==1?'s':''} in history · TMDB #${u.tmdb_id}</div>
    </div>
    <div class="unmatched-actions">
      <button class="btn-resolve" onclick="openResolveSearch(${i})">+ Add Show</button>
      <button class="btn-dismiss" onclick="dismissUnmatched(${u.tmdb_id})" title="Dismiss">✕</button>
    </div>
  </div>`;
}

function handleTraktFile(event) {
  const file = event.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  const resultEl = document.getElementById('history-import-result');
  if (resultEl) resultEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted)">⏳ Parsing file...</div>';
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      let entries = JSON.parse(e.target.result);
      if (!Array.isArray(entries) && entries.episodes) entries = entries.episodes;
      if (!Array.isArray(entries)) { showImportError('Unexpected file format.'); return; }
      if (resultEl) resultEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--muted)">⏳ Importing ${entries.length} entries...</div>`;
      const result = await api('/api/history/import', { method:'POST', body:{ entries } });
      if (result.error) { showImportError(result.error); return; }
      traktUnmatched = result.unmatched || [];
      showImportResult(result);
      const showsData = await api('/api/shows');
      shows = showsData;
      renderAll();
      loadNextEpisodes();
    } catch (err) {
      showImportError('Could not parse file. Make sure it\'s valid JSON from Trakt.');
    }
  };
  reader.readAsText(file);
}

function showImportError(msg) {
  const el = document.getElementById('history-import-result');
  if (el) el.innerHTML = `<div style="background:rgba(229,62,62,.1);border:1px solid rgba(229,62,62,.3);border-radius:8px;padding:12px 14px;color:#fc8181;font-size:13px;margin-top:10px">⚠️ ${esc(msg)}</div>`;
}

function showImportResult(result) {
  const el = document.getElementById('history-import-result');
  if (!el) return;
  el.innerHTML = `
    <div class="history-import-result">
      <div class="history-stat-row">
        <div class="history-stat"><div class="history-stat-num" style="color:var(--green)">${result.imported}</div><div class="history-stat-label">Episodes Imported</div></div>
        <div class="history-stat"><div class="history-stat-num">${result.matched}</div><div class="history-stat-label">Shows Matched</div></div>
        <div class="history-stat"><div class="history-stat-num" style="color:${result.unmatched_shows>0?'#d69e2e':'var(--muted)'}">${result.unmatched_shows}</div><div class="history-stat-label">Unmatched Shows</div></div>
      </div>
      <div style="font-size:13px;color:var(--green);margin-top:4px">✓ Import complete!</div>
    </div>`;
  const container = document.getElementById('history-content');
  if (container) renderHistoryTab(container);
}

async function dismissUnmatched(tmdbId) {
  await api(`/api/history/unmatched/${tmdbId}`, { method:'DELETE' });
  traktUnmatched = traktUnmatched.filter(u => u.tmdb_id !== tmdbId);
  const row = document.getElementById(`unmatched-row-${tmdbId}`);
  if (row) { row.style.opacity = '0'; row.style.transition = 'opacity .2s'; setTimeout(()=>row.remove(), 200); }
  toast('Dismissed');
}

// ── RESOLVE ───────────────────────────────────────────────────────────────────
let resolveSearchTimer = null;

function openResolveSearch(idx) {
  pendingResolveData = traktUnmatched[idx];
  if (!pendingResolveData) return;
  document.getElementById('resolve-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'resolve-panel';
  panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:170;display:flex;align-items:center;justify-content:center;padding:20px';
  panel.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:16px;font-weight:600">Add Show to Tracker</div>
        <button onclick="document.getElementById('resolve-panel').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1;padding:0 4px">×</button>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:14px">
        Searching for <strong style="color:var(--text)">${esc(pendingResolveData.title)}</strong>
      </div>
      <input type="text" id="resolve-search-input" placeholder="Search for show..." autocomplete="off"
        style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:14px;margin-bottom:10px"
        oninput="onResolveSearch(this.value)" value="${escAttr(pendingResolveData.title)}"/>
      <div id="resolve-search-results" class="resolve-search-results"></div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:4px;width:100%">Add as:</div>
        ${['watching','finished','caughtup','paused','dropped'].map(s=>`<button style="font-size:11px;padding:4px 10px;border-radius:99px;font-weight:600;cursor:pointer;border:none;background:${statusBg(s)};color:${statusFg(s)}" onclick="resolveStatusSelect('${s}')" id="resolve-status-${s}">${sLabel(s)}</button>`).join('')}
      </div>
      <div id="resolve-selected-status" style="font-size:12px;color:var(--muted);margin-top:8px">Selected: <strong id="resolve-status-display">Watching ▶</strong></div>
    </div>`;
  document.body.appendChild(panel);
  window._resolveStatus = 'watching';
  highlightResolveStatus('watching');
  setTimeout(() => onResolveSearch(pendingResolveData.title), 50);
}

function statusBg(s) {
  return {watching:'#2d6a4f',finished:'#2d1e5c',caughtup:'#1a3a5c',paused:'#44370b',dropped:'#4a1010'}[s]||'#333';
}
function statusFg(s) {
  return {watching:'#74c69d',finished:'#d6bcfa',caughtup:'#74b9ff',paused:'#ffd60a',dropped:'#ff6b6b'}[s]||'#aaa';
}
function resolveStatusSelect(status) {
  window._resolveStatus = status;
  highlightResolveStatus(status);
  document.getElementById('resolve-status-display').textContent = sLabel(status);
}
function highlightResolveStatus(status) {
  ['watching','finished','caughtup','paused','dropped'].forEach(s => {
    const btn = document.getElementById('resolve-status-'+s);
    if (btn) btn.style.outline = s===status ? '2px solid #fff' : 'none';
  });
}

function onResolveSearch(q) {
  clearTimeout(resolveSearchTimer);
  const el = document.getElementById('resolve-search-results');
  if (!q.trim()) { if(el) el.innerHTML=''; return; }
  resolveSearchTimer = setTimeout(async () => {
    if (el) el.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:13px">Searching...</div>';
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    if (!el || !document.getElementById('resolve-panel')) return;
    if (!results.length) { el.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:13px">No results</div>'; return; }
    el.innerHTML = results.map((r,i) => {
      const inList = shows.some(s => s.tmdb_id === r.tmdb_id);
      return `<div class="resolve-sr-item" onclick="resolveAddShow(${i})">
        ${r.poster_path ? `<img src="${IMG}/w92${r.poster_path}" style="width:36px;height:54px;border-radius:4px;object-fit:cover;flex-shrink:0" alt=""/>` : `<div style="width:36px;height:54px;border-radius:4px;background:var(--surface3);display:flex;align-items:center;justify-content:center;flex-shrink:0">📺</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.year||''}${inList?' · ✓ In your list':''}</div>
        </div>
        <button style="font-size:11px;padding:4px 10px;border-radius:99px;font-weight:600;background:#2d6a4f;color:#74c69d;border:none;cursor:pointer;flex-shrink:0">Add</button>
      </div>`;
    }).join('');
    window._resolveResults = results;
  }, 300);
}

async function resolveAddShow(idx) {
  const show = window._resolveResults?.[idx];
  if (!show || !pendingResolveData) return;
  const status = window._resolveStatus || 'watching';
  const panel = document.getElementById('resolve-panel');
  if (panel) panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Adding show and importing history...</div>';
  const res = await api('/api/shows', { method:'POST', body:{ ...show, status } });
  if (!res.id) { toast('Failed to add show'); if(panel) panel.remove(); return; }
  const idx2 = shows.findIndex(s => s.tmdb_id === res.tmdb_id);
  if (idx2 >= 0) shows[idx2] = res; else shows.push(res);
  shows.sort((a,b) => a.title.localeCompare(b.title));
  const resolveRes = await api('/api/history/unmatched/resolve', {
    method:'POST',
    body:{ tmdb_id: pendingResolveData.tmdb_id, episodes: pendingResolveData.episodes }
  });
  traktUnmatched = traktUnmatched.filter(u => u.tmdb_id !== pendingResolveData.tmdb_id);
  pendingResolveData = null;
  if (panel) panel.remove();
  renderAll();
  loadNextEpisodes();
  const container = document.getElementById('history-content');
  if (container) renderHistoryTab(container);
  toast(`Show added · ${resolveRes.remaining ?? '?'} unmatched remaining`);
}

// ── UNDATED EPISODES ──────────────────────────────────────────────────────────
async function loadUndatedSection(container) {
  const undated = await api('/api/history/undated');
  const el = document.getElementById('undated-section');
  if (!el) return;
  if (!undated.length) {
    el.innerHTML = `<div class="history-card" style="text-align:center;padding:24px;color:var(--muted)">
      <div style="font-size:28px;margin-bottom:6px">✅</div>
      <div style="font-size:14px">All your watched episodes have dates!</div>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div class="history-card">
      <h3>Episodes Without Watch Dates <span style="background:var(--surface2);border:1px solid var(--border);border-radius:99px;padding:1px 10px;font-size:12px;margin-left:6px">${undated.reduce((s,g)=>s+g.episodes.length,0)}</span></h3>
      <p>These episodes were marked watched but have no date.</p>
      ${undated.map(group => `
        <div class="undated-show-card">
          <div class="undated-show-header" onclick="toggleUndatedGroup(this)">
            ${group.poster_path ? `<img class="undated-show-poster" src="${IMG}/w92${group.poster_path}" alt=""/>` : `<div class="undated-show-poster" style="display:flex;align-items:center;justify-content:center">📺</div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500">${esc(group.title)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${group.episodes.length} episode${group.episodes.length!==1?'s':''} without dates</div>
            </div>
            <div style="color:var(--muted);font-size:16px;flex-shrink:0">▾</div>
          </div>
          <div class="undated-ep-list" style="display:none">
            ${group.episodes.map(ep => `
              <div class="undated-ep-row" id="undated-${group.tmdb_id}-${ep.season_number}-${ep.episode_number}">
                <div class="undated-ep-label">S${ep.season_number} E${ep.episode_number}</div>
                <input type="date" class="undated-ep-date-input" max="${new Date().toISOString().slice(0,10)}"
                  id="undated-input-${group.tmdb_id}-${ep.season_number}-${ep.episode_number}"/>
                <button class="undated-ep-save" onclick="saveUndatedDate(${group.tmdb_id},${ep.season_number},${ep.episode_number})">Save</button>
              </div>`).join('')}
            <div style="padding:6px 0 2px;display:flex;gap:8px">
              <button style="font-size:11px;padding:5px 12px;border-radius:99px;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer" onclick="setAllUndatedDates(${group.tmdb_id},${JSON.stringify(group.episodes).replace(/"/g,'&quot;')})">Set all to same date</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function toggleUndatedGroup(header) {
  const list = header.nextElementSibling;
  const arrow = header.querySelector('div:last-child');
  const open = list.style.display !== 'none';
  list.style.display = open ? 'none' : 'flex';
  if(arrow) arrow.textContent = open ? '▾' : '▴';
}

async function saveUndatedDate(tmdbId, season, epNum) {
  const input = document.getElementById(`undated-input-${tmdbId}-${season}-${epNum}`);
  if (!input?.value) { toast('Pick a date first'); return; }
  const iso = new Date(input.value + 'T12:00:00').toISOString();
  await api('/api/episodes', { method:'POST', body:{ tmdb_id: tmdbId, season_number: season, episode_number: epNum, watched_at: iso }});
  const row = document.getElementById(`undated-${tmdbId}-${season}-${epNum}`);
  if (row) { row.style.opacity='0'; row.style.transition='opacity .2s'; setTimeout(()=>row.remove(),200); }
  const dm = watchedDates.get(tmdbId) || new Map();
  dm.set(`${season}_${epNum}`, iso);
  watchedDates.set(tmdbId, dm);
  toast('Date saved ✓');
}

async function setAllUndatedDates(tmdbId, episodes) {
  const dateStr = prompt('Enter a date for all episodes in this group (YYYY-MM-DD):');
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { toast('Invalid date format'); return; }
  const iso = new Date(dateStr + 'T12:00:00').toISOString();
  for (const ep of episodes) {
    await api('/api/episodes', { method:'POST', body:{ tmdb_id: tmdbId, season_number: ep.season_number, episode_number: ep.episode_number, watched_at: iso }});
    const row = document.getElementById(`undated-${tmdbId}-${ep.season_number}-${ep.episode_number}`);
    if (row) { row.style.opacity='0'; row.style.transition='opacity .2s'; setTimeout(()=>row.remove(),200); }
    const dm = watchedDates.get(tmdbId) || new Map();
    dm.set(`${ep.season_number}_${ep.episode_number}`, iso);
    watchedDates.set(tmdbId, dm);
  }
  toast(`All dates set to ${fmtDate(dateStr)} ✓`);
}

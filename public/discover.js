// ── DISCOVER ──────────────────────────────────────────────────────────────────
let discoverMode = 'recs'; // 'recs' | 'trending'

async function loadDiscover() {
  const filterRow = document.getElementById('discover-filter-row');
  const grid = document.getElementById('grid-recs');

  if (!genreList.length) {
    const genres = await api('/api/tmdb/genres');
    genreList = genres || [];
  }

  if (filterRow) {
    filterRow.innerHTML = `
      <button class="discover-source-btn ${discoverMode==='recs'?'on':''}" onclick="setDiscoverMode('recs')">⭐ For You</button>
      <button class="discover-source-btn ${discoverMode==='trending'?'on':''}" onclick="setDiscoverMode('trending')">🔥 Trending</button>
      <div style="width:1px;background:var(--border);margin:0 4px;align-self:stretch"></div>
      ${discoverMode==='recs' ? `
        <button class="genre-filter-chip ${!activeGenre?'on':''}" onclick="setGenreFilter(null)">All</button>
        ${genreList.map(g=>`<button class="genre-filter-chip ${activeGenre?.id===g.id?'on':''}" onclick="setGenreFilter(${JSON.stringify(g).replace(/"/g,'&quot;')})">${esc(g.name)}</button>`).join('')}
      ` : ''}`;
  }

  grid.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading...</div>';

  if (discoverMode === 'trending') {
    const data = await api('/api/tmdb/trending');
    if (!data.length) { grid.innerHTML = '<div class="empty"><div class="empty-icon">📺</div>Nothing to show</div>'; return; }
    grid.innerHTML = data.map(r => recCardHTML(r)).join('');
  } else {
    const url = activeGenre ? `/api/recommendations/genre/${activeGenre.id}` : '/api/recommendations';
    const recs = await api(url);
    if (!recs.length) { grid.innerHTML = '<div class="empty"><div class="empty-icon">🤷</div>Nothing found — try a different genre</div>'; return; }
    grid.innerHTML = recs.map(r => recCardHTML(r)).join('');
  }
}

function setDiscoverMode(mode) {
  discoverMode = mode;
  if (mode === 'recs') activeGenre = null;
  loadDiscover();
}

function setGenreFilter(genre) {
  activeGenre = genre;
  loadDiscover();
}

// Alias used by addFromRecModal after adding a show
async function loadRecs() { loadDiscover(); }

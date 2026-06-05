// ── SHARED STATE ──────────────────────────────────────────────────────────────
const IMG = 'https://image.tmdb.org/t/p';
let shows = [];
let watchedEps = new Map();
let nextEps = new Map();
let showDetails = new Map();
let showProviders = new Map();
let ownedServices = new Set();
let currentSimilarData = [];
let currentSeasonEpisodes = new Map();
let watchedDates = new Map();
let sortMode = 'alpha';
let genreList = [];
let activeGenre = null;
let currentDetail = null;
let currentSeason = null;
let searchTimer = null;

const ALL_SERVICES = ['Netflix','Hulu','Disney+','Max','Apple TV+','Peacock','Paramount+','Amazon Prime','MGM+','Crunchyroll','AMC+','Showtime','Fubo','ESPN+','YouTube TV','Other'];

// ── API ───────────────────────────────────────────────────────────────────────
async function api(url, opts={}) {
  const r = await fetch(url, { headers:{'Content-Type':'application/json'}, ...opts, body:opts.body!==undefined?JSON.stringify(opts.body):undefined });
  return r.json().catch(()=>({}));
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const res = await api('/api/login',{method:'POST',body:{username:document.getElementById('lu').value.trim(),password:document.getElementById('lp').value}});
  if (res.ok) startApp(); else document.getElementById('lerr').textContent='Wrong username or password';
}
async function doLogout() { await api('/api/logout',{method:'POST'}); location.reload(); }
async function init() { const r = await api('/api/me'); if (r.ok) startApp(); }

// ── START ─────────────────────────────────────────────────────────────────────
async function startApp() {
  document.getElementById('login').style.display='none';
  document.getElementById('app').classList.remove('hide');
  const [showsData, settings] = await Promise.all([api('/api/shows'), api('/api/settings')]);
  shows = showsData;
  if (settings?.owned_services) {
    ownedServices = new Set(settings.owned_services.split(',').filter(Boolean));
  }
  renderAll();
  loadNextEpisodes();
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
function escAttr(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmtTime(mins){
  if(!mins) return '0m';
  const total=Math.floor(mins);
  const y=Math.floor(total/(60*24*365));
  const mo=Math.floor((total%(60*24*365))/(60*24*30));
  const d=Math.floor((total%(60*24*30))/(60*24));
  const h=Math.floor((total%(60*24))/60);
  const m=total%60;
  return [y?`${y}y`:null,mo?`${mo}mo`:null,d?`${d}d`:null,h?`${h}h`:null,m?`${m}m`:null].filter(Boolean).join(' ');
}
function fmtTimeFull(mins){
  if(!mins||mins<=0) return '<span class="t-unit">0m</span>';
  const total=Math.floor(mins);
  const y=Math.floor(total/(60*24*365));
  const mo=Math.floor((total%(60*24*365))/(60*24*30));
  const d=Math.floor((total%(60*24*30))/(60*24));
  const h=Math.floor((total%(60*24))/60);
  const m=total%60;
  const fmt=(v,u)=>`<span class="t-unit" style="${v===0?'visibility:hidden':''}"><span class="t-val">${v}</span><span class="t-lbl">${u}</span></span>`;
  return fmt(y,'y')+fmt(mo,'mo')+fmt(d,'d')+fmt(h,'h')+fmt(m,'m');
}
function fmtDate(d){if(!d)return'';const p=d.split('-');return p.length===3?`${parseInt(p[1])}/${parseInt(p[2])}/${p[0]}`:d;}
function fmtWatchedDate(iso){
  if(!iso) return '';
  const d=new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}
function isoToDateInput(iso){if(!iso) return '';return iso.slice(0,10);}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2200);}
function sLabel(s){return{watching:'Watching ▶',caughtup:'Caught Up 🔄',finished:'Show Finished ✅',watchlist:'Watchlist 📋',paused:'Paused ⏸',dropped:'Not Continuing 🚫'}[s]||s;}
function sIcon(s){return{watching:'▶️',caughtup:'🔄',finished:'✅',watchlist:'📋',paused:'⏸️',dropped:'🚫'}[s]||'📺';}

// ── SORT ──────────────────────────────────────────────────────────────────────
function sortList(list) {
  if (sortMode === 'updated') return [...list].sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (sortMode === 'remaining') return [...list].sort((a,b) => {
    const ra = (nextEps.get(a.tmdb_id)?.total_aired||0) - (watchedEps.get(a.tmdb_id)||new Set()).size;
    const rb = (nextEps.get(b.tmdb_id)?.total_aired||0) - (watchedEps.get(b.tmdb_id)||new Set()).size;
    return rb - ra;
  });
  return list;
}
function sortBtnsHTML() {
  return `<div style="display:flex;gap:6px">
    <button class="sort-btn ${sortMode==='alpha'?'on':''}" onclick="setSort('alpha')">A–Z</button>
    <button class="sort-btn ${sortMode==='updated'?'on':''}" onclick="setSort('updated')">Recent</button>
    <button class="sort-btn ${sortMode==='remaining'?'on':''}" onclick="setSort('remaining')">Most Left</button>
  </div>`;
}
function setSort(mode) {
  sortMode = mode;
  ['alpha','updated','remaining'].forEach(m => {
    document.getElementById('sort-'+m)?.classList.toggle('on', m===mode);
  });
  document.querySelectorAll('.sort-btns-shared').forEach(el => el.innerHTML = sortBtnsHTML());
  renderAll();
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function setTab(tab) {
  ['watching','caughtup','finished','watchlist','paused','dropped','recs','stats','settings'].forEach(t=>{
    document.getElementById('tab-'+t)?.classList.toggle('hide',t!==tab);
    document.getElementById('t-'+t)?.classList.toggle('on',t===tab);
  });
  document.getElementById('search-wrap').classList.toggle('hide',['recs','stats','settings'].includes(tab));
  if(tab==='recs') loadDiscover();
  if(tab==='stats') loadStats();
  if(tab==='settings') loadSettings();
}

// ── RENDER ALL ────────────────────────────────────────────────────────────────
function renderAll() {
  const groups={watching:[],upcoming:[],caughtup:[],finished:[],watchlist:[],paused:[],dropped:[]};
  shows.forEach(s=>{
    if(s.status==='caughtup'){
      const next=nextEps.get(s.tmdb_id);
      if(next?.next_air_date) groups.upcoming.push(s);
      else groups.caughtup.push(s);
    } else if(groups[s.status]!==undefined){
      groups[s.status].push(s);
    }
  });

  const watchingList = sortList(groups.watching);
  const wcnt=document.getElementById('cnt-watching');
  if(wcnt) wcnt.textContent=watchingList.length;
  const wgrid=document.getElementById('grid-watching');
  if(wgrid) wgrid.innerHTML=watchingList.length?watchingList.map(s=>showCard(s)).join(''):`<div class="empty"><div class="empty-icon">▶️</div>Nothing here yet</div>`;

  const ucnt=document.getElementById('cnt-upcoming');
  if(ucnt) ucnt.textContent=groups.upcoming.length;
  const ugrid=document.getElementById('grid-upcoming');
  if(ugrid) ugrid.innerHTML=groups.upcoming.length?groups.upcoming.map(s=>showCard(s)).join(''):`<div class="empty" style="padding:20px"><div style="font-size:13px;color:var(--muted)">No upcoming shows within 90 days</div></div>`;

  ['caughtup','finished','watchlist','paused','dropped'].forEach(status=>{
    const list=sortList(groups[status]);
    const cnt=document.getElementById('cnt-'+status);
    if(cnt) cnt.textContent=list.length;
    const grid=document.getElementById('grid-'+status);
    if(!grid) return;
    if(!list.length){grid.innerHTML=`<div class="empty"><div class="empty-icon">${sIcon(status)}</div>Nothing here yet</div>`;return;}
    grid.innerHTML=list.map(s=>showCard(s)).join('');
  });

  document.querySelectorAll('.sort-btns-shared').forEach(el => el.innerHTML = sortBtnsHTML());
}

function showCard(s) {
  const next = nextEps.get(s.tmdb_id);
  const poster = s.poster_path
    ?`<img class="poster" src="${IMG}/w300${s.poster_path}" alt="${esc(s.title)}" loading="lazy" onerror="this.outerHTML='<div class=poster-ph>📺</div>'"/>`
    :`<div class="poster-ph">📺</div>`;

  const tmdbStatus = s.tmdb_status || showDetails.get(s.tmdb_id)?.status;
  const activelyReleasing = next?.actively_releasing ?? showDetails.get(s.tmdb_id)?.actively_releasing;
  const nextAirDate = next?.next_air_date;
  const airsToday = nextAirDate && (() => {
    const today = new Date(); const air = new Date(nextAirDate);
    return air.getUTCFullYear()===today.getUTCFullYear() && air.getUTCMonth()===today.getUTCMonth() && air.getUTCDate()===today.getUTCDate();
  })();
  let banner='';
  if(tmdbStatus==='Ended'||tmdbStatus==='Canceled'||tmdbStatus==='Cancelled'){
    banner=`<div class="status-banner banner-red">Series Ended</div>`;
  } else if(airsToday){
    banner=`<div class="status-banner banner-blue">⚡ Airs Today</div>`;
  } else if(activelyReleasing){
    banner=`<div class="status-banner banner-green">Now Airing</div>`;
  } else if(tmdbStatus==='Returning Series'||tmdbStatus==='In Production'){
    banner=`<div class="status-banner banner-yellow">Coming Back</div>`;
  }

  const nextEpHTML = ['watching','caughtup'].includes(s.status) ? buildNextEpHTML(s,next) : '';
  const progressHTML = ['watching','caughtup'].includes(s.status) ? buildProgressHTML(next) : '';

  const startYear = s.year||'';
  const endDate = s.last_air_date ? s.last_air_date.slice(0, 4) : '';
  const showEnded = ['Ended','Canceled','Cancelled'].includes(tmdbStatus||'');
  let dateStr = startYear;
  if(showEnded && endDate) dateStr = `${startYear} – ${endDate}`;
  else if(startYear) dateStr = `${startYear} –`;

  return `<div class="show-card" id="card-${s.id}">
    ${banner}
    <div onclick="openDetail(${s.tmdb_id},${s.id})">
      ${poster}
      <div class="card-body" style="${banner?'padding-top:12px':''}">
        <div class="card-title">${esc(s.title)}</div>
        <div class="card-dates">${dateStr}</div>
      </div>
    </div>
    <div id="next-ep-${s.id}">${nextEpHTML}</div>
    <div id="prog-${s.id}">${progressHTML}</div>
    <div style="padding:0 6px 6px;display:flex;justify-content:flex-end">
      ${s.status==='watchlist'&&s.platform?`<div class="platform-badge" style="margin-right:auto">📺 ${esc(s.platform)}</div>`:''}
      <button class="ca-btn del" onclick="deleteShow(event,${s.id})" title="Remove">✕</button>
    </div>
  </div>`;
}

function buildNextEpHTML(show, next) {
  if(!next) return `<div class="next-ep"><div class="next-ep-label">Next Episode</div><div class="next-ep-num" style="color:var(--muted)">Loading...</div></div>`;
  if(next.error) return '';
  if(!next.all_watched) {
    return `<div class="next-ep">
      <div class="next-ep-label">Next Up</div>
      <div class="next-ep-title">${esc(next.name||'Episode '+next.episode_number)}</div>
      <div class="next-ep-bottom">
        <span class="next-ep-num">S${next.season_number} E${next.episode_number}</span>
        <button class="btn-watched-ep" id="watched-btn-${show.id}" onclick="markNextWatched(event,${show.id},${show.tmdb_id},${next.season_number},${next.episode_number})">✓ Watched</button>
      </div>
    </div>`;
  }
  if(next.show_ended) return `<div class="next-ep"><div class="next-ep-label">Status</div><div class="next-ep-title" style="color:var(--green)">🎉 All caught up</div></div>`;
  if(next.next_air_date) {
    const days=Math.ceil((new Date(next.next_air_date)-new Date())/(1000*60*60*24));
    const dStr=days<=0?'Airs today!':days===1?'Tomorrow':`${days} days`;
    return `<div class="next-ep">
      <div class="next-ep-label">Next Episode</div>
      <div class="next-ep-title">S${next.next_air_season} E${next.next_air_ep}</div>
      <div class="next-ep-num" style="color:${days<=3?'#ffd60a':'var(--muted)'}">📅 ${fmtDate(next.next_air_date)} · ${dStr}</div>
    </div>`;
  }
  return `<div class="next-ep"><div class="next-ep-label">Next Episode</div><div class="next-ep-title" style="color:var(--muted)">TBD</div><div class="next-ep-num">No air date yet</div></div>`;
}

function buildProgressHTML(next) {
  if(!next||next.error) return '';
  const w=next.total_watched||0, t=next.total_aired||0;
  if(!t) return '';
  const pct=Math.min(100,Math.round((w/t)*100));
  return `<div class="ep-prog-wrap">
    <div class="ep-prog-row"><span>${w} / ${t} episodes</span><span>${pct}%</span></div>
    <div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function updateCardNextEp(show) {
  const next=nextEps.get(show.tmdb_id);
  const nc=document.getElementById('next-ep-'+show.id);
  if(nc) nc.innerHTML=buildNextEpHTML(show,next);
  const pc=document.getElementById('prog-'+show.id);
  if(pc) pc.innerHTML=buildProgressHTML(next);
}

// ── LOAD NEXT EPISODES ────────────────────────────────────────────────────────
async function loadNextEpisodes() {
  const active = shows.filter(s => ['watching','caughtup'].includes(s.status));
  const others = shows.filter(s => !['watching','caughtup'].includes(s.status));

  await Promise.all(active.map(async s => {
    const [data, providers] = await Promise.all([
      api(`/api/next-episode/${s.tmdb_id}`),
      api(`/api/tmdb/show/${s.tmdb_id}/providers`),
    ]);
    nextEps.set(s.tmdb_id, data);
    if (Array.isArray(providers)) showProviders.set(s.tmdb_id, providers);
    if (data.tmdb_status) {
      s.tmdb_status = data.tmdb_status;
      s.last_air_date = data.last_air_date || s.last_air_date;
      showDetails.set(s.tmdb_id, { status: data.tmdb_status, actively_releasing: data.actively_releasing, last_air_date: data.last_air_date });
    }
    if (data.suggested_status && data.suggested_status !== s.status && ['watching','caughtup','finished'].includes(s.status)) {
      autoMoveStatus(s, data.suggested_status);
    }
  }));

  renderAll();

  for (const s of others) {
    const data = await api(`/api/next-episode/${s.tmdb_id}`);
    nextEps.set(s.tmdb_id, data);
    if (data.tmdb_status) {
      s.tmdb_status = data.tmdb_status;
      s.last_air_date = data.last_air_date || s.last_air_date;
      showDetails.set(s.tmdb_id, { status: data.tmdb_status, actively_releasing: data.actively_releasing, last_air_date: data.last_air_date });
    }
    const card = document.getElementById('card-' + s.id);
    if (card) card.outerHTML = showCard(s);
  }
  renderAll();
}

async function autoMoveStatus(show, suggestedStatus) {
  const res = await api(`/api/shows/${show.id}`, {method:'PATCH', body:{status: suggestedStatus}});
  if (res.id) { show.status = suggestedStatus; renderAll(); }
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
function onSearch(q){
  clearTimeout(searchTimer);
  if(!q.trim()){document.getElementById('search-results').classList.add('hide');return;}
  searchTimer=setTimeout(()=>doSearch(q),300);
}
async function doSearch(q) {
  const results=await api('/api/search?q='+encodeURIComponent(q));
  const res=document.getElementById('search-results');
  if(!results.length){res.classList.add('hide');return;}
  res.innerHTML=results.map(r=>{
    const inList=shows.some(s=>s.tmdb_id===r.tmdb_id);
    const pe=r.poster_path?`<img class="sr-poster" src="${IMG}/w92${r.poster_path}" alt=""/>`:`<div class="sr-poster" style="display:flex;align-items:center;justify-content:center">📺</div>`;
    return `<div class="sr-item">${pe}
      <div class="sr-info"><div class="sr-title">${esc(r.title)}</div><div class="sr-year">${r.year||''}</div></div>
      <div class="sr-actions">${inList
        ?`<span style="font-size:11px;color:var(--muted);padding:4px 8px">Added ✓</span>`
        :`<button class="btn-add watching" onmousedown="addShow(event,${JSON.stringify(r).replace(/"/g,'&quot;')},'watching')">▶ Watching</button>
          <button class="btn-add watchlist" onmousedown="addShow(event,${JSON.stringify(r).replace(/"/g,'&quot;')},'watchlist')">📋 Watchlist</button>`
      }</div>
    </div>`;
  }).join('');
  res.classList.remove('hide');
}
function closeSearch(){document.getElementById('search-results').classList.add('hide');}

async function addShow(event, show, status) {
  event.preventDefault();
  if(shows.some(s=>s.tmdb_id===show.tmdb_id)) return;
  const res=await api('/api/shows',{method:'POST',body:{...show,status}});
  if(res.id){
    const idx=shows.findIndex(s=>s.tmdb_id===res.tmdb_id);
    if(idx>=0) shows[idx]=res; else shows.push(res);
    shows.sort((a,b)=>a.title.localeCompare(b.title));
    renderAll();
    document.getElementById('search-input').value='';
    document.getElementById('search-results').classList.add('hide');
    if(status==='watching') api(`/api/next-episode/${show.tmdb_id}`).then(next=>{nextEps.set(show.tmdb_id,next);const s=shows.find(x=>x.tmdb_id===show.tmdb_id);if(s)updateCardNextEp(s);});
    toast(`Added to ${sLabel(status)}`);
  }
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') {
    if(document.getElementById('resolve-panel')) { document.getElementById('resolve-panel').remove(); return; }
    if(!document.getElementById('ep-modal').classList.contains('hide')) { closeEpModal(); return; }
    if(!document.getElementById('rec-modal').classList.contains('hide')) { closeRecModal(); return; }
    if(document.getElementById('detail-panel').classList.contains('open')) { closeDetail(); return; }
  }
  if(document.getElementById('detail-panel').classList.contains('open') && currentSeason) {
    const tabs = [...document.querySelectorAll('.s-tab')];
    const idx = tabs.findIndex(t => parseInt(t.id.replace('stab-','')) === currentSeason);
    if(e.key === 'ArrowRight' && idx < tabs.length-1) tabs[idx+1].click();
    else if(e.key === 'ArrowLeft' && idx > 0) tabs[idx-1].click();
  }
});

init();

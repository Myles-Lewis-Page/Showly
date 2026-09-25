// ── DETAIL PANEL ──────────────────────────────────────────────────────────────
async function openDetail(tmdbId,showId){
  currentDetail={tmdbId,id:showId};
  const overlay=document.getElementById('detail-overlay');
  const panel=document.getElementById('detail-panel');
  const content=document.getElementById('detail-content');
  content.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>';
  overlay.classList.add('open'); panel.classList.add('open');
  document.body.style.overflow='hidden';

  const id=parseInt(tmdbId);
  let details={}, epData=[], similarData=[], freshNextEp=null;
  try {
    [details, epData, similarData, freshNextEp] = await Promise.all([
      api(`/api/tmdb/show/${id}`).then(r => r||{}),
      api(`/api/episodes/${id}`).then(r => Array.isArray(r)?r:[]),
      api(`/api/tmdb/show/${id}/similar`).then(r => Array.isArray(r)?r:[]),
      api(`/api/next-episode/${id}`).then(r => r||null).catch(()=>null),
    ]);
    if (freshNextEp && !freshNextEp.error) nextEps.set(id, freshNextEp);
  } catch(e) {
    content.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Failed to load show. Try again.</div>';
    return;
  }
  if(!details.name && !details.id) {
    content.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Could not load show details.</div>';
    return;
  }

  const epSet=new Set(Array.isArray(epData)?epData.map(e=>`${e.season_number}_${e.episode_number}`):[]);
  const epDates=new Map(Array.isArray(epData)?epData.filter(e=>e.date_is_explicit && e.watched_at).map(e=>[`${e.season_number}_${e.episode_number}`,e.watched_at]):[]);
  watchedEps.set(id,epSet);
  watchedDates.set(id,epDates);

  if (Array.isArray(details.streaming_providers)) showProviders.set(id, details.streaming_providers);
  showDetails.set(id,{status:details.status,actively_releasing:nextEps.get(id)?.actively_releasing,last_air_date:details.last_air_date,first_air_date:details.first_air_date});

  const show=shows.find(s=>s.id===showId);
  const status=show?.status||'watching';
  const seasons=(details.seasons||[]).filter(s=>s.season_number>0);
  const cast=(details.credits?.cast||[]).slice(0,12);
  const backdrop=details.backdrop_path?`${IMG}/w1280${details.backdrop_path}`:null;
  const poster=details.poster_path?`${IMG}/w300${details.poster_path}`:null;

  const nextEpInfo = nextEps.get(id) || null;
  const defaultSeason = nextEpInfo && !nextEpInfo.all_watched ? nextEpInfo.season_number : (seasons[0]?.season_number||1);

  const totalAired = nextEpInfo?.total_aired || seasons.reduce((sum,s)=>sum+(s.episode_count||0),0) || details.number_of_episodes || 0;
  const totalEps = totalAired;
  const watchedCount = Array.from(epSet).filter(k => !k.startsWith('0_')).length;
  const remaining = Math.max(0, totalEps - watchedCount);
  const avgRuntime = details.episode_run_time?.[0] || 45;
  const minsLeft = remaining * avgRuntime;
  const timeStr = remaining===0 ? '🎉' : fmtTime(minsLeft);
  const pct = totalEps > 0 ? Math.min(100, Math.round((watchedCount/totalEps)*100)) : 0;

  const startDate=fmtDate(details.first_air_date)||show?.year||'';
  const endDate=details.last_air_date?fmtDate(details.last_air_date):'';
  const showEnded=['Ended','Canceled','Cancelled'].includes(details.status);
  const dateRange=showEnded&&endDate?`${startDate} – ${endDate}`:startDate?`Started ${startDate}`:'';

  const statsHTML=totalEps>0?`
    <div class="panel-section-title">Progress</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:5px">
      <span>${watchedCount} of ${totalEps} episodes</span><span>${pct}%</span>
    </div>
    <div class="ep-prog-bar" style="margin-bottom:14px"><div class="ep-prog-fill" style="width:${pct}%"></div></div>
    <div class="panel-stats">
      <div class="p-stat"><div class="p-stat-num">${remaining}</div><div class="p-stat-label">Episodes Left</div><div class="p-stat-sub">of ${totalEps} total</div></div>
      <div class="p-stat"><div class="p-stat-num" style="font-size:clamp(12px,2.5vw,18px)">${timeStr}</div><div class="p-stat-label">${remaining===0?'All done!':'Time Remaining'}</div>${remaining>0?`<div class="p-stat-sub">~${avgRuntime}m per ep</div>`:''}</div>
    </div>`:'';

  const providers = details.streaming_providers || [];
  const hasPlatform = !!(show?.platform);
  const selectedProviderLogo = hasPlatform ? providers.find(p=>p.provider_name===show.platform)?.logo_path : null;
  const whereToWatchHTML = providers.length || hasPlatform ? `
    <div id="where-to-watch-section">
      <div class="panel-section-title">Where to Watch</div>
      ${hasPlatform ? `
        <div style="display:flex;align-items:center;gap:10px;background:rgba(56,161,105,.1);border:1px solid rgba(56,161,105,.3);border-radius:10px;padding:10px 14px">
          ${selectedProviderLogo?`<img src="https://image.tmdb.org/t/p/w92${selectedProviderLogo}" style="width:28px;height:28px;border-radius:6px;object-fit:cover"/>`:'' }
          <span style="font-size:14px;font-weight:600;color:var(--green)">▶ Watching on ${esc(show.platform)}</span>
          <button onclick="clearProviderPlatform(${showId})" style="margin-left:auto;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0 2px">×</button>
        </div>` : `
        <div class="provider-row" style="flex-wrap:wrap">
          ${providers.slice(0,8).map(p=>`
            <div class="provider-chip" style="cursor:pointer;transition:all .15s"
              onclick="selectProviderPlatform(${showId},'${esc(p.provider_name)}')">
              ${p.logo_path?`<img class="provider-logo" src="https://image.tmdb.org/t/p/w92${p.logo_path}" alt=""/>`:''} 
              <span>${esc(p.provider_name)}</span>
            </div>`).join('')}
        </div>`}
    </div>` : '';

  try {
    content.innerHTML=`
      <button class="panel-close" onclick="closeDetail()">← Close</button>
      ${backdrop?`<img class="panel-backdrop" src="${backdrop}" alt=""/>`:`<div class="panel-backdrop-ph">📺</div>`}
      <div class="panel-body">
        <div class="panel-top">
          ${poster?`<img class="panel-poster" src="${poster}" alt="${esc(details.name||'')}"/>`:`<div class="panel-poster-ph">📺</div>`}
          <div class="panel-info">
            <div class="panel-title">${esc(details.name||'')}</div>
            <div class="panel-meta">
              ${details.vote_average?`<span>⭐ ${details.vote_average.toFixed(1)}</span>`:''}
              ${details.number_of_seasons?`<span>📺 ${details.number_of_seasons} season${details.number_of_seasons>1?'s':''}</span>`:''}
              ${details.number_of_episodes?`<span>${details.number_of_episodes} eps</span>`:''}
              ${details.status?`<span>${details.status}</span>`:''}
              ${show?.platform?`<span style="color:var(--green)">▶ ${esc(show.platform)}</span>`:''}
            </div>
            ${dateRange?`<div class="panel-dates">📅 ${dateRange}</div>`:''}
            <div class="panel-genres">${(details.genres||[]).map(g=>`<span class="genre-tag">${esc(g.name)}</span>`).join('')}</div>
          </div>
        </div>
        ${whereToWatchHTML}
        <div class="panel-section-title">Status</div>
        <div class="panel-status-row" id="panel-status-row">${panelStatusHTML(status,showId)}</div>
        ${statsHTML}
        ${details.overview?`<div class="panel-overview">${esc(details.overview)}</div>`:''}
        ${cast.length?`
          <div class="panel-section-title">Cast</div>
          <div class="cast-scroll">${cast.map(c=>`
            <div class="cast-item">
              ${c.profile_path?`<img class="cast-img" src="${IMG}/w185${c.profile_path}" alt="" onerror="this.style.background='var(--surface3)'"/>`:`<div class="cast-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">👤</div>`}
              <div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character||'')}</div>
            </div>`).join('')}
          </div>`:''}
        ${seasons.length?`
          <div class="panel-section-title">Episodes
            <button class="btn-edit-seasons" onclick="openSeasonEditor(${id},${showId})" title="Regroup episodes into custom sagas/arcs">✏️ Edit Sagas</button>
          </div>
          <div id="total-progress-wrap"></div>
          <div class="season-tabs" id="season-tabs"><div style="padding:8px;color:var(--muted);font-size:12px">Loading seasons…</div></div>
          <div id="season-content"><div style="text-align:center;padding:20px;color:var(--muted)">Loading...</div></div>`:''}
        ${similarData?.length?`
          <div class="panel-section-title">Similar Shows</div>
          <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px" id="similar-row">
            ${similarData.map((s,i)=>{
              const inList=shows.some(x=>x.tmdb_id===s.tmdb_id);
              return `<div style="flex-shrink:0;width:90px;cursor:pointer" onclick="openSimilar(${i})" data-similar-idx="${i}">
                ${s.poster_path?`<img src="${IMG}/w300${s.poster_path}" style="width:90px;height:135px;border-radius:8px;object-fit:cover;border:1px solid var(--border)" alt=""/>`:
                `<div style="width:90px;height:135px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:24px">📺</div>`}
                <div style="font-size:11px;margin-top:5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(s.title)}</div>
                ${inList?`<div style="font-size:10px;color:var(--green)">✓ In list</div>`:''}
              </div>`;
            }).join('')}
          </div>`:''}
      </div>`;

    currentSimilarData = similarData || [];
    if(seasons.length) loadDisplaySeasons(id,showId,defaultSeason);
  } catch(err) {
    console.error('Panel render error:', err);
    content.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Error loading show details.</div>`;
  }
}

function panelStatusHTML(status,showId){
  return[['watching','▶ Watching','aw'],['caughtup','🔄 Caught Up','ac'],['finished','✅ Finished','af'],['watchlist','📋 Watchlist','awl'],['paused','⏸ Paused','au'],['dropped','🚫 Drop','ad']]
    .map(([s,l,c])=>`<button class="ps-btn ${status===s?c:''}" onclick="setPanelStatus('${s}',${showId})">${l}</button>`).join('');
}
function renderPanelStatusBtns(status,showId){const r=document.getElementById('panel-status-row');if(r)r.innerHTML=panelStatusHTML(status,showId);}
async function setPanelStatus(newStatus,showId){
  const res=await api(`/api/shows/${showId}`,{method:'PATCH',body:{status:newStatus}});
  if(!res.id) return;
  const show=shows.find(s=>s.id===showId);
  if(show){show.status=newStatus;renderAll();}
  renderPanelStatusBtns(newStatus,showId);
  toast(sLabel(newStatus));
}

function closeDetail(){
  document.getElementById('detail-overlay').classList.remove('open');
  document.getElementById('detail-panel').classList.remove('open');
  document.body.style.overflow='';
  currentDetail=null;
  currentSeason=null;
}

function openSimilar(idx) {
  const show = currentSimilarData[idx];
  if (show) openRecModal(show);
}

// ── PROVIDER / PLATFORM ───────────────────────────────────────────────────────
async function selectProviderPlatform(showId, platform) {
  const res = await api(`/api/shows/${showId}`, { method:'PATCH', body:{ platform } });
  if (res.id) {
    const show = shows.find(s => s.id === showId);
    if (show) show.platform = platform;
    renderAll();
    const section = document.getElementById('where-to-watch-section');
    if (section) {
      const providers = showProviders.get(currentDetail?.tmdbId) || [];
      const selectedLogo = providers.find(p=>p.provider_name===platform)?.logo_path;
      section.innerHTML = `
        <div class="panel-section-title">Where to Watch</div>
        <div style="display:flex;align-items:center;gap:10px;background:rgba(56,161,105,.1);border:1px solid rgba(56,161,105,.3);border-radius:10px;padding:10px 14px">
          ${selectedLogo?`<img src="https://image.tmdb.org/t/p/w92${selectedLogo}" style="width:28px;height:28px;border-radius:6px;object-fit:cover"/>`:'' }
          <span style="font-size:14px;font-weight:600;color:var(--green)">▶ Watching on ${esc(platform)}</span>
          <button onclick="clearProviderPlatform(${showId})" style="margin-left:auto;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0 2px">×</button>
        </div>`;
    }
    toast(`Watching on ${platform}`);
  }
}

async function clearProviderPlatform(showId) {
  const res = await api(`/api/shows/${showId}`, { method:'PATCH', body:{ platform: '' } });
  if (res.id) {
    const show = shows.find(s => s.id === showId);
    if (show) show.platform = '';
    renderAll();
    const section = document.getElementById('where-to-watch-section');
    if (section) {
      const providers = showProviders.get(currentDetail?.tmdbId) || [];
      section.innerHTML = `
        <div class="panel-section-title">Where to Watch</div>
        <div class="provider-row" style="flex-wrap:wrap">
          ${providers.slice(0,8).map(p=>`
            <div class="provider-chip" style="cursor:pointer;transition:all .15s"
              onclick="selectProviderPlatform(${showId},'${esc(p.provider_name)}')">
              ${p.logo_path?`<img class="provider-logo" src="https://image.tmdb.org/t/p/w92${p.logo_path}" alt=""/>`:''} 
              <span>${esc(p.provider_name)}</span>
            </div>`).join('')}
        </div>`;
    }
    toast('Platform cleared');
  }
}

// ── SEASON / EPISODES (custom display grouping) ────────────────────────────
// Fetches the merged TMDB + override view once per panel open, builds tabs from
// display_season/display_sub_season groups, and renders the requested group.
// Raw TMDB season/episode numbers (never display numbers) are what drive watched
// tracking and the new-episode sync — see server.js /api/tmdb/show/:id/display-seasons.
async function loadDisplaySeasons(tmdbId,showId,preferredRawSeason){
  const id=parseInt(tmdbId);
  const tabsEl=document.getElementById('season-tabs');
  try {
    const data=await api(`/api/tmdb/show/${id}/display-seasons`);
    if(!data || data.error || !Array.isArray(data.seasons)) { if(tabsEl) tabsEl.innerHTML='<div style="padding:8px;color:var(--muted);font-size:12px">Could not load seasons.</div>'; return; }
    displaySeasonData.set(id,data);

    // Pick default: the group containing the preferred raw season, else the first group
    let defaultGroup = data.seasons.find(g=>g.episodes.some(e=>e.season_number===preferredRawSeason)) || data.seasons[0];
    const defaultKey = `${defaultGroup.display_season}_${defaultGroup.display_sub_season ?? ''}`;

    if(tabsEl){
      tabsEl.innerHTML = data.seasons.map(g=>{
        const key=`${g.display_season}_${g.display_sub_season ?? ''}`;
        const label = `${g.display_season}.${g.display_sub_season ?? 1}${g.sub_season_label?' '+esc(g.sub_season_label):''}`;
        return `<button class="s-tab ${key===defaultKey?'on':''}" onclick="renderSeasonGroup(${id},${showId},'${key.replace(/'/g,"\\'")}')" id="stab-${key.replace(/[^a-zA-Z0-9]/g,'_')}">${label}</button>`;
      }).join('');
    }
    renderSeasonGroup(id,showId,defaultKey);
  } catch(err) {
    console.error('loadDisplaySeasons error:', err);
    if(tabsEl) tabsEl.innerHTML='<div style="padding:8px;color:var(--muted);font-size:12px">Error loading seasons.</div>';
  }
}

function renderSeasonGroup(tmdbId,showId,groupKey){
  currentGroupKey=groupKey;
  const id=parseInt(tmdbId);
  document.querySelectorAll('.s-tab').forEach(t=>t.classList.toggle('on',t.id===`stab-${groupKey.replace(/[^a-zA-Z0-9]/g,'_')}`));
  const container=document.getElementById('season-content');
  if(!container) return;
  const data=displaySeasonData.get(id);
  const group=(data?.seasons||[]).find(g=>`${g.display_season}_${g.display_sub_season ?? ''}`===groupKey);
  if(!group){ container.innerHTML='<div style="padding:16px;color:var(--muted)">Could not load season.</div>'; return; }

  const episodes=group.episodes;
  const epSet=watchedEps.get(id)||new Set();
  const watchedInSeason=episodes.filter(e=>epSet.has(`${e.season_number}_${e.episode_number}`)).length;
  const allWatched=episodes.length>0&&watchedInSeason===episodes.length;

  const airedEps = episodes.filter(e=>e.air_date);
  const firstAir = airedEps[0]?.air_date;
  const lastAir = airedEps[airedEps.length-1]?.air_date;
  const seasonDateRange = firstAir ? (lastAir && lastAir !== firstAir
    ? `${fmtDate(firstAir)} – ${fmtDate(lastAir)}`
    : fmtDate(firstAir)) : '';
  const seasonLabel = `Saga ${group.display_season}${group.sub_season_label?' — '+esc(group.sub_season_label):(group.display_sub_season!=null?' — Arc '+group.display_sub_season:'')}`;
  const seasonNameHTML = `<div class="season-name">${esc(seasonLabel)}</div>`;

  updateTotalProgress(id);

  currentSeasonEpisodes.set(`${id}_${groupKey}`, episodes);
  window._seasonEpPairs = window._seasonEpPairs || {};
  window._seasonEpPairs[`${id}_${groupKey}`] = episodes.map(e=>({season_number:e.season_number,episode_number:e.episode_number}));

  // ── Tag filter/sort bar ──
  const filt=getSeasonFilter(id);
  const tagsInGroup=new Set();
  episodes.forEach(e=>(e.tags||[]).forEach(t=>tagsInGroup.add(t)));
  TAG_PRESETS.forEach(t=>tagsInGroup.add(t));
  const tagChipsHTML=Array.from(tagsInGroup).map(t=>{
    const hidden=filt.hiddenTags.has(t);
    return `<button class="tag-chip ${hidden?'hidden-state':''}" onclick="toggleTagVisibility(${id},${showId},${JSON.stringify(t)})" title="${hidden?'Hidden — click to show':'Click to hide episodes tagged '+esc(t)}">${hidden?'🚫 ':''}${esc(t)}</button>`;
  }).join('');
  const filterBarHTML=`
    <div class="tag-filter-bar">
      <div class="tag-chips-row">${tagChipsHTML}</div>
      <select class="tag-sort-select" onchange="setSortMode(${id},${showId},this.value)">
        <option value="air" ${filt.sortMode==='air'?'selected':''}>Sort: Air order</option>
        <option value="tag" ${filt.sortMode==='tag'?'selected':''}>Sort: Group by tag</option>
      </select>
    </div>`;

  // ── Apply visibility filter + sort for display only (progress counts above use the full unfiltered group) ──
  let visibleEpisodes=episodes.filter(e=>!(e.tags||[]).some(t=>filt.hiddenTags.has(t)));
  if(filt.sortMode==='tag'){
    const rank=t=>{const i=TAG_PRESETS.indexOf(t);return i===-1?TAG_PRESETS.length:i;};
    visibleEpisodes=[...visibleEpisodes].sort((a,b)=>{
      const at=(a.tags||[])[0], bt=(b.tags||[])[0];
      const ar=at?rank(at):999, br=bt?rank(bt):999;
      if(ar!==br) return ar-br;
      if((at||'')!==(bt||'')) return (at||'').localeCompare(bt||'');
      return a.season_number-b.season_number || a.episode_number-b.episode_number;
    });
  }

  const rows = visibleEpisodes.map((ep)=>{
    const epIdx=episodes.indexOf(ep);
    const seasonNum=ep.season_number, epNumRaw=ep.episode_number;
    const watched=epSet.has(`${seasonNum}_${epNumRaw}`);
    const watKey=`${seasonNum}_${epNumRaw}`;
    const watchedAt=(watchedDates.get(id)||new Map()).get(watKey);
    const watchedAtStr=watchedAt?fmtWatchedDate(watchedAt):'';
    const still=ep.still_path?`${IMG}/w300${ep.still_path}`:null;
    const runtime=ep.runtime?`${ep.runtime}m`:'';
    const dispNum=ep.display_episode_number!=null?ep.display_episode_number:epNumRaw;
    const epName = esc(ep.name||'Episode '+dispNum);
    const epAirDate = ep.air_date?fmtDate(ep.air_date):'';
    const modifiedTag = ep.is_modified?'<span class="ep-modified-tag" title="Custom placement — won\'t be moved by episode syncing">✎</span>':'';
    const epTagsHTML=(ep.tags||[]).map(t=>`<span class="ep-tag-pill">${esc(t)}</span>`).join('');
    return `<div class="ep-row ${watched?'watched':''}" id="ep-${id}-${seasonNum}-${epNumRaw}"
      onclick="clickEpisode(event,${id},${showId},${seasonNum},${epNumRaw},${epIdx},'${groupKey.replace(/'/g,"\\'")}')">
      <div class="ep-row-actions">
        <button class="ep-edit-btn" onclick="event.stopPropagation();openEpisodeRegroup(${id},${seasonNum},${epNumRaw},${dispNum})" title="Reassign season/episode #">${modifiedTag||'⚙️'}</button>
        <button class="ep-edit-btn" onclick="event.stopPropagation();openTagEditor(${id},${showId},${seasonNum},${epNumRaw},'${groupKey.replace(/'/g,"\\'")}')" title="Edit tags">🏷️</button>
      </div>
        <span class="ep-num">${dispNum}</span>
        ${still?`<img class="ep-still" src="${still}" alt="" loading="lazy" onerror="this.outerHTML='<div class=ep-still-ph>📺</div>'"/>`:`<div class="ep-still-ph">📺</div>`}
        <div class="ep-info">
          <div class="ep-name">${epName}</div>
          <div class="ep-date">${[epAirDate, runtime].filter(Boolean).join(' · ')}</div>
          ${epTagsHTML?`<div class="ep-tags-row">${epTagsHTML}</div>`:''}
          ${watched?`<div class="ep-watched-date" id="epwd-${id}-${seasonNum}-${epNumRaw}">
            ${watchedAtStr?`👁 ${watchedAtStr}`:'<span style="color:var(--muted);font-style:italic">No watch date</span>'}
            <button class="ep-date-edit-btn" onclick="openEpDatePicker(event,${id},${seasonNum},${epNumRaw})" title="Set watch date">✏️</button>
          </div>`:''}
        </div>
        <div class="ep-check" id="epchk-${id}-${seasonNum}-${epNumRaw}">${watched?'✓':''}</div>
      </div>`;
    }).join('');

    // Overview block — always includes season name space + optional date range
    const seasonOverview = `
      <div style="padding:10px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px">
        ${seasonNameHTML}
        ${seasonDateRange ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px">📅 ${seasonDateRange}</div>` : ''}
      </div>`;

    container.innerHTML=`
      <div class="season-header">
        <span class="season-progress">${watchedInSeason} / ${episodes.length} watched</span>
        <button class="btn-mark-season ${allWatched?'all-watched':''}" id="mark-season-btn"
          onclick="toggleGroupWatchedSafe(${id},${showId},'${groupKey.replace(/'/g,"\\'")}',${allWatched})">
          ${allWatched?'✓ All Watched':'Mark All Watched'}
        </button>
      </div>
      ${seasonOverview}
      ${filterBarHTML}
      <div class="episodes-list">${rows || '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">No episodes match the current filters.</div>'}</div>`;
}

function toggleTagVisibility(tmdbId,showId,tag){
  const filt=getSeasonFilter(tmdbId);
  if(filt.hiddenTags.has(tag)) filt.hiddenTags.delete(tag); else filt.hiddenTags.add(tag);
  renderSeasonGroup(tmdbId,showId,currentGroupKey);
}
function setSortMode(tmdbId,showId,mode){
  getSeasonFilter(tmdbId).sortMode=mode;
  renderSeasonGroup(tmdbId,showId,currentGroupKey);
}

function updateTotalProgress(tmdbId){
  const wrap=document.getElementById('total-progress-wrap');
  if(!wrap) return;
  const epSet=watchedEps.get(parseInt(tmdbId))||new Set();
  const next=nextEps.get(parseInt(tmdbId));
  const totalAired=next?.total_aired||0;
  if(!totalAired){wrap.innerHTML='';return;}
  const w=Array.from(epSet).filter(k => !k.startsWith('0_')).length,pct=Math.min(100,Math.round((w/totalAired)*100));
  wrap.innerHTML=`<div class="total-progress">
    <div class="total-prog-row"><span>Total: ${w} / ${totalAired} episodes watched</span><span>${pct}%</span></div>
    <div class="total-prog-bar"><div class="total-prog-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function clickEpisode(event, tmdbId, showId, season, epNum, epIdx, groupKey) {
  const ep = (currentSeasonEpisodes.get(`${tmdbId}_${groupKey}`) || [])[epIdx] || {};
  const target = event.target;
  if (target.classList.contains('ep-check') || target.closest('.ep-check')) {
    toggleEpisode(tmdbId, showId, season, epNum, groupKey);
  } else {
    const dispNum = ep.display_episode_number!=null?ep.display_episode_number:epNum;
    openEpModal(tmdbId, showId, season, epNum, ep.name||'Episode '+dispNum, ep.still_path||'', ep.overview||'', ep.air_date||'');
  }
}

async function toggleEpisode(tmdbId,showId,season,epNum,groupKey){
  const id=parseInt(tmdbId);
  const key=`${season}_${epNum}`;
  const epSet=watchedEps.get(id)||new Set();
  const row=document.getElementById(`ep-${id}-${season}-${epNum}`);
  const chk=document.getElementById(`epchk-${id}-${season}-${epNum}`);
  if(epSet.has(key)){
    await api('/api/episodes',{method:'DELETE',body:{tmdb_id:id,season_number:parseInt(season),episode_number:parseInt(epNum)}});
    epSet.delete(key);
    if(row) row.classList.remove('watched');
    if(chk) chk.textContent='';
    const dm=watchedDates.get(id)||new Map(); dm.delete(key); watchedDates.set(id,dm);
  } else {
    const now=new Date().toISOString();
    await api('/api/episodes',{method:'POST',body:{tmdb_id:id,season_number:parseInt(season),episode_number:parseInt(epNum),watched_at:now}});
    epSet.add(key);
    if(row) row.classList.add('watched');
    if(chk) chk.textContent='✓';
    const dm=watchedDates.get(id)||new Map(); dm.set(key,now); watchedDates.set(id,dm);
    const wdEl=document.getElementById(`epwd-${id}-${season}-${epNum}`);
    if(wdEl) wdEl.innerHTML=`👁 ${fmtWatchedDate(now)} <button class="ep-date-edit-btn" onclick="openEpDatePicker(event,${id},${season},${epNum})" title="Set watch date">✏️</button>`;
  }
  watchedEps.set(id,epSet);
  updateGroupProgress(id,groupKey||currentGroupKey);
  updateTotalProgress(id);
  const show=shows.find(s=>s.tmdb_id===id);
  if(show&&['watching','caughtup'].includes(show.status)){
    api(`/api/next-episode/${id}`).then(next=>{nextEps.set(id,next);updateCardNextEp(show);});
  }
}

function toggleGroupWatchedSafe(tmdbId, showId, groupKey, currentlyAllWatched) {
  const pairs = (window._seasonEpPairs || {})[`${tmdbId}_${groupKey}`] || [];
  toggleGroupWatched(tmdbId, showId, groupKey, pairs, currentlyAllWatched);
}

async function toggleGroupWatched(tmdbId,showId,groupKey,pairs,currentlyAllWatched){
  const id=parseInt(tmdbId);
  const epSet=watchedEps.get(id)||new Set();
  if(currentlyAllWatched){
    await api('/api/episodes/pairs',{method:'DELETE',body:{tmdb_id:id,pairs}});
    pairs.forEach(p=>epSet.delete(`${p.season_number}_${p.episode_number}`));
    watchedEps.set(id,epSet);
    renderSeasonGroup(id,showId,groupKey);
    toast('Arc unmarked');
  } else {
    const now=new Date().toISOString();
    await api('/api/episodes/pairs',{method:'POST',body:{tmdb_id:id,pairs,watched_at:now}});
    pairs.forEach(p=>epSet.add(`${p.season_number}_${p.episode_number}`));
    watchedEps.set(id,epSet);
    renderSeasonGroup(id,showId,groupKey);
    toast('Arc marked watched ✓');
    const show=shows.find(s=>s.tmdb_id===id);
    if(show){
      const next=await api(`/api/next-episode/${id}`);
      nextEps.set(id,next);
      updateTotalProgress(id);
      updateCardNextEp(show);
      if(next.suggested_status && next.suggested_status!==show.status && ['watching','caughtup','finished'].includes(show.status)){
        await autoMoveStatus(show,next.suggested_status);
        toast(`Moved to ${sLabel(next.suggested_status)}`);
      }
    }
  }
}

function updateGroupProgress(tmdbId,groupKey){
  const pairs = (window._seasonEpPairs || {})[`${tmdbId}_${groupKey}`] || [];
  const epSet=watchedEps.get(parseInt(tmdbId))||new Set();
  const total=pairs.length;
  const watched=pairs.filter(p=>epSet.has(`${p.season_number}_${p.episode_number}`)).length;
  const prog=document.querySelector('.season-progress');
  if(prog) prog.textContent=`${watched} / ${total} watched`;
  const btn=document.getElementById('mark-season-btn');
  if(btn){const all=watched===total&&total>0;btn.textContent=all?'✓ All Watched':'Mark All Watched';btn.classList.toggle('all-watched',all);}
}

// ── EP MODAL ──────────────────────────────────────────────────────────────────
function openEpModal(tmdbId,showId,season,epNum,name,stillPath,overview,airDate){
  const id=parseInt(tmdbId);
  const epSet=watchedEps.get(id)||new Set();
  const watched=epSet.has(`${season}_${epNum}`);
  const still=stillPath?`${IMG}/w780${stillPath}`:null;
  document.getElementById('ep-modal-content').innerHTML=`
    ${still?`<img class="ep-modal-still" src="${still}" alt=""/>`:`<div class="ep-modal-still-ph">📺</div>`}
    <div class="ep-modal-body">
      <div class="ep-modal-title">${esc(name)}</div>
      <div class="ep-modal-meta"><span>S${season} E${epNum}</span>${airDate?`<span>📅 ${fmtDate(airDate)}</span>`:''}</div>
      ${overview?`<div class="ep-modal-overview">${esc(overview)}</div>`:''}
      <div class="ep-modal-actions">
        <button class="ep-modal-watch ${watched?'ws':''}" id="ep-modal-watch-btn" onclick="toggleEpisodeFromModal(${id},${showId},${season},${epNum})">
          ${watched?'✓ Watched — Mark Unwatched':'▶ Mark as Watched'}
        </button>
        <button class="ep-modal-close" onclick="closeEpModal()">Close</button>
      </div>
    </div>`;
  document.getElementById('ep-modal').classList.remove('hide');
}

async function toggleEpisodeFromModal(tmdbId,showId,season,epNum){
  await toggleEpisode(tmdbId,showId,season,epNum);
  const id=parseInt(tmdbId);
  const epSet=watchedEps.get(id)||new Set();
  const watched=epSet.has(`${season}_${epNum}`);
  const btn=document.getElementById('ep-modal-watch-btn');
  if(btn){btn.textContent=watched?'✓ Watched — Mark Unwatched':'▶ Mark as Watched';btn.className=`ep-modal-watch ${watched?'ws':''}`;}
}
function closeEpModal(){document.getElementById('ep-modal').classList.add('hide');}

// ── EPISODE TAGS (canon / filler / crossover / custom) ──────────────────────
async function openTagEditor(tmdbId,showId,rawSeason,rawEpNum,groupKey){
  document.querySelector('.ep-tag-popover')?.remove();
  const id=parseInt(tmdbId);
  const data=displaySeasonData.get(id);
  const group=(data?.seasons||[]).find(g=>g.episodes.some(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum));
  const ep=group?.episodes.find(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum);
  const currentTags=new Set(ep?.tags||[]);
  const allKnownTags=await api('/api/tags-all/list').catch(()=>[]);
  const chipTags=Array.from(new Set([...TAG_PRESETS, ...(Array.isArray(allKnownTags)?allKnownTags:[])]));

  const pop=document.createElement('div');
  pop.className='ep-tag-popover';
  pop.innerHTML=`
    <h4>Tags — S${rawSeason}E${rawEpNum}</h4>
    <div class="tag-editor-chips">${chipTags.map(t=>`
      <button class="tag-chip-toggle ${currentTags.has(t)?'on':''}" data-tag="${escAttr(t)}" onclick="this.classList.toggle('on')">${esc(t)}</button>
    `).join('')}</div>
    <input type="text" id="tag-custom-input" placeholder="Add custom tag + Enter" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomTagChip(this)}"/>
    <div class="ep-regroup-btns">
      <button style="background:var(--green);color:#fff" onclick="saveEpisodeTags(${id},${showId},${rawSeason},${rawEpNum},'${(groupKey||'').replace(/'/g,"\\'")}')">Save</button>
      <button style="background:var(--surface3);color:var(--muted)" onclick="this.closest('.ep-tag-popover').remove()">Cancel</button>
    </div>`;
  document.body.appendChild(pop);
  pop.style.top='50%'; pop.style.left='50%'; pop.style.transform='translate(-50%,-50%)';
  setTimeout(()=>document.addEventListener('click',function h(e){if(!pop.contains(e.target)){pop.remove();document.removeEventListener('click',h);}}),10);
}

function addCustomTagChip(input){
  const val=input.value.trim();
  if(!val) return;
  const chipsWrap=input.closest('.ep-tag-popover').querySelector('.tag-editor-chips');
  const existing=[...chipsWrap.querySelectorAll('.tag-chip-toggle')].find(b=>b.dataset.tag.toLowerCase()===val.toLowerCase());
  if(existing){ existing.classList.add('on'); }
  else {
    const btn=document.createElement('button');
    btn.className='tag-chip-toggle on';
    btn.dataset.tag=val;
    btn.textContent=val;
    btn.onclick=()=>btn.classList.toggle('on');
    chipsWrap.appendChild(btn);
  }
  input.value='';
}

async function saveEpisodeTags(tmdbId,showId,rawSeason,rawEpNum,groupKey){
  const pop=document.querySelector('.ep-tag-popover');
  const selected=new Set([...pop.querySelectorAll('.tag-chip-toggle.on')].map(b=>b.dataset.tag));
  const data=displaySeasonData.get(tmdbId);
  const group=(data?.seasons||[]).find(g=>g.episodes.some(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum));
  const ep=group?.episodes.find(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum);
  const before=new Set(ep?.tags||[]);
  pop.remove();

  const toAdd=[...selected].filter(t=>!before.has(t));
  const toRemove=[...before].filter(t=>!selected.has(t));
  await Promise.all([
    ...toAdd.map(tag=>api('/api/tags',{method:'POST',body:{tmdb_id:tmdbId,season_number:rawSeason,episode_number:rawEpNum,tag}})),
    ...toRemove.map(tag=>api('/api/tags',{method:'DELETE',body:{tmdb_id:tmdbId,season_number:rawSeason,episode_number:rawEpNum,tag}})),
  ]);
  if(ep) ep.tags=[...selected]; // update local cache so re-render doesn't need a refetch
  toast('Tags saved ✓');
  renderSeasonGroup(tmdbId,showId,groupKey||currentGroupKey);
}

// ── SEASON / EPISODE REGROUPING (custom display overrides) ─────────────────
// Quick single-episode reassignment popover.
function openEpisodeRegroup(tmdbId,rawSeason,rawEpNum,currentDispNum){
  document.querySelector('.ep-regroup-popover')?.remove();
  const id=parseInt(tmdbId);
  const data=displaySeasonData.get(id);
  const group=(data?.seasons||[]).find(g=>g.episodes.some(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum));
  const curSeason=group?group.display_season:rawSeason;
  const curSub=group?group.display_sub_season:'';
  const pop=document.createElement('div');
  pop.className='ep-regroup-popover';
  pop.innerHTML=`
    <h4>Reassign S${rawSeason}E${rawEpNum}</h4>
    <label>Saga <input type="number" id="rg-season" value="${curSeason}" style="width:70px"/></label>
    <label>Part / Sub-season <input type="number" id="rg-sub" value="${curSub===null?'':curSub}" placeholder="optional" style="width:90px"/></label>
    <label>Episode # <input type="number" id="rg-epnum" value="${currentDispNum}" style="width:70px"/></label>
    <div class="ep-regroup-btns">
      <button style="background:var(--green);color:#fff" onclick="saveEpisodeRegroup(${id},${rawSeason},${rawEpNum})">Save</button>
      ${group&&group.episodes.find(e=>e.season_number===rawSeason&&e.episode_number===rawEpNum)?.is_modified
        ? `<button style="background:var(--surface3);color:var(--muted)" onclick="revertEpisodeRegroup(${id},${rawSeason},${rawEpNum})">Revert</button>` : ''}
      <button style="background:var(--surface3);color:var(--muted)" onclick="this.closest('.ep-regroup-popover').remove()">Cancel</button>
    </div>`;
  document.body.appendChild(pop);
  pop.style.top='50%'; pop.style.left='50%'; pop.style.transform='translate(-50%,-50%)';
  setTimeout(()=>document.addEventListener('click',function h(e){if(!pop.contains(e.target)){pop.remove();document.removeEventListener('click',h);}}),10);
}

async function saveEpisodeRegroup(tmdbId,rawSeason,rawEpNum){
  const season=parseInt(document.getElementById('rg-season')?.value);
  const subRaw=document.getElementById('rg-sub')?.value;
  const sub=subRaw===''||subRaw==null?null:parseInt(subRaw);
  const epNum=parseInt(document.getElementById('rg-epnum')?.value);
  document.querySelector('.ep-regroup-popover')?.remove();
  if(!season||!epNum) return;
  await api('/api/display',{method:'POST',body:{tmdb_id:tmdbId,season_number:rawSeason,episode_number:rawEpNum,display_season:season,display_sub_season:sub,display_episode_number:epNum}});
  toast('Episode reassigned ✓');
  const showId=currentDetail?.id;
  await loadDisplaySeasons(tmdbId,showId,rawSeason);
}

async function revertEpisodeRegroup(tmdbId,rawSeason,rawEpNum){
  document.querySelector('.ep-regroup-popover')?.remove();
  await api('/api/display',{method:'DELETE',body:{tmdb_id:tmdbId,season_number:rawSeason,episode_number:rawEpNum}});
  toast('Reverted to TMDB numbering');
  const showId=currentDetail?.id;
  await loadDisplaySeasons(tmdbId,showId,rawSeason);
}

// Full editor: bulk-assign a raw episode range to a custom season/sub-season, and
// review/revert existing overrides. This is the main tool for splitting a show like
// One Piece's long TMDB seasons into your own season/part scheme.
async function openSeasonEditor(tmdbId,showId){
  const id=parseInt(tmdbId);
  const data=displaySeasonData.get(id) || await api(`/api/tmdb/show/${id}/display-seasons`);
  displaySeasonData.set(id,data);
  const rawSeasons=data.raw_seasons||[];
  const modifiedCount=(data.seasons||[]).reduce((sum,g)=>sum+g.episodes.filter(e=>e.is_modified).length,0);

  let modal=document.getElementById('season-editor-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='season-editor-modal';
    modal.className='season-editor-overlay';
    document.body.appendChild(modal);
  }
  modal.innerHTML=`
    <div class="season-editor-panel">
      <div class="season-editor-header">
        <h3>Edit Sagas & Arcs</h3>
        <button onclick="closeSeasonEditor()">✕</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px">
        Group a range of TMDB's raw episodes into your own saga / arc numbering.
        The real TMDB season and episode numbers are never changed underneath — this
        only affects how episodes are displayed and grouped. New episodes TMDB adds
        will show up under their raw TMDB season until you assign them.
      </p>
      <div class="season-editor-form">
        <div class="se-row">
          <label>Raw TMDB season
            <select id="se-raw-season">
              ${rawSeasons.map(s=>`<option value="${s.season_number}">S${s.season_number} — ${esc(s.name||'')} (${s.episode_count} eps)</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="se-row">
          <label>From episode <input type="number" id="se-from" value="1" style="width:70px"/></label>
          <label>To episode <input type="number" id="se-to" value="1" style="width:70px"/></label>
        </div>
        <div class="se-row">
          <label>Saga # <input type="number" id="se-disp-season" style="width:70px"/></label>
          <label>Arc # <input type="number" id="se-disp-sub" placeholder="optional" style="width:90px"/></label>
          <label>Arc name <input type="text" id="se-sub-label" placeholder="e.g. Wano" style="width:110px"/></label>
        </div>
        <div class="se-row">
          <label>Start numbering episodes at <input type="number" id="se-start-ep" value="1" style="width:70px"/></label>
        </div>
        <button class="btn-se-apply" onclick="applySeasonEditorRange(${id},${showId})">Apply Grouping</button>
      </div>
      <div class="panel-section-title" style="margin-top:18px">Bulk Tag a Range</div>
      <div class="season-editor-form">
        <div class="se-row">
          <label>Raw TMDB season
            <select id="se-tag-raw-season">
              ${rawSeasons.map(s=>`<option value="${s.season_number}">S${s.season_number} — ${esc(s.name||'')} (${s.episode_count} eps)</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="se-row">
          <label>From episode <input type="number" id="se-tag-from" value="1" style="width:70px"/></label>
          <label>To episode <input type="number" id="se-tag-to" value="1" style="width:70px"/></label>
        </div>
        <div class="se-row">
          <label>Tag
            <input type="text" id="se-tag-value" list="se-tag-presets" placeholder="Canon / Filler / Crossover / custom" style="width:180px"/>
            <datalist id="se-tag-presets">${TAG_PRESETS.map(t=>`<option value="${escAttr(t)}"></option>`).join('')}</datalist>
          </label>
        </div>
        <button class="btn-se-apply" onclick="applyBulkTag(${id},${showId})">Apply Tag to Range</button>
      </div>
      <div class="panel-section-title" style="margin-top:18px">Current Custom Groupings (${modifiedCount} episodes modified)</div>
      <div id="se-groups-list">${(data.seasons||[]).filter(g=>g.episodes.some(e=>e.is_modified)).map(g=>{
        const label=`Saga ${g.display_season}${g.sub_season_label?' — '+esc(g.sub_season_label):(g.display_sub_season!=null?' — Arc '+g.display_sub_season:'')}`;
        const modEps=g.episodes.filter(e=>e.is_modified);
        return `<div class="se-group-row">
          <span>${label} — ${modEps.length} custom episode${modEps.length===1?'':'s'}</span>
          <button onclick="revertGroupRegroup(${id},${showId},${JSON.stringify(modEps.map(e=>[e.season_number,e.episode_number])).replace(/"/g,'&quot;')})">Revert all</button>
        </div>`;
      }).join('') || '<div style="font-size:12px;color:var(--muted)">No custom groupings yet.</div>'}</div>
    </div>`;
  modal.classList.add('open');
}

function closeSeasonEditor(){ document.getElementById('season-editor-modal')?.classList.remove('open'); }

async function applySeasonEditorRange(tmdbId,showId){
  const season_number=parseInt(document.getElementById('se-raw-season')?.value);
  const from_episode=parseInt(document.getElementById('se-from')?.value);
  const to_episode=parseInt(document.getElementById('se-to')?.value);
  const display_season=parseInt(document.getElementById('se-disp-season')?.value);
  const subRaw=document.getElementById('se-disp-sub')?.value;
  const display_sub_season=subRaw===''||subRaw==null?null:parseInt(subRaw);
  const sub_season_label=document.getElementById('se-sub-label')?.value?.trim()||null;
  const start_display_episode=parseInt(document.getElementById('se-start-ep')?.value)||1;
  if(!season_number||!from_episode||!to_episode||!display_season||to_episode<from_episode){
    toast('Fill in a valid season and episode range'); return;
  }
  await api('/api/display/bulk',{method:'POST',body:{tmdb_id:tmdbId,season_number,from_episode,to_episode,display_season,display_sub_season,sub_season_label,start_display_episode}});
  toast(`Grouped S${season_number} E${from_episode}-${to_episode} ✓`);
  await openSeasonEditor(tmdbId,showId);
  await loadDisplaySeasons(tmdbId,showId,season_number);
}

async function revertGroupRegroup(tmdbId,showId,pairsArr){
  for(const [s,e] of pairsArr){
    await api('/api/display',{method:'DELETE',body:{tmdb_id:tmdbId,season_number:s,episode_number:e}});
  }
  toast('Reverted to TMDB numbering');
  await openSeasonEditor(tmdbId,showId);
  await loadDisplaySeasons(tmdbId,showId);
}

async function applyBulkTag(tmdbId,showId){
  const season_number=parseInt(document.getElementById('se-tag-raw-season')?.value);
  const from_episode=parseInt(document.getElementById('se-tag-from')?.value);
  const to_episode=parseInt(document.getElementById('se-tag-to')?.value);
  const tag=document.getElementById('se-tag-value')?.value?.trim();
  if(!season_number||!from_episode||!to_episode||!tag||to_episode<from_episode){
    toast('Fill in a valid season, range and tag'); return;
  }
  await api('/api/tags/bulk',{method:'POST',body:{tmdb_id:tmdbId,season_number,from_episode,to_episode,tag}});
  toast(`Tagged S${season_number} E${from_episode}-${to_episode} as "${tag}" ✓`);
  closeSeasonEditor();
  await loadDisplaySeasons(tmdbId,showId,season_number);
}

// ── EPISODE DATE PICKER ───────────────────────────────────────────────────────
function openEpDatePicker(event, tmdbId, season, epNum) {
  event.stopPropagation();
  document.querySelector('.ep-date-popover')?.remove();
  const id = parseInt(tmdbId);
  const existingIso = (watchedDates.get(id)||new Map()).get(`${season}_${epNum}`) || '';
  const pop = document.createElement('div');
  pop.className = 'ep-date-popover';
  pop.innerHTML = `
    <h4>Watch Date — S${season}E${epNum}</h4>
    <input type="date" id="ep-date-input" value="${isoToDateInput(existingIso)}" max="${new Date().toISOString().slice(0,10)}"/>
    <div class="ep-date-popover-btns">
      <button style="background:var(--green);color:#fff" onclick="saveEpDate(${id},${season},${epNum})">Save</button>
      <button style="background:var(--surface3);color:var(--muted)" onclick="this.closest('.ep-date-popover').remove()">Cancel</button>
    </div>`;
  const rect = event.target.getBoundingClientRect();
  pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 180) + 'px';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 240)) + 'px';
  document.body.appendChild(pop);
  document.getElementById('ep-date-input')?.focus();
  setTimeout(() => document.addEventListener('click', function h(e){ if(!pop.contains(e.target)){pop.remove();document.removeEventListener('click',h);} }), 10);
}

async function saveEpDate(tmdbId, season, epNum) {
  const val = document.getElementById('ep-date-input')?.value;
  document.querySelector('.ep-date-popover')?.remove();
  if (!val) return;
  const iso = new Date(val + 'T12:00:00').toISOString();
  await api('/api/episodes', { method:'POST', body:{ tmdb_id: tmdbId, season_number: season, episode_number: epNum, watched_at: iso }});
  const dm = watchedDates.get(tmdbId) || new Map();
  dm.set(`${season}_${epNum}`, iso);
  watchedDates.set(tmdbId, dm);
  const wdEl = document.getElementById(`epwd-${tmdbId}-${season}-${epNum}`);
  if (wdEl) wdEl.innerHTML = `👁 ${fmtWatchedDate(iso)} <button class="ep-date-edit-btn" onclick="openEpDatePicker(event,${tmdbId},${season},${epNum})" title="Set watch date">✏️</button>`;
  toast('Watch date saved ✓');
}

// ── REC MODAL ─────────────────────────────────────────────────────────────────
function recCardHTML(r){
  const inList=r.in_list||shows.some(s=>s.tmdb_id===r.tmdb_id);
  const poster=r.poster_path?`<img class="poster" src="${IMG}/w300${r.poster_path}" alt="${esc(r.title)}" loading="lazy"/>`:`<div class="poster-ph">📺</div>`;
  return `<div class="rec-card" onclick="openRecModal(${JSON.stringify(r).replace(/"/g,'&quot;')})">
    ${poster}<div class="rec-body">
      <div class="rec-title">${esc(r.title)}</div>
      <div class="rec-meta">${r.year||''}${r.rating?` · ⭐ ${r.rating.toFixed(1)}`:''}</div>
      ${inList?`<div style="font-size:11px;color:var(--green);padding:3px 0">✓ In your list</div>`:`<div style="font-size:11px;color:var(--muted);padding:3px 0">Tap to see more</div>`}
    </div></div>`;
}

async function openRecModal(show){
  document.getElementById('rec-modal').classList.remove('hide');
  document.getElementById('rec-modal-content').innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>';
  const details=await api(`/api/tmdb/show/${show.tmdb_id}`);
  const inList=shows.some(s=>s.tmdb_id===show.tmdb_id);
  const existing=shows.find(s=>s.tmdb_id===show.tmdb_id);
  const backdrop=details.backdrop_path?`${IMG}/w780${details.backdrop_path}`:null;
  const poster=details.poster_path?`${IMG}/w300${details.poster_path}`:null;
  const cast=(details.credits?.cast||[]).slice(0,10);
  document.getElementById('rec-modal-content').innerHTML=`
    ${backdrop?`<img class="rec-modal-backdrop" src="${backdrop}" alt=""/>`:`<div class="rec-modal-backdrop-ph">📺</div>`}
    <div class="rec-modal-inner">
      <div class="rec-modal-top">
        ${poster?`<img class="rec-modal-poster" src="${poster}" alt="${esc(details.name||'')}"/>`:`<div class="rec-modal-poster-ph">📺</div>`}
        <div class="rec-modal-info">
          <div class="rec-modal-title">${esc(details.name||show.title)}</div>
          <div class="rec-modal-meta">
            ${details.first_air_date?`<span>📅 ${fmtDate(details.first_air_date)}</span>`:''}
            ${details.vote_average?`<span>⭐ ${details.vote_average.toFixed(1)}</span>`:''}
            ${details.number_of_seasons?`<span>📺 ${details.number_of_seasons} season${details.number_of_seasons>1?'s':''}</span>`:''}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${(details.genres||[]).map(g=>`<span class="genre-tag">${esc(g.name)}</span>`).join('')}</div>
        </div>
      </div>
      ${details.overview?`<div class="rec-modal-overview">${esc(details.overview)}</div>`:''}
      ${cast.length?`<div class="rec-add-label" style="margin-bottom:8px">Cast</div>
        <div class="cast-scroll-rec">${cast.map(c=>`
          <div class="cast-item">
            ${c.profile_path?`<img class="cast-img" src="${IMG}/w185${c.profile_path}" alt="" onerror="this.style.background='var(--surface3)'"/>`:`<div class="cast-img" style="display:flex;align-items:center;justify-content:center;font-size:20px">👤</div>`}
            <div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character||'')}</div>
          </div>`).join('')}</div>`:''}
      <div class="rec-add-label">Add to list</div>
      <div id="rec-modal-add-area">${inList
        ?`<div style="text-align:center;padding:12px;font-size:14px;color:var(--green)">✓ Already in your list as <strong>${sLabel(existing.status)}</strong></div>`
        :`<div class="rec-add-btns">
            <button class="btn-rec-list watching" onclick="addFromRecModal(${JSON.stringify(show).replace(/"/g,'&quot;')},'watching')">▶ Watching</button>
            <button class="btn-rec-list watchlist" onclick="addFromRecModal(${JSON.stringify(show).replace(/"/g,'&quot;')},'watchlist')">📋 Watchlist</button>
            <button class="btn-rec-list paused" onclick="addFromRecModal(${JSON.stringify(show).replace(/"/g,'&quot;')},'paused')">⏸ Paused</button>
            <button class="btn-rec-list dropped" onclick="addFromRecModal(${JSON.stringify(show).replace(/"/g,'&quot;')},'dropped')">🚫 Not Continuing</button>
          </div>`}
      </div>
      <button class="btn-rec-close" onclick="closeRecModal()">Close</button>
    </div>`;
}

async function addFromRecModal(show,status){
  document.querySelectorAll('.btn-rec-list').forEach(b=>{b.disabled=true;});
  const res=await api('/api/shows',{method:'POST',body:{...show,status}});
  if(res.id){
    const idx=shows.findIndex(s=>s.tmdb_id===res.tmdb_id);
    if(idx>=0) shows[idx]=res; else shows.push(res);
    shows.sort((a,b)=>a.title.localeCompare(b.title));
    renderAll();
    if(status==='watching') api(`/api/next-episode/${show.tmdb_id}`).then(next=>{nextEps.set(show.tmdb_id,next);const s=shows.find(x=>x.tmdb_id===show.tmdb_id);if(s)updateCardNextEp(s);});
    document.getElementById('rec-modal-add-area').innerHTML=`<div style="text-align:center;padding:12px;font-size:14px;color:var(--green)">✓ Added to <strong>${sLabel(status)}</strong></div>`;
    loadRecs();
    toast(`Added to ${sLabel(status)}`);
  } else { document.querySelectorAll('.btn-rec-list').forEach(b=>{b.disabled=false;}); }
}
function closeRecModal(){document.getElementById('rec-modal').classList.add('hide');}

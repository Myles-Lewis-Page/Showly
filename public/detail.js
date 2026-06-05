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
          <div class="panel-section-title">Episodes</div>
          <div id="total-progress-wrap"></div>
          <div class="season-tabs" id="season-tabs">${seasons.map(s=>`<button class="s-tab ${s.season_number===defaultSeason?'on':''}" onclick="loadSeason(${id},${showId},${s.season_number})" id="stab-${s.season_number}">S${s.season_number}</button>`).join('')}</div>
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
    if(seasons.length) loadSeason(id,showId,defaultSeason);
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

// ── SEASON / EPISODES ─────────────────────────────────────────────────────────
async function loadSeason(tmdbId,showId,seasonNum){
  currentSeason=seasonNum;
  document.querySelectorAll('.s-tab').forEach(t=>t.classList.toggle('on',parseInt(t.id.replace('stab-',''))===seasonNum));
  const container=document.getElementById('season-content');
  if(!container) return;
  container.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted)">Loading...</div>';
  const id=parseInt(tmdbId);
  try {
    const data=await api(`/api/tmdb/show/${id}/season/${seasonNum}`);
    if(!data || data.error) { container.innerHTML='<div style="padding:16px;color:var(--muted)">Could not load season.</div>'; return; }
    const episodes=data.episodes||[];
    const epSet=watchedEps.get(id)||new Set();
    const watchedInSeason=episodes.filter(e=>epSet.has(`${seasonNum}_${e.episode_number}`)).length;
    const allWatched=episodes.length>0&&watchedInSeason===episodes.length;

    // Season air date range
    const airedEps = episodes.filter(e=>e.air_date);
    const firstAir = airedEps[0]?.air_date;
    const lastAir = airedEps[airedEps.length-1]?.air_date;
    const seasonDateRange = firstAir ? (lastAir && lastAir !== firstAir
      ? `${fmtDate(firstAir)} – ${fmtDate(lastAir)}`
      : fmtDate(firstAir)) : '';

    // Season name — show if custom (not just "Season N"), always reserve the space
    const isGenericName = !data.name || data.name.trim().toLowerCase() === `season ${seasonNum}`;
    const seasonNameHTML = `<div class="season-name">${isGenericName ? '' : esc(data.name)}</div>`;

    updateTotalProgress(id);

    currentSeasonEpisodes.set(`${id}_${seasonNum}`, episodes);
    window._seasonEpNums = window._seasonEpNums || {};
    window._seasonEpNums[`${id}_${seasonNum}`] = episodes.map(e=>e.episode_number);

    const rows = episodes.map((ep, epIdx)=>{
      const watched=epSet.has(`${seasonNum}_${ep.episode_number}`);
      const watKey=`${seasonNum}_${ep.episode_number}`;
      const watchedAt=(watchedDates.get(id)||new Map()).get(watKey);
      const watchedAtStr=watchedAt?fmtWatchedDate(watchedAt):'';
      const still=ep.still_path?`${IMG}/w300${ep.still_path}`:null;
      const runtime=ep.runtime?`${ep.runtime}m`:'';
      const epName = esc(ep.name||'Episode '+ep.episode_number);
      const epAirDate = ep.air_date?fmtDate(ep.air_date):'';
      return `<div class="ep-row ${watched?'watched':''}" id="ep-${id}-${seasonNum}-${ep.episode_number}"
        onclick="clickEpisode(event,${id},${showId},${seasonNum},${ep.episode_number},${epIdx})">
        <span class="ep-num">${ep.episode_number}</span>
        ${still?`<img class="ep-still" src="${still}" alt="" loading="lazy" onerror="this.outerHTML='<div class=ep-still-ph>📺</div>'"/>`:`<div class="ep-still-ph">📺</div>`}
        <div class="ep-info">
          <div class="ep-name">${epName}</div>
          <div class="ep-date">${[epAirDate, runtime].filter(Boolean).join(' · ')}</div>
          ${watched?`<div class="ep-watched-date" id="epwd-${id}-${seasonNum}-${ep.episode_number}">
            ${watchedAtStr?`👁 ${watchedAtStr}`:'<span style="color:var(--muted);font-style:italic">No watch date</span>'}
            <button class="ep-date-edit-btn" onclick="openEpDatePicker(event,${id},${seasonNum},${ep.episode_number})" title="Set watch date">✏️</button>
          </div>`:''}
        </div>
        <div class="ep-check" id="epchk-${id}-${seasonNum}-${ep.episode_number}">${watched?'✓':''}</div>
      </div>`;
    }).join('');

    // Overview block — always includes season name space + optional date range + optional overview text
    const hasOverviewContent = seasonDateRange || data.overview;
    const seasonOverview = `
      <div style="padding:10px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px">
        ${seasonNameHTML}
        ${seasonDateRange ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px">📅 ${seasonDateRange}</div>` : ''}
        ${data.overview ? `<div style="font-size:13px;line-height:1.6;color:var(--muted)">${esc(data.overview)}</div>` : ''}
      </div>`;

    container.innerHTML=`
      <div class="season-header">
        <span class="season-progress">${watchedInSeason} / ${episodes.length} watched</span>
        <button class="btn-mark-season ${allWatched?'all-watched':''}" id="mark-season-btn"
          onclick="toggleSeasonWatchedSafe(${id},${showId},${seasonNum},${allWatched})">
          ${allWatched?'✓ All Watched':'Mark All Watched'}
        </button>
      </div>
      ${seasonOverview}
      <div class="episodes-list">${rows}</div>`;

  } catch(err) {
    console.error('loadSeason error:', err);
    container.innerHTML=`<div style="padding:16px;color:var(--muted)">Error loading season: ${esc(err.message)}</div>`;
  }
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

function clickEpisode(event, tmdbId, showId, season, epNum, epIdx) {
  const ep = (currentSeasonEpisodes.get(`${tmdbId}_${season}`) || [])[epIdx] || {};
  const target = event.target;
  if (target.classList.contains('ep-check') || target.closest('.ep-check')) {
    toggleEpisode(tmdbId, showId, season, epNum);
  } else {
    openEpModal(tmdbId, showId, season, epNum, ep.name||'Episode '+epNum, ep.still_path||'', ep.overview||'', ep.air_date||'');
  }
}

async function toggleEpisode(tmdbId,showId,season,epNum){
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
  updateSeasonProgress(id,season);
  updateTotalProgress(id);
  const show=shows.find(s=>s.tmdb_id===id);
  if(show&&['watching','caughtup'].includes(show.status)){
    api(`/api/next-episode/${id}`).then(next=>{nextEps.set(id,next);updateCardNextEp(show);});
  }
}

function toggleSeasonWatchedSafe(tmdbId, showId, season, currentlyAllWatched) {
  const epNums = (window._seasonEpNums || {})[`${tmdbId}_${season}`] || [];
  toggleSeasonWatched(tmdbId, showId, season, epNums, currentlyAllWatched);
}

async function toggleSeasonWatched(tmdbId,showId,season,epNums,currentlyAllWatched){
  const id=parseInt(tmdbId);
  const epSet=watchedEps.get(id)||new Set();
  if(currentlyAllWatched){
    await api('/api/episodes/season',{method:'DELETE',body:{tmdb_id:id,season_number:parseInt(season)}});
    epNums.forEach(n=>epSet.delete(`${season}_${n}`));
    watchedEps.set(id,epSet);
    loadSeason(id,showId,season);
    toast('Season unmarked');
  } else {
    const now=new Date().toISOString();
    await api('/api/episodes/season',{method:'POST',body:{tmdb_id:id,season_number:parseInt(season),episodes:epNums.map(Number),watched_ats:epNums.map(()=>now)}});
    epNums.forEach(n=>epSet.add(`${season}_${n}`));
    watchedEps.set(id,epSet);
    loadSeason(id,showId,season);
    toast('Season marked watched ✓');
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

function updateSeasonProgress(tmdbId,season){
  const rows=document.querySelectorAll(`[id^="ep-${tmdbId}-${season}-"]`);
  const total=rows.length;
  const watched=[...rows].filter(r=>r.classList.contains('watched')).length;
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

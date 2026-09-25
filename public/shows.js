// ── STATUS / DELETE ───────────────────────────────────────────────────────────
async function setPlatform(event, id, platform) {
  event.stopPropagation();
  const res = await api(`/api/shows/${id}`, { method:'PATCH', body:{ platform } });
  if (res.id) {
    const show = shows.find(s => s.id === id);
    if (show) show.platform = platform;
    if (platform) toast(`Platform set to ${platform}`);
  }
}

async function setStatus(event, id, newStatus) {
  event.stopPropagation();
  const res=await api(`/api/shows/${id}`,{method:'PATCH',body:{status:newStatus}});
  if(!res.id) return;
  const show=shows.find(s=>s.id===id);
  if(!show) return;
  show.status=newStatus;
  renderAll();
  toast(sLabel(newStatus));
  if(currentDetail?.id===id) renderPanelStatusBtns(newStatus,id);
  if(newStatus==='watching'||newStatus==='caughtup') {
    api(`/api/next-episode/${show.tmdb_id}`).then(next=>{nextEps.set(show.tmdb_id,next);updateCardNextEp(show);});
  }
}

async function deleteShow(event, id) {
  event.stopPropagation();
  await api(`/api/shows/${id}`,{method:'DELETE'});
  shows=shows.filter(s=>s.id!==id);
  renderAll();
  toast('Removed');
}

// ── MARK NEXT WATCHED ─────────────────────────────────────────────────────────
async function markNextWatched(event,showId,tmdbId,season,epNum){
  event.stopPropagation();
  const btn=document.getElementById('watched-btn-'+showId);
  if(btn){btn.disabled=true;btn.textContent='...';}
  const id=parseInt(tmdbId);
  await api('/api/episodes',{method:'POST',body:{tmdb_id:id,season_number:parseInt(season),episode_number:parseInt(epNum),watched_at:new Date().toISOString()}});
  const epSet=watchedEps.get(id)||new Set();
  epSet.add(`${season}_${epNum}`);
  watchedEps.set(id,epSet);
  const next=await api(`/api/next-episode/${id}`);
  nextEps.set(id,next);
  const show=shows.find(s=>s.tmdb_id===id);
  if(show){
    if(next.suggested_status&&next.suggested_status!==show.status&&['watching','caughtup','finished'].includes(show.status)){
      await autoMoveStatus(show,next.suggested_status);
    }
    updateCardNextEp(show);
  }
  toast(`S${season}E${epNum} watched ✓`);
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function loadSettings() {
  const container = document.getElementById('settings-content');
  container.innerHTML = `
    <div class="settings-card">
      <h3>My Streaming Services</h3>
      <p>Select the services you subscribe to. Platform dropdowns will only show these options.</p>
      <div class="services-grid">
        ${ALL_SERVICES.filter(s => s !== 'Other').map(s => `
          <label class="service-toggle ${ownedServices.has(s)?'on':''}" onclick="toggleService('${s}',this)">
            <div class="service-check">${ownedServices.has(s)?'✓':''}</div>
            ${esc(s)}
          </label>`).join('')}
      </div>
    </div>
    <div id="history-content"></div>`;
  loadHistory();
}

async function toggleService(name, el) {
  if (ownedServices.has(name)) {
    ownedServices.delete(name);
    el.classList.remove('on');
    el.querySelector('.service-check').textContent = '';
  } else {
    ownedServices.add(name);
    el.classList.add('on');
    el.querySelector('.service-check').textContent = '✓';
  }
  await api('/api/settings', { method:'POST', body:{ key:'owned_services', value:[...ownedServices].join(',') }});
  renderAll();
  loadNextEpisodes();
}

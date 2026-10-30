/**
 * app.js — TRACE investigation workspace (vanilla JS).
 *
 * Design principles enforced in this revision:
 *   - Every displayed value comes from a real backend response.
 *   - No fabricated routes, candidates, metrics, telemetry, logs or persons.
 *   - Loading / empty / error states are shown instead of fake fallbacks.
 *   - XAI panels render only the structured evidence the backend returns.
 */

/* ═══════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════ */
const State = {
  view: 'dashboard',
  cameras: [],
  ws: null,
  activeQueryId: null,
  lastRoute: null,
  selectedCandidateIdx: null,
  personsViewMode: 'grid',
};

const Charts = { cameras: null, queries: null };

// Light, restrained palette for charts.
const PALETTE = {
  navy:    '#172B50',
  burgundy:'#8C263B',
  success: '#1F8A6B',
  warning: '#B8860B',
  error:   '#C0392B',
  info:    '#2D6A9F',
  muted:   '#8B95A4',
  grid:    '#E5DED2',
  text:    '#596579',
};

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  query: 'Re-ID Search',
  map: 'Route Reconstruction',
  timeline: 'Sighting Timeline',
  'camera-location': 'Camera Locations',
  watchlist: 'Watchlist & Persons',
  upload: 'Pipeline Video Studio',
};

/* ═══════════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupQueryForm();
  setupWatchlistForm();
  setupUploadForm();
  setupDropZones();
  setupCamRadios();
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  connectWs();
  await loadCameras();
  loadDashboard();
  loadPersonsSelect();
  loadUploadJobs();
  loadCameraConfig();
});

/* ── Navigation ── */
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); })
  );
}

function switchView(name) {
  State.view = name;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === name)
  );
  document.querySelectorAll('.view').forEach(el =>
    el.classList.toggle('active', el.id === `view-${name}`)
  );
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[name] || '';
  document.getElementById('sidebar').classList.remove('open');

  if (name === 'dashboard') loadDashboard();
  if (name === 'watchlist') loadPersonsList();
  if (name === 'upload')    { loadUploadJobs(); loadCameraConfig(); }
  if (name === 'query')     { loadPersonsSelect(); }
  if (name === 'map') {
    (async () => {
      const activeId = await loadSessionSelect('map-session-select');
      if (activeId) loadMapRoute(parseInt(activeId));
      else renderMapRoute(null);
    })();
  }
  if (name === 'timeline') {
    (async () => {
      const activeId = await loadSessionSelect('timeline-session-select');
      if (activeId) renderTimeline(activeId);
      else renderTimeline(null);
    })();
  }
  if (name === 'camera-location') loadCameraLocationView();
}

/* ═══════════════════════════════════════════════════════════════════
   WEBSOCKET
═══════════════════════════════════════════════════════════════════ */
function connectWs() {
  const dot   = document.getElementById('ws-dot');
  const dot2  = document.getElementById('ws-dot-2');
  const lbl   = document.getElementById('ws-label');
  const pill  = document.getElementById('ws-pill-text');
  dot.className = 'ws-dot'; dot2.className = 'ws-dot';
  lbl.textContent = 'Connecting…'; pill.textContent = 'Connecting';

  State.ws = API.createWebSocket(
    onWsMsg,
    () => {
      dot.classList.add('connected'); dot2.classList.add('connected');
      lbl.textContent = 'Connected'; pill.textContent = 'Live';
    },
    () => {
      dot.classList.remove('connected'); dot2.classList.remove('connected');
      dot.classList.add('disconnected');
      lbl.textContent = 'Reconnecting…'; pill.textContent = 'Offline';
      setTimeout(connectWs, 2500);
    }
  );
}

function onWsMsg(msg) {
  switch (msg.type) {
    case 'query_progress': onProgress(msg);      break;
    case 'sighting_found': onSighting(msg);      break;
    case 'route_complete': onRouteComplete(msg); break;
    case 'alert':          onAlert(msg);         break;
    case 'error':          onPipelineErr(msg);   break;
  }
}

function onProgress(msg) {
  if (msg.session_id !== State.activeQueryId) return;
  setProgressBar(msg.progress_pct, msg.message);
}

function onSighting(msg) {
  if (msg.session_id !== State.activeQueryId) return;
  const s = msg.sighting;
  const scoreLabel = `match score ${s.best_confidence.toFixed(1)}% (similarity-derived)`;
  if (s.match_status === 'CONFIDENT_MATCH') {
    toast(`Camera ${s.camera_id} — candidate found (${scoreLabel})`, 'info');
  } else if (s.match_status === 'FACE_MISMATCH') {
    toast(`Camera ${s.camera_id} — face mismatch (${scoreLabel})`, 'error');
  } else {
    toast(`Camera ${s.camera_id} — candidate for review (${scoreLabel})`, 'info');
  }
}

function onRouteComplete(msg) {
  if (msg.session_id !== State.activeQueryId) return;
  State.lastRoute = msg.route;
  setProgressBar(100, 'Analysis complete');
  setTimeout(() => hideProgress(), 800);
  enableQueryBtn();

  const decision = msg.route.match_decision || 'NO_CONFIDENT_MATCH';
  const n  = msg.route.total_cameras_matched;
  const cf = (msg.route.route_confidence * 100).toFixed(1);

  if (decision === 'CONFIDENT_MATCH') {
    showQueryResult(`Candidate found on ${n} camera${n !== 1 ? 's' : ''} — match score ${cf}% (similarity-derived, not a probability)`, false);
    toast('Candidate trajectory ready — verify in Route Reconstruction', 'success');
  } else if (decision === 'POSSIBLE_MATCH_REVIEW') {
    showQueryResult(`No confident match — ${n > 0 ? n + ' candidate(s) for review' : 'top candidates below threshold'} (match score ${cf}%)`, false);
    toast('No confident match — top candidates shown for review', 'info');
  } else {
    showQueryResult('No confident match — person not found with sufficient evidence', false);
    toast('No confident match — see top candidates for review', 'info');
  }

  renderQueryResult(msg.route);
  loadSessionSelect('map-session-select');
  loadSessionSelect('timeline-session-select');
  if (State.view === 'dashboard') loadDashboard();
}

function onAlert(msg) {
  const a = msg.alert;
  toast(`${a.severity}: ${a.title}`, a.severity === 'HIGH' ? 'error' : 'info');
  const badge = document.getElementById('alert-unread-count');
  if (badge) { badge.style.display = 'inline-flex'; badge.textContent = (parseInt(badge.textContent) || 0) + 1; }
  const navBadge = document.getElementById('nav-alert-badge');
  if (navBadge) navBadge.style.display = 'inline-flex';
  if (State.view === 'dashboard') loadDashboard();
}

function onPipelineErr(msg) {
  if (msg.session_id !== State.activeQueryId) return;
  hideProgress();
  enableQueryBtn();
  showQueryResult(`Execution error: ${msg.message}`, true);
  toast(`Query failed: ${msg.message}`, 'error');
}

/* ═══════════════════════════════════════════════════════════════════
   CAMERAS
═══════════════════════════════════════════════════════════════════ */
async function loadCameras() {
  try { State.cameras = await API.cameras.list(); }
  catch { State.cameras = []; }
}

function camLocation(id) {
  const c = (State.cameras || []).find(x => x.id === id);
  return c?.location || id;
}

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  try {
    const [dash, sessions] = await Promise.all([
      API.analytics.dashboard(),
      API.queries.list(50),
    ]);
    const s = dash.stats;

    setKpi('kv-cameras',   s.cameras_active ?? '—');
    setKpi('kv-persons',   s.total_persons ?? '—');
    setKpi('kv-watchlist', s.watchlist_persons ?? '—');
    setKpi('kv-queries',   s.total_queries ?? '—');
    setKpi('kv-sightings', s.total_sightings ?? '—');
    setKpi('kv-alerts',    s.unacknowledged_alerts ?? '—');
    const hint = document.getElementById('kv-completed-hint');
    if (hint) hint.textContent = `${s.completed_queries ?? 0} completed`;

    const unreadBadge = document.getElementById('alert-unread-count');
    if (unreadBadge) {
      if (s.unacknowledged_alerts > 0) { unreadBadge.style.display = 'inline-flex'; unreadBadge.textContent = s.unacknowledged_alerts; }
      else unreadBadge.style.display = 'none';
    }
    const navBadge = document.getElementById('nav-alert-badge');
    if (navBadge) navBadge.style.display = s.unacknowledged_alerts > 0 ? 'inline-flex' : 'none';

    renderAlertFeed(dash.recent_alerts);
    renderCameraStatusList(dash.camera_activity);
    renderQueriesTable(sessions);
    renderCameraChart(dash.camera_activity);
    renderQueryStatusChart(sessions);
  } catch (e) {
    console.error('Dashboard load error:', e);
    ['kv-cameras','kv-persons','kv-watchlist','kv-queries','kv-sightings','kv-alerts'].forEach(id => setKpi(id, '—'));
    document.getElementById('alert-feed').innerHTML = `<div class="empty-msg">Unable to load dashboard data.<br><span class="text-3">${esc(e.message)}</span></div>`;
    document.getElementById('camera-status-list').innerHTML = `<div class="empty-msg">Unable to load cameras.</div>`;
    document.getElementById('recent-queries-table').innerHTML = `<div class="empty-msg">Unable to load sessions.</div>`;
  }
}

function renderAlertFeed(alerts) {
  const el = document.getElementById('alert-feed');
  if (!alerts?.length) {
    el.innerHTML = `<div class="empty-msg">No alerts. Watchlist hits appear here after a search.</div>`;
    return;
  }
  el.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.acknowledged ? 'acked' : ''}">
      <div class="alert-severity-dot sev-${a.severity}"></div>
      <div class="alert-content">
        <div class="alert-title">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message)}</div>
        <div class="alert-time">${fmtTime(a.created_at)}</div>
      </div>
      ${!a.acknowledged
        ? `<button class="btn btn-ghost btn-xs" onclick="ackAlert(${a.id})">Acknowledge</button>`
        : `<span class="badge-pill badge-default">Acked</span>`}
    </div>`).join('');
}

function renderCameraStatusList(activity) {
  const el = document.getElementById('camera-status-list');
  if (!activity?.length) {
    el.innerHTML = `<div class="empty-msg">No registered cameras with activity data.</div>`;
    return;
  }
  el.innerHTML = activity.map(c => `
    <div class="cam-status-row">
      <div class="cam-status-icon"><svg viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M15 9l3.5-2v6L15 11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <div class="cam-info">
        <div class="cam-name">${esc(c.camera_id)}</div>
        <div class="cam-loc">${esc(c.location)}</div>
        <div class="cam-stats">${c.total_sightings} sightings · ${c.recent_queries ?? 0} completed-query sightings</div>
      </div>
      <span class="cam-badge cam-badge-active">Active</span>
    </div>`).join('');
}

function renderQueriesTable(sessions) {
  const el = document.getElementById('recent-queries-table');
  if (!sessions?.length) {
    el.innerHTML = `<div class="empty-msg">No search sessions yet. Submit a query in Re-ID Search.</div>`;
    return;
  }
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Session</th><th>Submitted</th><th>Status</th><th>Route</th></tr></thead>
      <tbody>
        ${sessions.map(s => `
          <tr>
            <td class="mono">#${s.id}</td>
            <td>${fmtTime(s.submitted_at)}</td>
            <td><span class="chip chip-${s.status}">${s.status}</span></td>
            <td>${s.status === 'done'
              ? `<a href="#" class="btn-link" onclick="loadRouteFromSession(${s.id});return false">View →</a>`
              : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function ackAlert(id) {
  try {
    await API.analytics.acknowledgeAlert(id);
    toast('Alert acknowledged', 'success');
    loadDashboard();
  } catch (e) { toast('Could not acknowledge: ' + e.message, 'error'); }
}

async function loadRouteFromSession(id) {
  switchView('map');
  await sleep(120);
  const sel = document.getElementById('map-session-select');
  if (sel) sel.value = id;
  loadMapRoute(id);
}

/* ═══════════════════════════════════════════════════════════════════
   CHARTS — real data only
═══════════════════════════════════════════════════════════════════ */
function renderCameraChart(cameraActivity) {
  const canvas = document.getElementById('chart-cameras');
  if (!canvas) return;
  if (!cameraActivity?.length) {
    if (Charts.cameras) { Charts.cameras.destroy(); Charts.cameras = null; }
    return;
  }
  const labels = cameraActivity.map(c => c.camera_id);
  const values = cameraActivity.map(c => c.total_sightings || 0);
  const colors = [PALETTE.burgundy, PALETTE.info, PALETTE.success, PALETTE.warning, PALETTE.navy];

  if (Charts.cameras) Charts.cameras.destroy();
  Charts.cameras = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{
      label: 'Sightings', data: values,
      backgroundColor: colors.slice(0, values.length).map(c => c + 'cc'),
      borderColor: colors.slice(0, values.length),
      borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} sightings` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: PALETTE.text, font: { size: 11, weight: '600' } } },
        y: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.text, font: { size: 11 }, precision: 0 }, beginAtZero: true },
      },
    },
  });
}

function renderQueryStatusChart(sessions) {
  const canvas = document.getElementById('chart-queries');
  if (!canvas) return;
  const counts = { done: 0, running: 0, pending: 0, failed: 0 };
  (sessions || []).forEach(s => { if (counts[s.status] != null) counts[s.status]++; });
  const scope = document.getElementById('chart-queries-scope');
  if (scope) scope.textContent = `Last ${sessions?.length || 0} sessions`;

  if (Charts.queries) Charts.queries.destroy();
  Charts.queries = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Completed', 'Running', 'Pending', 'Failed'],
      datasets: [{
        data: [counts.done, counts.running, counts.pending, counts.failed],
        backgroundColor: [PALETTE.success, PALETTE.info, PALETTE.muted, PALETTE.error],
        borderColor: '#FFFFFF', borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: PALETTE.text, font: { size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   RE-ID SEARCH
═══════════════════════════════════════════════════════════════════ */
let _queryPhotoFile = null;

function setupQueryForm() {
  document.querySelectorAll('.seg-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab)?.classList.add('active');
    })
  );
  document.getElementById('btn-submit-query')?.addEventListener('click', submitQuery);
}

async function loadPersonsSelect() {
  const sel = document.getElementById('person-select');
  if (!sel) return;
  try {
    const persons  = await API.persons.list();
    const enrolled = persons.filter(p => p.has_embedding);
    if (!enrolled.length) {
      sel.innerHTML = '<option value="">No enrolled persons — register one with a photo</option>';
      return;
    }
    sel.innerHTML = '<option value="">Select a registered person…</option>' +
      enrolled.map(p => `<option value="${p.id}">${esc(p.name)}${p.alias ? ` (${esc(p.alias)})` : ''} · ${p.watchlist_status.toUpperCase()}</option>`).join('');
  } catch {
    sel.innerHTML = '<option value="">Unable to load persons</option>';
  }
}

async function submitQuery() {
  const btn       = document.getElementById('btn-submit-query');
  const msg       = document.getElementById('query-status-msg');
  const activeTab = document.querySelector('.seg-btn.active')?.dataset.tab;
  msg.textContent = '';
  msg.className   = 'status-inline';

  const pid = activeTab === 'tab-person' ? document.getElementById('person-select')?.value : null;
  const hasRealPhoto   = activeTab === 'tab-photo' && _queryPhotoFile != null;
  const hasRealPerson  = activeTab === 'tab-person' && pid;

  if (!hasRealPhoto && !hasRealPerson) {
    msg.textContent = 'Select a registered person or upload a reference photo first.';
    msg.className   = 'status-inline err';
    return;
  }

  const fd = new FormData();
  if (activeTab === 'tab-person') {
    fd.append('person_id', pid);
  } else {
    fd.append('image', _queryPhotoFile);
  }

  btn.disabled = true;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" class="spin"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" stroke-dasharray="22" stroke-dashoffset="11"/></svg> Searching…`;
  showProgress();
  setProgressBar(5, 'Submitting query…');

  try {
    const session = await API.queries.submit(fd);
    State.activeQueryId = session.id;
    setProgressBar(15, `Session #${session.id} — running re-ID pipeline…`);
    msg.textContent = `Session #${session.id}`;
    msg.className   = 'status-inline ok';
  } catch (e) {
    hideProgress();
    enableQueryBtn();
    msg.textContent = e.message || 'Submission failed.';
    msg.className   = 'status-inline err';
    toast('Search failed: ' + e.message, 'error');
  }
}

function renderQueryResult(route) {
  const body = document.getElementById('query-result-body');
  State.lastRoute = route;
  State.selectedCandidateIdx = null;
  document.getElementById('why-match-panel').innerHTML = '';

  const decision   = route.match_decision || 'NO_CONFIDENT_MATCH';
  const candidates = route.top_candidates || [];

  let bannerClass = 'result-banner', bannerHtml = '';
  if (decision === 'CONFIDENT_MATCH') {
    bannerClass += ' ok';
    bannerHtml = `<div class="rb-title">Candidate found — requires human verification</div>
      <div class="rb-sub">Match scores are similarity-derived values, not identity probabilities. Visual verification is required before any identity conclusion.</div>`;
  } else if (decision === 'POSSIBLE_MATCH_REVIEW') {
    bannerClass += ' warn';
    bannerHtml = `<div class="rb-title">No confident match — candidates below threshold</div>
      <div class="rb-sub">Top candidates are shown for human review. None met the match threshold.</div>`;
  } else {
    bannerClass += ' error';
    bannerHtml = `<div class="rb-title">No confident match</div>
      <div class="rb-sub">The available evidence does not support identifying this person. Top candidates are shown for manual review.</div>`;
  }

  let candidateHtml;
  if (candidates.length) {
    candidateHtml = `
      <div class="section-label">Top video candidates (for human review)</div>
      <div class="matches-grid">${candidates.map((c, i) => renderCandidateCard(c, i)).join('')}</div>`;
  } else {
    candidateHtml = `<div class="empty-msg">No candidates above the minimum similarity threshold. Upload a video first or check that galleries have been processed.</div>`;
  }

  body.innerHTML = `
    <div class="${bannerClass}">${bannerHtml}</div>
    ${candidateHtml}
    <div class="form-row mt-3">
      <button class="btn btn-primary btn-sm" onclick="switchView('map')">View Route Map →</button>
    </div>`;

  // Wire candidate selection -> "Why this match?" panel
  document.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => selectCandidate(parseInt(card.dataset.idx)));
  });
  if (candidates.length) selectCandidate(0);
}

function renderCandidateCard(c, i) {
  const statusColor = c.match_status === 'CONFIDENT_MATCH' ? PALETTE.success
    : c.match_status === 'FACE_MISMATCH' ? PALETTE.error
    : c.match_status === 'POSSIBLE_MATCH_REVIEW' ? PALETTE.warning : PALETTE.muted;
  const statusLabel = c.match_status === 'CONFIDENT_MATCH' ? 'Candidate'
    : c.match_status === 'FACE_MISMATCH' ? 'Face mismatch'
    : c.match_status === 'POSSIBLE_MATCH_REVIEW' ? 'For review' : c.match_status;

  const cropUrl = c.crop_path ? `/crops/${c.crop_path.replace(/\\/g, '/').split('/crops/').pop()}` : null;
  const faceRow = (c.face_sim !== null && c.face_sim !== undefined)
    ? `<div class="match-meta" style="color:${c.face_veto_applied ? PALETTE.error : PALETTE.text}">Face ${(c.face_sim*100).toFixed(1)}%${c.face_coverage != null ? ` · cov ${(c.face_coverage*100).toFixed(0)}%` : ''}${c.face_veto_applied ? ' · VETO' : ''}</div>` : '';
  const kprRow = (c.kpr_sim !== null && c.kpr_sim !== undefined)
    ? `<div class="match-meta">KPR ${(c.kpr_sim*100).toFixed(1)}%</div>` : '';

  return `
    <div class="match-card" data-idx="${i}" style="border-color:${statusColor}55">
      <div class="match-thumb" style="border-color:${statusColor}55">
        ${cropUrl ? `<img src="${esc(cropUrl)}" onerror="this.parentElement.textContent='👤'" />` : '👤'}
      </div>
      <div class="match-conf" style="color:${statusColor}">${c.best_confidence.toFixed(1)}</div>
      <div class="match-cam">${esc(c.camera_id)} · Track ${c.track_id}</div>
      <div class="match-meta">${esc(c.first_seen || '—')}</div>
      <span class="badge-pill" style="color:${statusColor};background:${statusColor}1a">${statusLabel}</span>
      ${faceRow}${kprRow}
      <div class="match-meta">${esc(c.active_backbone)}</div>
    </div>`;
}

function selectCandidate(idx) {
  const route = State.lastRoute;
  if (!route || !route.top_candidates?.length) return;
  State.selectedCandidateIdx = idx;
  document.querySelectorAll('.match-card').forEach(card =>
    card.classList.toggle('selected', parseInt(card.dataset.idx) === idx)
  );
  renderWhyMatchPanel(route.top_candidates[idx]);
}

/* ═══════════════════════════════════════════════════════════════════
   XAI — "Why this match?" panel (mandatory, below results)
   Renders CandidateTrackOut.explanation { fusion, kpr_evidence }.
═══════════════════════════════════════════════════════════════════ */
const XAI_SIGNAL_LABELS = { body: 'Body', kpr: 'KPR parts', face: 'Face' };
const XAI_PART_STATUS = { used: 'compared', below_threshold: 'not visible in both', error: 'unusable' };

function xaiPct(x) {
  return (typeof x === 'number' && isFinite(x)) ? `${(x * 100).toFixed(1)}%` : '—';
}
function xaiBar(value, color) {
  const w = Math.max(0, Math.min(1, typeof value === 'number' ? value : 0)) * 100;
  return `<div class="xai-bar"><div class="xai-bar-fill" style="width:${w.toFixed(1)}%;background:${color}"></div></div>`;
}

function renderFusionExplanation(f) {
  if (!f) return '<div class="empty-msg" style="padding:1rem">Fusion breakdown unavailable for this session.</div>';
  const signals = (f.signals || []).map(s => `
    <div class="xai-row">
      <span class="xai-label">${esc(XAI_SIGNAL_LABELS[s.signal] || s.signal)}</span>
      ${xaiBar(s.contribution, s.contribution < 0 ? PALETTE.error : PALETTE.burgundy)}
      <span class="xai-num">${s.contribution >= 0 ? '+' : ''}${xaiPct(s.contribution)}</span>
    </div>
    <div class="xai-sub">sim ${xaiPct(s.similarity)} · weight ${xaiPct(s.normalized_weight)}</div>`).join('');

  const excluded = (f.excluded_signals || []).map(e =>
    `<div class="xai-sub">✕ ${esc(XAI_SIGNAL_LABELS[e.signal] || e.signal)}: ${esc(e.reason)}</div>`).join('');

  const margin = typeof f.margin_to_threshold === 'number' ? f.margin_to_threshold : null;
  const marginColor = f.face_veto_applied ? PALETTE.error
    : (margin !== null && margin >= 0 ? PALETTE.success : PALETTE.warning);

  return `
    <div class="xai-section">Score breakdown (${esc(f.mode)})</div>
    ${signals}
    <div class="xai-row xai-total">
      <span class="xai-label">Fused</span>
      ${xaiBar(f.fused_score, marginColor)}
      <span class="xai-num">${xaiPct(f.fused_score)}</span>
    </div>
    <div class="xai-sub">threshold ${xaiPct(f.no_match_threshold)} · margin
      <span style="color:${marginColor}">${margin !== null ? (margin >= 0 ? '+' : '') + xaiPct(margin) : '—'}</span></div>
    ${excluded}
    <div class="xai-reason" style="border-left-color:${marginColor}">${esc(f.decision_reason)}</div>`;
}

function renderKprEvidence(k) {
  if (!k) return '';
  if (k.part_count_mismatch || k.fallback === 'holistic') {
    return `<div class="xai-section">Body parts (KPR)</div>
      <div class="xai-sub">No body part visible in both images — whole-body KPR embedding used instead (sim ${xaiPct(k.score)}).</div>`;
  }
  if (k.fallback === 'zero') {
    return `<div class="xai-section">Body parts (KPR)</div>
      <div class="xai-sub">No comparable body parts — KPR contributed no signal.</div>`;
  }
  const parts = (k.parts || []).map(p => {
    const used = p.status === 'used';
    return `<div class="xai-row${used ? '' : ' xai-dim'}">
        <span class="xai-label">Part ${p.index + 1}</span>
        ${xaiBar(used ? p.cosine : 0, PALETTE.info)}
        <span class="xai-num">${used ? xaiPct(p.cosine) : '—'}</span>
      </div>
      <div class="xai-sub${used ? '' : ' xai-dim'}">${esc(XAI_PART_STATUS[p.status] || p.status)} · vis ${xaiPct(p.vis_a)} / ${xaiPct(p.vis_b)}${used ? ` · share ${xaiPct(p.weight_share)}` : ''}</div>`;
  }).join('');
  return `<div class="xai-section">Body parts (KPR) — ${k.num_mutually_visible} visible in both</div>
    ${parts}
    ${k.crop_path ? `<div class="xai-sub">best crop: ${esc(String(k.crop_path).split('/').pop())}</div>` : ''}`;
}

function renderWhyMatchPanel(c) {
  const panel = document.getElementById('why-match-panel');
  if (!c) { panel.innerHTML = ''; return; }
  const x = c.explanation;
  const hasExplanation = x && (x.fusion || x.kpr_evidence);

  panel.innerHTML = `
    <div class="xai-panel">
      <div class="xai-panel-head">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 7v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="13" r="1" fill="currentColor"/></svg>
        <h3>Why this match?</h3>
        <span class="xai-target">${esc(c.camera_id)} · Track ${c.track_id} · ${c.best_confidence.toFixed(1)}% score</span>
      </div>
      <div class="xai-panel-body">
        ${hasExplanation
          ? `${renderFusionExplanation(x.fusion)}${renderKprEvidence(x.kpr_evidence)}
             <div class="xai-note">Similarity evidence only — not an identity probability. Human verification is still required.</div>`
          : `<div class="empty-msg" style="padding:1.5rem">Explanation unavailable for this candidate. This session was stored before the evidence layer, or no structured explanation was returned for this track.</div>`}
      </div>
    </div>`;
}

function renderCandidateMatchesShowcase() {
  // No pre-loaded demo data; show a neutral empty state until a real query runs.
  const card = document.getElementById('query-result-card');
  const body = document.getElementById('query-result-body');
  document.getElementById('why-match-panel').innerHTML = '';
  if (!body) return;
  body.innerHTML = `<div class="empty-msg">
    <svg width="32" height="32" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M14 14l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    Submit a search to see candidate matches.<br/>No results are shown until a real query runs.
  </div>`;
}

function showProgress()   { document.getElementById('query-progress-wrap').style.display = 'block'; }
function hideProgress()   { document.getElementById('query-progress-wrap').style.display = 'none'; }
function setProgressBar(pct, label) {
  const fill = document.getElementById('query-progress-fill');
  const msg  = document.getElementById('query-progress-msg');
  if (fill) fill.style.width = pct + '%';
  if (msg)  msg.textContent  = label;
}
function enableQueryBtn() {
  const btn = document.getElementById('btn-submit-query');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.8"/><path d="M14 14l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Execute Search`;
}
function showQueryResult(txt, isError) {
  const body = document.getElementById('query-result-body');
  document.getElementById('why-match-panel').innerHTML = '';
  body.innerHTML = `<div class="result-banner ${isError ? 'error' : 'ok'}">${esc(txt)}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   ROUTE RECONSTRUCTION — Google Maps based
═══════════════════════════════════════════════════════════════════ */
const RouteMap = { map: null, markers: [], polylines: [], initialized: false };

async function loadMapRoute(sessionId) {
  try {
    const id = sessionId || parseInt(document.getElementById('map-session-select').value);
    const sel = document.getElementById('map-session-select');
    if (sel && id && sel.value !== String(id)) sel.value = String(id);
    const route = await API.queries.route(id);
    State.lastRoute = route;
    await renderMapRoute(route);
  } catch (e) {
    console.error('Failed to load route:', e);
    renderMapRoute(null);
    toast('Failed to load route: ' + e.message, 'error');
  }
}

async function ensureRouteGoogleMap() {
  // Show the Google Maps container; hide config/empty states.
  document.getElementById('route-google-map').style.display = 'block';
  document.getElementById('route-map-config-state').style.display = 'none';
  document.getElementById('route-map-empty-state').style.display = 'none';

  const cfg = await API.cameras.mapsConfig();   // ← fixed: was getMapsConfig()
  if (!cfg.configured || !cfg.google_maps_api_key) {
    document.getElementById('route-google-map').style.display = 'none';
    document.getElementById('route-map-config-state').style.display = 'flex';
    return false;
  }
  await loadGoogleMapsScript(cfg.google_maps_api_key);
  if (!RouteMap.map) initRouteGoogleMap();
  return !!RouteMap.map;
}

function initRouteGoogleMap() {
  const container = document.getElementById('route-google-map');
  if (!container || !window.google?.maps) return;
  const firstWithCoords = (CamLoc.cameras.length ? CamLoc.cameras : State.cameras)
    .find(c => c.latitude != null && c.longitude != null);
  const centre = firstWithCoords
    ? { lat: firstWithCoords.latitude, lng: firstWithCoords.longitude }
    : { lat: 30.7333, lng: 76.7794 };
  RouteMap.map = new google.maps.Map(container, {
    center: centre, zoom: 16, mapTypeId: 'roadmap',
    mapTypeControl: true, zoomControl: true, streetViewControl: false, fullscreenControl: true,
  });
}

async function renderMapRoute(route) {
  const statusEl = document.getElementById('route-map-status');
  const summaryBody = document.getElementById('map-route-summary-body');
  const detailBody  = document.getElementById('map-detail-body');
  const whyRoute    = document.getElementById('why-route-panel');

  // Reset map overlays
  RouteMap.markers.forEach(m => m.setMap(null)); RouteMap.markers = [];
  RouteMap.polylines.forEach(p => p.setMap(null)); RouteMap.polylines = [];

  if (!route || !route.steps?.length) {
    if (statusEl) statusEl.textContent = route ? route.match_decision : 'No session';
    if (summaryBody) summaryBody.innerHTML = `<div class="empty-msg">No route steps to display for this session.<br><span class="text-3">Decision: ${esc(route?.match_decision || 'NO_CONFIDENT_MATCH')}</span></div>`;
    if (detailBody) detailBody.innerHTML = `<div class="empty-msg">Select a camera on the map or a route step to inspect its sighting details.</div>`;
    if (whyRoute) whyRoute.innerHTML = '';
    document.getElementById('route-google-map').style.display = 'none';
    document.getElementById('route-map-config-state').style.display = 'none';
    document.getElementById('route-map-empty-state').style.display = 'flex';
    return;
  }

  if (statusEl) statusEl.textContent = `${route.total_cameras_matched} camera(s) · ${route.match_decision}`;

  // Try to render on Google Maps
  let mapReady = true;
  try { mapReady = await ensureRouteGoogleMap(); }
  catch (e) {
    mapReady = false;
    toast('Failed to load Google Maps: ' + e.message, 'error');
  }
  if (mapReady && RouteMap.map) renderRouteOnGoogleMap(route);
  else {
    document.getElementById('route-google-map').style.display = 'none';
    if (document.getElementById('route-map-config-state').style.display === 'none')
      document.getElementById('route-map-empty-state').style.display = 'flex';
  }

  // Route summary
  renderRouteSummary(route);

  // Why this route? panel
  renderWhyRoutePanel(route);

  // Reset inspector
  if (detailBody) detailBody.innerHTML = `<div class="empty-msg">Select a camera marker or a route step to inspect its sighting details.</div>`;
}

function renderRouteSummary(route) {
  const body = document.getElementById('map-route-summary-body');
  const cf = (route.route_confidence * 100).toFixed(1);
  const cfColor = parseFloat(cf) >= 70 ? PALETTE.success : parseFloat(cf) >= 50 ? PALETTE.warning : PALETTE.error;
  const supported = route.supported_transitions_count ?? route.steps.length;
  const ambiguous = route.ambiguous_transitions_count || 0;
  const disconnected = route.disconnected_transitions_count || 0;

  body.innerHTML = `
    <div style="margin-bottom:14px">
      <div class="section-label">Route evidence score (mean fusion)</div>
      <div style="font-size:26px;font-weight:700;color:${cfColor};letter-spacing:-.03em">${cf}%</div>
      <div class="field-hint">Similarity-derived score · not a calibrated probability</div>
      <div class="progress-track mt-2"><div class="progress-fill" style="width:${cf}%;background:${cfColor}"></div></div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <span class="badge-pill badge-success">✓ ${supported} supported</span>
      ${ambiguous ? `<span class="badge-pill" style="background:var(--warning-bg);color:var(--warning)">⚠ ${ambiguous} ambiguous</span>` : ''}
      ${disconnected ? `<span class="badge-pill badge-danger">✕ ${disconnected} disconnected</span>` : ''}
    </div>
    ${route.data_limitations?.length ? `
    <div class="result-banner warn" style="margin-bottom:14px">
      <div class="rb-title">Data limitations</div>
      <ul style="margin:6px 0 0 18px;padding:0;font-size:12px;color:var(--text-2)">
        ${route.data_limitations.map(l => `<li>${esc(l)}</li>`).join('')}
      </ul>
    </div>` : ''}
    <div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px">${route.total_cameras_matched} / ${(State.cameras||[]).length || route.steps.length} cameras matched · method: <span class="mono">${esc(route.route_method)}</span></div>
    ${renderRouteSteps(route)}`;
}

function renderRouteSteps(route) {
  return `
    <div class="section-label">Sequence steps</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${route.steps.map((s, i) => {
        const statusVal = s.transition_status || 'SUPPORTED';
        const badge = statusVal === 'SUPPORTED' ? 'badge-success'
          : statusVal === 'AMBIGUOUS' ? 'badge-pill' : statusVal === 'DISCONNECTED' ? 'badge-danger' : 'badge-default';
        const badgeColor = statusVal === 'SUPPORTED' ? PALETTE.success
          : statusVal === 'AMBIGUOUS' ? PALETTE.warning
          : statusVal === 'DISCONNECTED' ? PALETTE.error : PALETTE.info;
        const modeLabel = s.matching_mode === 'face' ? 'FACE' : 'BODY';
        return `<div style="padding:9px 11px;border:1px solid var(--border);border-radius:var(--r-sm);cursor:pointer" onclick="selectRouteStep(${i})" id="route-step-${i}">
          <div class="flex items-center gap-2">
            <span style="background:var(--burgundy);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${i+1}</span>
            <strong>${esc(s.camera_id)}</strong>
            <span class="text-3 mono" style="font-size:11px">${esc(s.timestamp || '—')}</span>
            <span class="badge-pill" style="color:${badgeColor};background:${badgeColor}1a;font-size:10px">${statusVal}</span>
            <span class="mono" style="font-size:10px;color:var(--text-3)">${modeLabel}</span>
            <span class="badge-pill badge-poi" style="margin-left:auto">${(s.confidence||0).toFixed(1)}%</span>
          </div>
          ${s.hop_distance_m != null ? `<div class="match-meta" style="padding-left:28px">Geodesic ${s.hop_distance_m.toFixed(1)}m${s.implied_speed_mps != null ? ` · implied ${s.implied_speed_mps.toFixed(1)} m/s` : ''}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${route.skipped_cameras?.length ? `
    <div class="section-label" style="margin-top:12px">No confident match</div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${route.skipped_cameras.map(sc => `<div class="flex items-center gap-2" style="font-size:12px;padding:6px 9px;border:1px dashed var(--border);border-radius:var(--r-sm);opacity:.7">
        <strong class="text-3">${esc(sc.camera_id)}</strong><span class="text-3">${esc(sc.camera_location)}</span>
        <span class="mono text-3" style="margin-left:auto;font-size:10px">${esc(sc.match_status || 'NO MATCH')}</span></div>`).join('')}
    </div>` : ''}`;
}

function selectRouteStep(i) {
  const route = State.lastRoute;
  if (!route?.steps?.[i]) return;
  showCamDetail(route.steps[i].camera_id);
  document.querySelectorAll('[id^="route-step-"]').forEach(el => el.style.borderColor = 'var(--border)');
  const el = document.getElementById(`route-step-${i}`);
  if (el) el.style.borderColor = 'var(--burgundy)';
}

function renderRouteOnGoogleMap(route) {
  if (!RouteMap.map || !window.google?.maps) return;
  const cameras = CamLoc.cameras.length ? CamLoc.cameras : State.cameras;
  const camCoordMap = {};
  cameras.forEach(c => {
    if (c.latitude != null && c.longitude != null)
      camCoordMap[c.id] = { lat: c.latitude, lng: c.longitude, location: c.location || c.id };
  });

  const pathCoords = [];
  const bounds = new google.maps.LatLngBounds();
  let coordsFound = false;
  const missing = [];

  route.steps.forEach((step, idx) => {
    const coord = camCoordMap[step.camera_id];
    if (!coord) { missing.push(step.camera_id); return; }
    coordsFound = true;
    const pos = { lat: coord.lat, lng: coord.lng };
    pathCoords.push(pos); bounds.extend(pos);

    const statusVal = step.transition_status || 'SUPPORTED';
    const pinColor = statusVal === 'SUPPORTED' ? PALETTE.success
      : statusVal === 'AMBIGUOUS' ? PALETTE.warning
      : statusVal === 'DISCONNECTED' ? PALETTE.error : PALETTE.info;

    const marker = new google.maps.Marker({
      position: pos, map: RouteMap.map,
      title: `${idx+1}. ${step.camera_id} (${coord.location})`,
      label: { text: String(idx+1), color: '#fff', fontWeight: 'bold', fontSize: '12px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: pinColor, fillOpacity: .95, strokeColor: '#fff', strokeWeight: 2 },
    });
    const infoContent = `<div style="font-family:Inter,sans-serif;max-width:260px;font-size:12px;line-height:1.4">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">Step ${idx+1}: ${esc(step.camera_id)} (${esc(coord.location)})</div>
      <div><strong>Status:</strong> <span style="color:${pinColor};font-weight:700">${statusVal}</span></div>
      <div><strong>Timestamp:</strong> ${esc(step.timestamp || '—')}</div>
      <div><strong>Match score:</strong> ${(step.confidence||0).toFixed(1)}%</div>
      ${step.hop_distance_m != null ? `<div><strong>Distance:</strong> ${step.hop_distance_m.toFixed(1)} m</div>` : ''}
      ${step.implied_speed_mps != null ? `<div><strong>Speed:</strong> ${step.implied_speed_mps.toFixed(1)} m/s</div>` : ''}
      ${step.route_explanation?.summary ? `<div style="margin-top:6px;font-size:11px;color:#475569;border-top:1px solid #e5ded2;padding-top:4px">${esc(step.route_explanation.summary)}</div>` : ''}
    </div>`;
    const infoWindow = new google.maps.InfoWindow({ content: infoContent });
    marker.addListener('click', () => { infoWindow.open(RouteMap.map, marker); showCamDetail(step.camera_id); });
    RouteMap.markers.push(marker);
  });

  if (coordsFound && pathCoords.length >= 2) {
    RouteMap.polylines.push(new google.maps.Polyline({
      path: pathCoords, geodesic: true,
      strokeColor: PALETTE.burgundy, strokeOpacity: .85, strokeWeight: 3.5,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: PALETTE.burgundy, fillColor: PALETTE.burgundy, fillOpacity: 1 }, offset: '50%' }],
      map: RouteMap.map,
    }));
    RouteMap.map.fitBounds(bounds);
  } else if (!coordsFound) {
    toast('Camera GPS coordinates are not configured for route cameras. Set coordinates in Camera Locations.', 'info');
  }
  if (missing.length) {
    route.steps.forEach((step, idx) => {
      if (!camCoordMap[step.camera_id]) {
        toast(`Cannot place ${step.camera_id} on map — no GPS coordinates set.`, 'info');
      }
    });
  }
}

function showCamDetail(id) {
  const titleEl = document.getElementById('map-detail-title');
  const bodyEl  = document.getElementById('map-detail-body');
  const route = State.lastRoute;
  if (!route) { if (bodyEl) bodyEl.innerHTML = `<div class="empty-msg">No route loaded.</div>`; return; }

  const s = route.sightings?.find(x => x.camera_id === id);
  const step = route.steps?.find(x => x.camera_id === id);

  if (titleEl) titleEl.innerHTML = `<svg viewBox="0 0 20 20" fill="none" style="width:16px;height:16px"><rect x="2" y="5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M15 9l3.5-2v6L15 11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg> ${esc(id)} — ${esc(camLocation(id))}`;

  if (!s) {
    bodyEl.innerHTML = `<div class="empty-msg">No sighting recorded for ${esc(id)} on this route.</div>`;
    return;
  }

  const cropUrl = s.crop_path ? `/crops/${s.crop_path.replace(/\\/g, '/').split('/crops/').pop()}` : null;
  const modeBadge = s.matching_mode === 'face'
    ? `<span class="badge-pill badge-poi">FACE</span>` : `<span class="badge-pill badge-default">BODY</span>`;

  bodyEl.innerHTML = `
    <div class="flex gap-2" style="margin-bottom:14px;align-items:center">
      <div style="width:64px;height:96px;background:var(--muted);border-radius:var(--r-sm);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:1.8rem;color:var(--text-3)">
        ${cropUrl ? `<img src="${esc(cropUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='👤'"/>` : '👤'}
      </div>
      <div style="min-width:0">
        <div style="font-size:12.5px;color:var(--text-2)">Track <strong class="mono">#${s.track_id}</strong></div>
        <div style="font-size:12px;color:var(--text-2);margin-top:3px">First seen: <strong class="mono">${esc(s.first_seen || '—')}</strong></div>
        <div style="font-size:12px;color:var(--text-2)">Last seen: <strong class="mono">${esc(s.last_seen || '—')}</strong></div>
        <div style="font-size:11.5px;color:var(--burgundy);margin-top:4px;font-weight:600">Sequence order: ${(step?.step_order ?? 0) + 1}</div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      ${scoreBar('Identity', s.identity_score ?? s.appearance_score)}
      ${s.matching_mode === 'face' && s.face_similarity != null ? scoreBar('Face sim', s.face_similarity) : ''}
      ${s.matching_mode !== 'face' ? scoreBar('Body sim', s.body_similarity ?? s.appearance_score) : ''}
      ${scoreBar('Spatial', s.spatial_score)}
      ${scoreBar('Temporal', s.temporal_score)}
      ${scoreBar('Fusion', s.fusion_score)}
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
      <span class="badge-pill badge-poi">${(s.best_confidence||0).toFixed(1)} match score</span>
      <span class="chip chip-${(s.match_status||'').toLowerCase().replace('_','-') || 'done'}">${esc((s.match_status||'CANDIDATE').replace(/_/g,' '))}</span>
      ${modeBadge}
    </div>`;
}

function scoreBar(name, val) {
  const pct = (val != null ? val * 100 : 0).toFixed(1);
  const color = parseFloat(pct) >= 70 ? PALETTE.success : parseFloat(pct) >= 50 ? PALETTE.warning : PALETTE.error;
  return `<div class="score-bar-row">
    <div class="sbr-name">${esc(name)}</div>
    <div class="progress-track" style="flex:1"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="sbr-val" style="color:${color}">${pct}%</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   XAI — "Why this route?" panel (mandatory, below map + summary)
   Renders per-step route_explanation + route-level metrics.
═══════════════════════════════════════════════════════════════════ */
function renderWhyRoutePanel(route) {
  const panel = document.getElementById('why-route-panel');
  const steps = route.steps || [];
  const hasAny = steps.some(s => s.route_explanation) || route.narration || (route.data_limitations?.length);

  const stepBlocks = steps.map((s, i) => {
    const ex = s.route_explanation || {};
    const statusVal = s.transition_status || 'SUPPORTED';
    const statusColor = statusVal === 'SUPPORTED' ? PALETTE.success
      : statusVal === 'AMBIGUOUS' ? PALETTE.warning
      : statusVal === 'DISCONNECTED' ? PALETTE.error : PALETTE.info;

    let evidenceBoxes = '';
    if (ex.topological_evidence) {
      const t = ex.topological_evidence;
      evidenceBoxes += xaiEvidenceBox('Topological', [
        ['Edge exists', t.edge_exists != null ? (t.edge_exists ? 'Yes' : 'No') : '—'],
        ['Hop count', t.hop_count ?? '—'],
        ['Expected transit', t.expected_transit_sec != null ? `${t.expected_transit_sec}s` : '—'],
        ['Topology score', t.topology_score != null ? t.topology_score.toFixed(3) : '—'],
      ]);
    }
    if (ex.temporal_evidence) {
      const t = ex.temporal_evidence;
      evidenceBoxes += xaiEvidenceBox('Temporal', [
        ['Has timestamps', t.has_timestamps != null ? (t.has_timestamps ? 'Yes' : 'No') : '—'],
        ['Observed gap', t.observed_gap_sec != null ? `${t.observed_gap_sec.toFixed(1)}s` : '—'],
        ['Expected transit', t.expected_transit_sec != null ? `${t.expected_transit_sec}s` : '—'],
        ['Temporal score', t.temporal_score != null ? t.temporal_score.toFixed(3) : '—'],
      ]);
    }
    if (ex.appearance_evidence) {
      const a = ex.appearance_evidence;
      evidenceBoxes += xaiEvidenceBox('Appearance', [
        ['Appearance score', a.appearance_score != null ? a.appearance_score.toFixed(3) : '—'],
        ['Match score', a.confidence != null ? `${a.confidence.toFixed(1)}%` : '—'],
        ['Backbone', a.backbone || '—'],
      ]);
    }
    if (ex.spatial_evidence) {
      const sp = ex.spatial_evidence;
      evidenceBoxes += xaiEvidenceBox('Spatial', [
        ['Coordinates available', sp.coordinates_available != null ? (sp.coordinates_available ? 'Yes' : 'No') : '—'],
        ['Distance', sp.distance_meters != null ? `${sp.distance_meters.toFixed(1)} m` : '—'],
        ['Implied speed', sp.implied_speed_mps != null ? `${sp.implied_speed_mps.toFixed(1)} m/s` : '—'],
        ['Speed valid', sp.speed_valid != null ? (sp.speed_valid ? 'Yes' : 'No') : '—'],
      ]);
    }
    const missing = (ex.missing_constraints || []).map(m => `<div class="xai-missing">• ${esc(m)}</div>`).join('');
    const alt = s.alternative_candidate ? `<div class="xai-alt">Alternative considered: ${esc(s.alternative_candidate.camera_id || '')} Track ${s.alternative_candidate.track_id} (score ${s.alternative_candidate.fusion_score != null ? s.alternative_candidate.fusion_score.toFixed(3) : '—'})</div>` : '';

    return `
      <div class="xai-step" id="why-route-step-${i}">
        <div class="xai-step-head" onclick="toggleXaiStep(${i})">
          <div class="xai-step-num">${i+1}</div>
          <div class="xai-step-title">${esc(s.camera_id)} — ${esc(camLocation(s.camera_id))} <span style="color:var(--text-3);font-weight:400;font-size:11.5px">· ${esc(s.timestamp || '—')}</span></div>
          <span class="badge-pill" style="color:${statusColor};background:${statusColor}1a;margin-left:auto">${statusVal}</span>
          <svg class="xai-step-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="xai-step-body">
          ${ex.summary ? `<div class="xai-reason" style="border-left-color:${statusColor}">${esc(ex.summary)}</div>` : '<div class="xai-sub">No structured explanation returned for this step.</div>'}
          ${evidenceBoxes ? `<div class="xai-evidence-grid mt-3">${evidenceBoxes}</div>` : ''}
          ${missing}
          ${alt}
        </div>
      </div>`;
  }).join('');

  const transitionCounts = `
    <div class="flex gap-2" style="flex-wrap:wrap">
      <span class="badge-pill badge-success">✓ ${route.supported_transitions_count ?? 0} supported</span>
      ${route.ambiguous_transitions_count ? `<span class="badge-pill" style="background:var(--warning-bg);color:var(--warning)">⚠ ${route.ambiguous_transitions_count} ambiguous</span>` : ''}
      ${route.disconnected_transitions_count ? `<span class="badge-pill badge-danger">✕ ${route.disconnected_transitions_count} disconnected</span>` : ''}
    </div>`;

  panel.innerHTML = `
    <div class="xai-panel">
      <div class="xai-panel-head">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5l5-2 4 2 5-2v12l-5 2-4-2-5 2V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <h3>Why this route?</h3>
        <span class="xai-target">method: ${esc(route.route_method)} · ${route.total_cameras_matched} camera(s)</span>
      </div>
      <div class="xai-panel-body">
        ${route.narration ? `<div class="xai-reason" style="border-left-color:${PALETTE.info}">${esc(route.narration)}</div>` : ''}
        ${transitionCounts}
        <div class="xai-section">Per-step transition evidence</div>
        ${hasAny ? stepBlocks : '<div class="empty-msg" style="padding:1.5rem">No structured route explanation was returned for this session.</div>'}
        ${route.data_limitations?.length ? `<div class="xai-section">Data limitations</div><ul style="margin:0 0 0 18px;padding:0;color:var(--text-2);font-size:12px">${route.data_limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="xai-note">Evidence is descriptive of how the route was scored; it does not certify identity. Human verification is required.</div>
      </div>
    </div>`;
  // Open first step by default
  if (steps.length) toggleXaiStep(0);
}

function xaiEvidenceBox(title, rows) {
  return `<div class="xai-evidence-box">
    <div class="eb-title">${esc(title)}</div>
    ${rows.map(([k, v]) => `<div class="eb-row"><span class="eb-k">${esc(k)}</span><span class="mono">${esc(String(v))}</span></div>`).join('')}
  </div>`;
}

function toggleXaiStep(i) {
  const el = document.getElementById(`why-route-step-${i}`);
  if (!el) return;
  el.classList.toggle('open');
}

/* ═══════════════════════════════════════════════════════════════════
   SESSION SELECTORS (no demo option)
═══════════════════════════════════════════════════════════════════ */
async function loadSessionSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return null;
  const currentVal = sel.value;
  try {
    const sessions = await API.queries.list(50);
    const done = sessions.filter(s => s.status === 'done').sort((a, b) => b.id - a.id);
    if (!done.length) {
      sel.innerHTML = '<option value="">No completed sessions</option>';
      return null;
    }
    sel.innerHTML = done.map(s => `<option value="${s.id}">Session #${s.id} — ${fmtTime(s.submitted_at)}</option>`).join('');
    if (currentVal && Array.from(sel.options).some(o => o.value === currentVal)) sel.value = currentVal;
    else sel.value = String(done[0].id);
    return sel.value;
  } catch {
    sel.innerHTML = '<option value="">Unable to load sessions</option>';
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SIGHTING TIMELINE
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const tlSel = document.getElementById('timeline-session-select');
  tlSel?.addEventListener('change', () => renderTimeline(tlSel.value));
  document.getElementById('btn-load-timeline')?.addEventListener('click', () => {
    renderTimeline(document.getElementById('timeline-session-select')?.value);
  });
  document.getElementById('btn-load-map')?.addEventListener('click', () => {
    const id = document.getElementById('map-session-select')?.value;
    if (id) loadMapRoute(parseInt(id)); else renderMapRoute(null);
  });
  document.getElementById('map-session-select')?.addEventListener('change', () => {
    const id = document.getElementById('map-session-select')?.value;
    if (id) loadMapRoute(parseInt(id)); else renderMapRoute(null);
  });
});

async function renderTimeline(requestedSessionId) {
  const container = document.getElementById('timeline-container');
  const candEl = document.getElementById('timeline-candidates');
  if (!container) return;

  const selEl = document.getElementById('timeline-session-select');
  let val = requestedSessionId !== undefined && requestedSessionId !== null && requestedSessionId !== ''
    ? String(requestedSessionId) : (selEl ? selEl.value : '');
  if (selEl && val && selEl.value !== val) selEl.value = val;

  let route = null;
  if (val) {
    const sid = parseInt(val);
    if (!isNaN(sid)) {
      try { route = await API.queries.route(sid); State.lastRoute = route; }
      catch (e) { console.warn('Timeline route load failed:', e); }
    }
  }

  if (candEl) {
    if (route?.top_candidates?.length) {
      candEl.innerHTML = `<div class="matches-grid">${route.top_candidates.map((c, i) => renderCandidateCard(c, i)).join('')}</div>`;
      candEl.querySelectorAll('.match-card').forEach(card =>
        card.addEventListener('click', () => { State.lastRoute = route; selectCandidate(parseInt(card.dataset.idx)); }));
    } else {
      candEl.innerHTML = `<div class="empty-msg">No candidate snapshots for this session.</div>`;
    }
  }

  if (!route?.steps?.length) {
    container.innerHTML = `<div class="empty-msg">No sightings for this session. Run a query first.</div>`;
    return;
  }

  function tsToSec(ts) {
    if (!ts) return null;
    const parts = ts.split(':');
    if (parts.length < 3) return null;
    const [h, m] = [parseInt(parts[0]), parseInt(parts[1])];
    const sp = parts[2].split('.');
    return h * 3600 + m * 60 + parseInt(sp[0]) + (sp[1] ? parseInt(sp[1]) / 100 : 0);
  }

  const stepsWithTime = route.steps.map(s => ({ ...s, _sec: tsToSec(s.timestamp) }));
  const validSecs = stepsWithTime.map(s => s._sec).filter(x => x !== null);
  const minSec = validSecs.length ? Math.min(...validSecs) - 30 : 0;
  const maxSec = validSecs.length ? Math.max(...validSecs) + 30 : 60;
  const span = maxSec - minSec || 60;
  const secToPos = sec => ((sec - minSec) / span * 100).toFixed(2) + '%';
  const fmtSec = sec => {
    if (sec === null) return '—';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const ticks = Array.from({ length: 5 }, (_, i) => minSec + (span / 4) * i);
  const ticksHtml = ticks.map(t => `<span>${fmtSec(t)}</span>`).join('');

  const skippedRows = (route.skipped_cameras || []).map(sc => ({ camera_id: sc.camera_id, camera_location: sc.camera_location, _sec: null, _skipped: true, match_status: sc.match_status }));
  const allRows = [...stepsWithTime, ...skippedRows];

  const rowsHtml = allRows.map(step => {
    const isSkipped = !!step._skipped;
    const markerPos = step._sec !== null ? secToPos(step._sec) : '50%';
    const confClass = !isSkipped && (step.confidence || 0) >= 70 ? 'conf-high' : 'conf-mid';
    const gapHtml = (!isSkipped && step.observed_gap_sec != null && step.expected_transit_sec != null)
      ? `<span style="position:absolute;top:-20px;left:${markerPos};transform:translateX(-50%);font-size:10px;color:${step.gap_verdict?.includes('✓') ? PALETTE.success : PALETTE.warning};font-family:var(--font-mono);white-space:nowrap;font-weight:600">+${Math.round(step.observed_gap_sec)}s ${step.gap_verdict || ''}</span>` : '';
    const markerHtml = isSkipped
      ? `<div class="tl-skip">✕</div>`
      : `<div class="tl-marker ${confClass}" style="left:${markerPos}" title="${step.camera_id} · Track #${step.track_id} at ${step.timestamp || '—'} (${(step.confidence||0).toFixed(1)}%)"></div>${gapHtml}`;
    const subDetail = !isSkipped ? `<div style="font-size:10.5px;color:var(--text-3);font-family:var(--font-mono);margin-top:2px">Track #${step.track_id} · ${step.timestamp || '—'}</div>` : '';
    const statusLabel = isSkipped ? `<span class="badge-pill badge-default" style="font-size:9px">No match</span>`
      : `<span class="badge-pill ${step.matching_mode === 'face' ? 'badge-poi' : 'badge-default'}" style="font-size:9px">${step.matching_mode === 'face' ? 'FACE' : 'BODY'}</span>`;
    return `<div class="timeline-row" style="opacity:${isSkipped ? .5 : 1}">
      <div class="timeline-cam"><div class="timeline-cam-name">${esc(step.camera_id)}</div><div class="timeline-cam-loc">${esc(step.camera_location || step.camera_id)}</div>${subDetail}${statusLabel}</div>
      <div class="timeline-track">${markerHtml}</div>
    </div>`;
  }).join('');

  const cfPct = ((route.route_confidence || 0) * 100).toFixed(1);
  const cfColor = parseFloat(cfPct) >= 70 ? PALETTE.success : parseFloat(cfPct) >= 50 ? PALETTE.warning : PALETTE.error;

  container.innerHTML = `
    <div class="flex gap-3" style="flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 12px;background:var(--muted);border-radius:var(--r-sm)">
      <div><div class="field-hint" style="margin:0">Session</div><strong class="mono">#${route.session_id || '—'}</strong></div>
      <div><div class="field-hint" style="margin:0">Route evidence (mean fusion)</div><strong style="color:${cfColor};font-size:16px">${cfPct}%</strong></div>
      <div><div class="field-hint" style="margin:0">Matched cameras</div><strong>${route.total_cameras_matched || route.steps.length}</strong></div>
      <div><div class="field-hint" style="margin:0">Decision</div><span class="badge-pill badge-poi">${esc(route.match_decision || '—')}</span></div>
    </div>
    ${route.narration ? `<div class="xai-reason" style="border-left-color:${PALETTE.info};margin-bottom:14px">${esc(route.narration)}</div>` : ''}
    <div class="timeline-wrap">
      <div class="timeline-header">${ticksHtml}</div>
      ${rowsHtml}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   WATCHLIST & PERSONS
═══════════════════════════════════════════════════════════════════ */
function setupWatchlistForm() {
  document.getElementById('form-register-person')?.addEventListener('submit', async e => { e.preventDefault(); await registerPerson(); });
  document.getElementById('btn-refresh-persons')?.addEventListener('click', loadPersonsList);
}

function togglePersonsView(mode) {
  State.personsViewMode = mode;
  document.getElementById('btn-view-cards')?.classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-table')?.classList.toggle('active', mode === 'table');
  loadPersonsList();
}

async function registerPerson() {
  const name  = document.getElementById('reg-name').value.trim();
  const alias = document.getElementById('reg-alias').value.trim();
  const desc  = document.getElementById('reg-desc').value.trim();
  const watchlistStatus = document.querySelector('input[name="reg-watchlist"]:checked')?.value || 'none';
  const st    = document.getElementById('reg-status');
  if (!name) { st.textContent = 'Name is required.'; st.className = 'status-inline err'; return; }
  st.textContent = 'Registering profile…'; st.className = 'status-inline';
  try {
    const fd = new FormData();
    fd.append('name', name); fd.append('alias', alias);
    fd.append('description', desc); fd.append('watchlist_status', watchlistStatus);
    const photoInput = document.getElementById('reg-photo-input');
    if (photoInput?.files[0]) fd.append('photo', photoInput.files[0]);
    await API.persons.create(fd);
    st.textContent = 'Registered successfully.'; st.className = 'status-inline ok';
    document.getElementById('form-register-person').reset();
    document.getElementById('reg-photo-preview').style.display = 'none';
    loadPersonsList(); loadPersonsSelect();
    toast('Person registered', 'success');
  } catch (e) {
    st.textContent = e.message || 'Registration failed.'; st.className = 'status-inline err';
    toast('Registration failed: ' + e.message, 'error');
  }
}

async function loadPersonsList() {
  const el  = document.getElementById('persons-list');
  const cnt = document.getElementById('persons-count');
  if (!el) return;
  let persons = [];
  try { persons = await API.persons.list(); }
  catch (e) { el.innerHTML = `<div class="empty-msg" style="color:var(--error)">${esc(e.message)}</div>`; return; }

  if (cnt) cnt.textContent = persons.length;
  if (!persons.length) {
    el.innerHTML = `<div class="empty-msg">
      <svg width="32" height="32" viewBox="0 0 20 20" fill="none"><circle cx="8" cy="7" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M2 17c0-3.31 2.69-5 6-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <strong>No persons registered yet</strong><br>Register a person with a reference photo on the left.
    </div>`;
    return;
  }

  if (State.personsViewMode === 'grid') {
    el.innerHTML = `<div class="person-card-grid">${persons.map(p => {
      const avatarUrl = p.reference_image_path
        ? `/uploads/reference_photos/${p.reference_image_path.replace(/\\/g,'/').split('/reference_photos/').pop()}`
        : null;
      return `<div class="person-card">
        <div class="person-card-avatar">${avatarUrl ? `<img src="${esc(avatarUrl)}" onerror="this.parentElement.textContent='👤'"/>` : '👤'}</div>
        <div class="person-card-name">${esc(p.name)}</div>
        <div class="person-card-alias">${p.alias ? esc(p.alias) : '#' + p.id}</div>
        <div class="mt-2"><span class="badge-pill badge-${p.watchlist_status}">${p.watchlist_status.toUpperCase()}</span></div>
        <div class="person-emb ${p.has_embedding ? 'yes' : 'no'}">${p.has_embedding ? '✓ Embedding enrolled' : '⚠ No embedding'}</div>
        <div class="person-card-actions">
          <label class="btn btn-ghost btn-xs" style="flex:1">Enroll
            <input type="file" accept="image/*" style="display:none" onchange="enrollPhoto(${p.id},this)" />
          </label>
          <button class="btn btn-danger btn-xs" onclick="deletePerson(${p.id})">Delete</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = `<table class="data-table">
      <thead><tr><th style="width:44px"></th><th>Identity</th><th>Status</th><th>Embedding</th><th>Actions</th></tr></thead>
      <tbody>
        ${persons.map(p => {
          const avatarUrl = p.reference_image_path ? `/uploads/reference_photos/${p.reference_image_path.replace(/\\/g,'/').split('/reference_photos/').pop()}` : null;
          return `<tr>
            <td><div class="person-card-avatar" style="width:34px;height:34px;font-size:1rem;margin:0">${avatarUrl ? `<img src="${esc(avatarUrl)}" onerror="this.parentElement.textContent='👤'"/>` : '👤'}</div></td>
            <td><strong>${esc(p.name)}</strong>${p.alias ? `<div class="text-3" style="font-size:11.5px">${esc(p.alias)}</div>` : ''}</td>
            <td><span class="badge-pill badge-${p.watchlist_status}">${p.watchlist_status.toUpperCase()}</span></td>
            <td class="person-emb ${p.has_embedding ? 'yes' : 'no'}">${p.has_embedding ? 'Enrolled' : 'Missing'}</td>
            <td><div class="flex gap-2"><label class="btn btn-ghost btn-xs">Enroll<input type="file" accept="image/*" style="display:none" onchange="enrollPhoto(${p.id},this)"/></label><button class="btn btn-danger btn-xs" onclick="deletePerson(${p.id})">Delete</button></div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }
}

async function enrollPhoto(personId, input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('photo', file);
  try {
    await API.persons.enroll(personId, fd);
    toast('Reference photo enrolled', 'success');
    loadPersonsList(); loadPersonsSelect();
  } catch (e) { toast('Enroll failed: ' + e.message, 'error'); }
}

async function deletePerson(id) {
  if (!confirm('Delete this person? This operation is permanent.')) return;
  try {
    await API.persons.delete(id);
    toast('Person deleted', 'success');
    loadPersonsList(); loadPersonsSelect();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

/* ═══════════════════════════════════════════════════════════════════
   PIPELINE VIDEO STUDIO
═══════════════════════════════════════════════════════════════════ */
let _uploadFile = null;
const _camConfig = {};

function setupUploadForm() {
  document.getElementById('form-upload-video')?.addEventListener('submit', async e => { e.preventDefault(); await uploadVideo(); });
}
function setupCamRadios() {}

async function loadCameraConfig() {
  try {
    const cameras = await API.cameras.list();
    cameras.forEach(c => { _camConfig[c.id] = c; });
    renderCameraConfigUI(cameras);
    rebuildCamRadios(cameras);
    const heroEl = document.getElementById('hero-cam-count');
    if (heroEl) heroEl.textContent = `${cameras.length} camera${cameras.length !== 1 ? 's' : ''}`;
  } catch (e) {
    const grid = document.getElementById('camera-config-grid');
    if (grid && grid.offsetParent !== null)
      grid.innerHTML = `<div class="empty-msg" style="grid-column:1/-1">Camera data unavailable — start the backend and sync again.</div>`;
  }
}

function renderCameraConfigUI(cameras) {
  const grid    = document.getElementById('camera-config-grid');
  const strip   = document.getElementById('transit-config-strip');
  const edgeList = document.getElementById('transit-edges-list');
  if (!grid) return;

  grid.innerHTML = cameras.map(cam => `
    <div class="cam-config-card" id="cfg-card-${cam.id}">
      <div class="cam-config-header">
        <span class="cam-config-badge">${esc(cam.id)}</span>
        <span class="text-3" style="font-size:11px">Camera channel</span>
      </div>
      <div style="margin-bottom:10px">
        <div class="cam-config-label">Location name</div>
        <input class="cam-config-input" id="cfg-loc-${cam.id}" type="text" placeholder="e.g. Main Entrance" value="${esc(cam.location || '')}" oninput="markCamDirty('${cam.id}')" />
      </div>
      <div>
        <div class="cam-config-label">Recording start time</div>
        <input class="cam-config-input" id="cfg-time-${cam.id}" type="time" step="1" value="${esc(cam.start_time || '')}" oninput="markCamDirty('${cam.id}')" />
      </div>
      <button class="btn btn-ghost btn-sm cam-config-save-btn" onclick="saveCameraConfig('${cam.id}')" id="cfg-btn-${cam.id}">
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Save ${esc(cam.id)}
      </button>
    </div>`).join('') || `<div class="empty-msg" style="grid-column:1/-1">No cameras configured.</div>`;

  const loadedCamIds = new Set(cameras.map(c => c.id));
  const seenEdges = new Set();
  const allEdges = [];
  cameras.forEach(cam => {
    (cam.connects_to || []).forEach(edge => {
      if (!loadedCamIds.has(edge.to_camera_id)) return;
      const key = [cam.id, edge.to_camera_id].sort().join('-');
      if (!seenEdges.has(key)) { seenEdges.add(key); allEdges.push({ from: cam.id, to: edge.to_camera_id, secs: edge.avg_transit_sec }); }
    });
  });
  if (allEdges.length && edgeList && strip) {
    strip.style.display = 'block';
    edgeList.innerHTML = allEdges.map(e => `
      <div class="transit-edge-row">
        <span class="transit-edge-label"><strong>${esc(e.from)}</strong> → <strong>${esc(e.to)}</strong> <span class="text-3">(${esc(_camConfig[e.from]?.location || e.from)} → ${esc(_camConfig[e.to]?.location || e.to)})</span></span>
        <input class="transit-input" id="transit-${e.from}-${e.to}" type="number" min="1" max="3600" value="${e.secs}" oninput="markTransitDirty()" />
        <span class="transit-unit">sec</span>
      </div>`).join('');
    edgeList.dataset.edges = JSON.stringify(allEdges.map(e => ({ from: e.from, to: e.to })));
  }
}

function markCamDirty(camId) {
  document.getElementById(`cfg-card-${camId}`)?.classList.add('dirty');
}
function markTransitDirty() {
  document.getElementById('btn-save-all-cameras')?.classList.replace('btn-secondary', 'btn-primary');
}

async function saveCameraConfig(camId) {
  const locEl  = document.getElementById(`cfg-loc-${camId}`);
  const timeEl = document.getElementById(`cfg-time-${camId}`);
  const btn    = document.getElementById(`cfg-btn-${camId}`);
  const location   = locEl?.value.trim() || null;
  const start_time = timeEl?.value.trim() || null;
  if (!location) { toast(`${camId}: location name cannot be empty`, 'error'); locEl?.focus(); return; }

  const edgeList = document.getElementById('transit-edges-list');
  const edgeMeta = edgeList?.dataset.edges ? JSON.parse(edgeList.dataset.edges) : [];
  const transit_updates = {};
  edgeMeta.forEach(({ from, to }) => { if (from === camId) { const inp = document.getElementById(`transit-${from}-${to}`); if (inp) transit_updates[to] = parseInt(inp.value, 10) || 30; } });

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const updated = await API.cameras.patch(camId, { location, start_time: start_time || undefined, transit_updates: Object.keys(transit_updates).length ? transit_updates : undefined });
    _camConfig[camId] = updated;
    document.getElementById(`cfg-card-${camId}`)?.classList.remove('dirty');
    toast(`${camId} saved — "${updated.location}"`, 'success');
  } catch (err) {
    toast(`Failed to save ${camId}: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Save ${camId}`; }
  }
}

async function saveAllCameras() {
  const ids = Object.keys(_camConfig);
  if (!ids.length) { toast('No camera data loaded yet', 'info'); return; }
  let anyFail = false;
  for (const camId of ids) { try { await saveCameraConfig(camId); } catch { anyFail = true; } }
  if (!anyFail) toast('All camera settings saved', 'success');
}

function rebuildCamRadios(cameras) {
  const grid = document.getElementById('upload-camera-grid');
  if (!grid || !cameras.length) return;
  grid.innerHTML = cameras.map((cam, i) => `
    <label class="cam-radio${i === 0 ? ' active' : ''}">
      <input type="radio" name="upload-camera" value="${esc(cam.id)}" ${i === 0 ? 'checked' : ''} />
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M15 9l3.5-2v6L15 11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <span class="cam-id">${esc(cam.id)}</span><span class="cam-loc">${esc(cam.location)}</span>
    </label>`).join('');
  grid.querySelectorAll('.cam-radio').forEach(label =>
    label.querySelector('input')?.addEventListener('change', () => {
      grid.querySelectorAll('.cam-radio').forEach(l => l.classList.remove('active'));
      label.classList.add('active');
    })
  );
}

async function uploadVideo() {
  const st = document.getElementById('upload-status-msg');
  if (!_uploadFile) { st.textContent = 'Select a video file first.'; st.className = 'status-inline err'; return; }
  const dirtyCards = document.querySelectorAll('.cam-config-card.dirty');
  if (dirtyCards.length) {
    st.textContent = 'Saving camera settings…'; st.className = 'status-inline';
    for (const card of dirtyCards) { const camId = card.id.replace('cfg-card-', ''); try { await saveCameraConfig(camId); } catch {} }
  }
  st.textContent = 'Uploading…'; st.className = 'status-inline';
  const camId = document.querySelector('input[name="upload-camera"]:checked')?.value || 'C01';
  const fd = new FormData(); fd.append('camera_id', camId); fd.append('video', _uploadFile);
  try {
    const job = await API.upload.video(fd);
    st.textContent = `Job started (${job.job_id.slice(0, 8)}…)`; st.className = 'status-inline ok';
    _uploadFile = null;
    document.getElementById('upload-file-info').style.display = 'none';
    toast(`Processing started for ${camId} — this may take several minutes`, 'info');
    loadUploadJobs(); pollJob(job.job_id);
  } catch (e) {
    st.textContent = e.message; st.className = 'status-inline err';
    toast('Upload failed: ' + e.message, 'error');
  }
}

async function loadUploadJobs() {
  const el = document.getElementById('upload-jobs-list');
  if (!el) return;
  try {
    const jobs = await API.upload.jobs();
    if (!jobs.length) { el.innerHTML = `<div class="empty-msg">No jobs yet. Upload a video to start processing.</div>`; return; }
    el.innerHTML = jobs.map(j => {
      const loc = _camConfig[j.camera_id]?.location || j.camera_id;
      return `<div class="job-row" id="job-${j.job_id}">
        <div class="job-icon"><svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8l4 2-4 2V8z" fill="currentColor" opacity=".6"/></svg></div>
        <div class="job-info"><div class="job-name">${esc(j.camera_id)} · ${esc(loc)} — ${esc(j.filename)}</div><div class="job-msg">${esc(j.message || '')}</div></div>
        <span class="chip chip-${j.status}">${j.status}</span>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div class="empty-msg" style="color:var(--error)">${esc(e.message)}</div>`;
  }
}

const _jobPollers = {};
function pollJob(jobId) {
  if (_jobPollers[jobId]) return;
  _jobPollers[jobId] = setInterval(async () => {
    try {
      const job = await API.upload.status(jobId);
      const row = document.getElementById(`job-${jobId}`);
      if (row) {
        row.querySelector('.job-msg').textContent = job.message || '';
        const chip = row.querySelector('.chip');
        chip.className = `chip chip-${job.status}`; chip.textContent = job.status;
      }
      if (job.status === 'done' || job.status === 'failed') {
        clearInterval(_jobPollers[jobId]); delete _jobPollers[jobId];
        const loc = _camConfig[job.camera_id]?.location || job.camera_id;
        if (job.status === 'done') toast(`Pipeline complete — ${job.camera_id} (${loc})`, 'success');
        else toast(`Pipeline failed — ${job.camera_id}`, 'error');
      }
    } catch { clearInterval(_jobPollers[jobId]); delete _jobPollers[jobId]; }
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════════════
   DROP ZONES & UTILS
═══════════════════════════════════════════════════════════════════ */
function setupDropZones() {
  ['query-drop-zone', 'reg-drop-zone', 'upload-drop-zone'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag');
      const files = e.dataTransfer.files;
      if (!files?.length) return;
      if (id === 'query-drop-zone') handleQueryPhoto(files[0]);
      if (id === 'reg-drop-zone')   handleRegPhoto(files[0]);
      if (id === 'upload-drop-zone') handleUploadVideo(files[0]);
    });
  });
  document.getElementById('query-photo-input')?.addEventListener('change', e => e.target.files[0] && handleQueryPhoto(e.target.files[0]));
  document.getElementById('reg-photo-input')?.addEventListener('change', e => e.target.files[0] && handleRegPhoto(e.target.files[0]));
  document.getElementById('upload-video-input')?.addEventListener('change', e => e.target.files[0] && handleUploadVideo(e.target.files[0]));
}
function handleQueryPhoto(file) { _queryPhotoFile = file; showPhotoPreview('query-photo-preview', file); }
function handleRegPhoto(file) { showPhotoPreview('reg-photo-preview', file); }
function handleUploadVideo(file) {
  _uploadFile = file;
  const info = document.getElementById('upload-file-info');
  if (info) { info.style.display = 'block'; info.innerHTML = `<strong>Selected:</strong> ${esc(file.name)} (${(file.size/1024/1024).toFixed(1)} MB)`; }
}
function showPhotoPreview(previewId, file) {
  const el = document.getElementById(previewId);
  if (!el) return;
  const reader = new FileReader();
  reader.onload = e => { el.innerHTML = `<img src="${e.target.result}" />`; el.style.display = 'block'; };
  reader.readAsDataURL(file);
}
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="font-weight:700">${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span><div>${esc(msg)}</div>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3200);
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.getElementById('modal').classList.add('hidden');
}
function esc(str) { return str == null ? '' : String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtTime(isoStr) {
  if (!isoStr) return '—';
  try { return new Date(isoStr).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
  catch { return isoStr; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════════════
   CAMERA LOCATION MANAGER — Google Maps integration
═══════════════════════════════════════════════════════════════════ */
const CamLoc = { map: null, marker: null, allMarkers: {}, cameras: [], selectedId: null, mapsLoaded: false, mapsLoading: false, searchBox: null };

async function loadCameraLocationView() {
  try { CamLoc.cameras = await API.cameras.list(); }
  catch { CamLoc.cameras = State.cameras || []; }
  renderCamLocList(); _updateCamLocStats();
  try {
    const cfg = await API.cameras.mapsConfig();
    const banner = document.getElementById('maps-not-configured-banner');
    if (!cfg.configured) {
      if (banner) banner.style.display = 'flex';
      const ph = document.getElementById('cam-map-placeholder');
      if (ph) ph.querySelector('span').textContent = 'Google Maps API key not configured — see banner above.';
      return;
    }
    if (banner) banner.style.display = 'none';
    await loadGoogleMapsScript(cfg.google_maps_api_key);
  } catch (e) { toast('Failed to load Maps config: ' + e.message, 'error'); return; }
  if (!CamLoc.map) initCamLocMap(); else refreshAllCamMarkers();
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (CamLoc.mapsLoaded) { resolve(); return; }
    if (CamLoc.mapsLoading) { const poll = setInterval(() => { if (CamLoc.mapsLoaded) { clearInterval(poll); resolve(); } }, 100); return; }
    CamLoc.mapsLoading = true;
    window._traceMapsCallback = () => { CamLoc.mapsLoaded = true; CamLoc.mapsLoading = false; resolve(); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=_traceMapsCallback`;
    script.async = true; script.defer = true;
    script.onerror = () => { CamLoc.mapsLoading = false; reject(new Error('Google Maps script failed to load. Check your API key.')); };
    document.head.appendChild(script);
  });
}

function initCamLocMap() {
  const container = document.getElementById('cam-location-map');
  if (!container || !window.google?.maps) return;
  document.getElementById('cam-map-placeholder').style.display = 'none';
  const firstWithCoords = CamLoc.cameras.find(c => c.latitude != null && c.longitude != null);
  const centre = firstWithCoords ? { lat: firstWithCoords.latitude, lng: firstWithCoords.longitude } : { lat: 30.7333, lng: 76.7794 };
  CamLoc.map = new google.maps.Map(container, { center: centre, zoom: 15, mapTypeId: 'roadmap', mapTypeControl: true, zoomControl: true, streetViewControl: false, fullscreenControl: true });
  CamLoc.map.addListener('click', (e) => {
    if (!CamLoc.selectedId) { toast('Select a camera from the list first', 'info'); return; }
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    placeDraggableMarker(lat, lng); updateEditFormCoords(lat, lng);
  });
  const searchInput = document.getElementById('cam-loc-search');
  if (searchInput && google.maps.places) {
    CamLoc.searchBox = new google.maps.places.SearchBox(searchInput);
    CamLoc.searchBox.addListener('places_changed', () => {
      const places = CamLoc.searchBox.getPlaces();
      if (!places?.length) return;
      const place = places[0];
      if (!place.geometry?.location) return;
      const lat = place.geometry.location.lat(), lng = place.geometry.location.lng();
      CamLoc.map.setCenter({ lat, lng }); CamLoc.map.setZoom(17);
      placeDraggableMarker(lat, lng); updateEditFormCoords(lat, lng);
      const nameInput = document.getElementById('cam-loc-name');
      if (nameInput && !nameInput.value.trim() && place.name) nameInput.value = place.name;
    });
  }
  refreshAllCamMarkers();
}

function placeDraggableMarker(lat, lng) {
  if (!CamLoc.map) return;
  if (CamLoc.marker) { CamLoc.marker.setPosition({ lat, lng }); return; }
  CamLoc.marker = new google.maps.Marker({
    position: { lat, lng }, map: CamLoc.map, draggable: true, animation: google.maps.Animation.DROP,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: PALETTE.burgundy, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
  });
  CamLoc.marker.addListener('dragend', (e) => updateEditFormCoords(e.latLng.lat(), e.latLng.lng()));
}

function refreshAllCamMarkers() {
  if (!CamLoc.map) return;
  Object.values(CamLoc.allMarkers).forEach(m => m.setMap(null));
  CamLoc.allMarkers = {};
  CamLoc.cameras.forEach(cam => {
    if (cam.latitude == null || cam.longitude == null) return;
    if (cam.id === CamLoc.selectedId) return;
    const marker = new google.maps.Marker({
      position: { lat: cam.latitude, lng: cam.longitude }, map: CamLoc.map,
      title: `${cam.id} — ${cam.location}`,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: PALETTE.info, fillOpacity: .9, strokeColor: '#fff', strokeWeight: 2 },
      label: { text: cam.id, color: '#fff', fontSize: '11px', fontWeight: '700' },
    });
    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="font-family:Inter,sans-serif;padding:4px 2px;min-width:140px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${esc(cam.id)} — ${esc(cam.location)}</div>
        <div style="font-size:11px;color:#64748b">${cam.latitude.toFixed(6)}, ${cam.longitude.toFixed(6)}</div>
        <button onclick="selectCameraForEdit('${cam.id}')" style="margin-top:8px;padding:4px 10px;background:${PALETTE.burgundy};color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px">Edit Location</button>
      </div>`,
    });
    marker.addListener('click', () => infoWindow.open(CamLoc.map, marker));
    CamLoc.allMarkers[cam.id] = marker;
  });
}

function _updateCamLocStats() {
  const cameras = CamLoc.cameras || [];
  const total = cameras.length;
  const pinned = cameras.filter(c => c.latitude != null && c.longitude != null).length;
  const unset = total - pinned;
  const coverage = total > 0 ? Math.round((pinned / total) * 100) + '%' : '—';
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('cam-loc-total-count', total || '—');
  setText('cam-loc-pinned-count', pinned || '0');
  setText('cam-loc-unset-count', unset || '0');
  setText('cam-loc-coverage', coverage);
  const badge = document.getElementById('cam-loc-badge');
  if (badge) badge.textContent = `${total} camera${total !== 1 ? 's' : ''}`;
}

function renderCamLocList() {
  const el = document.getElementById('cam-loc-list');
  if (!el) return;
  if (!CamLoc.cameras.length) { el.innerHTML = `<div class="empty-msg">No cameras registered</div>`; return; }
  el.innerHTML = CamLoc.cameras.map(cam => {
    const hasCoords = cam.latitude != null && cam.longitude != null;
    const isActive = cam.id === CamLoc.selectedId;
    return `<div class="cam-list-item ${isActive ? 'selected' : ''}" id="cam-loc-row-${cam.id}" onclick="selectCameraForEdit('${cam.id}')">
      <div class="cam-status-icon"><svg viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M15 9l3.5-2v6L15 11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <div class="cam-info">
        <div class="cam-name">${esc(cam.id)}</div>
        <div class="cam-loc">${esc(cam.location)}</div>
        <div class="cam-stats">${hasCoords ? `<span style="color:var(--success)">✓ ${cam.latitude.toFixed(5)}, ${cam.longitude.toFixed(5)}</span>` : `<span class="text-3">No coordinates set</span>`}</div>
      </div>
      <span class="cam-pin-status ${hasCoords ? 'pinned' : 'unset'}">${hasCoords ? 'Placed' : 'Unset'}</span>
    </div>`;
  }).join('');
}

function selectCameraForEdit(camId) {
  CamLoc.selectedId = camId;
  renderCamLocList();
  const cam = CamLoc.cameras.find(c => c.id === camId);
  if (!cam) return;
  document.getElementById('cam-loc-edit-panel').style.display = 'block';
  document.getElementById('cam-loc-edit-title').innerHTML = `<svg viewBox="0 0 20 20" fill="none" style="width:16px;height:16px"><path d="M14.5 2.5l3 3-10 10H4.5v-3l10-10z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg> Edit — ${esc(cam.id)}`;
  document.getElementById('cam-loc-name').value = cam.location || '';
  document.getElementById('cam-loc-lat').value  = cam.latitude  != null ? cam.latitude  : '';
  document.getElementById('cam-loc-lng').value  = cam.longitude != null ? cam.longitude : '';
  document.getElementById('cam-loc-search').value = '';
  document.getElementById('cam-loc-save-status').textContent = '';
  if (!CamLoc.map) return;
  if (CamLoc.marker) { CamLoc.marker.setMap(null); CamLoc.marker = null; }
  refreshAllCamMarkers();
  if (cam.latitude != null && cam.longitude != null) {
    CamLoc.map.setCenter({ lat: cam.latitude, lng: cam.longitude }); CamLoc.map.setZoom(17);
    placeDraggableMarker(cam.latitude, cam.longitude);
  } else {
    toast(`Click the map to place ${cam.id}`, 'info');
  }
}

function updateEditFormCoords(lat, lng) {
  const latEl = document.getElementById('cam-loc-lat'), lngEl = document.getElementById('cam-loc-lng');
  if (latEl) latEl.value = lat.toFixed(7);
  if (lngEl) lngEl.value = lng.toFixed(7);
}

function searchCameraLocation() {
  const input = document.getElementById('cam-loc-search');
  if (!input?.value.trim()) return;
  if (!window.google?.maps?.Geocoder) return;
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: input.value.trim() }, (results, status) => {
    if (status !== 'OK' || !results?.length) { toast('Location not found — try a different search', 'error'); return; }
    const loc = results[0].geometry.location;
    CamLoc.map.setCenter(loc); CamLoc.map.setZoom(17);
    placeDraggableMarker(loc.lat(), loc.lng()); updateEditFormCoords(loc.lat(), loc.lng());
    const nameInput = document.getElementById('cam-loc-name');
    if (nameInput && !nameInput.value.trim()) nameInput.value = results[0].formatted_address.split(',')[0];
  });
}

async function saveCameraLocation() {
  const statusEl = document.getElementById('cam-loc-save-status');
  if (!CamLoc.selectedId) { toast('No camera selected', 'error'); return; }
  const latVal  = parseFloat(document.getElementById('cam-loc-lat').value);
  const lngVal  = parseFloat(document.getElementById('cam-loc-lng').value);
  const nameVal = document.getElementById('cam-loc-name').value.trim();
  if (isNaN(latVal) || latVal < -90 || latVal > 90) { statusEl.textContent = 'Latitude must be between -90 and 90'; statusEl.className = 'status-inline err'; return; }
  if (isNaN(lngVal) || lngVal < -180 || lngVal > 180) { statusEl.textContent = 'Longitude must be between -180 and 180'; statusEl.className = 'status-inline err'; return; }
  statusEl.textContent = 'Saving…'; statusEl.className = 'status-inline';
  try {
    const updated = await API.cameras.updateLocation(CamLoc.selectedId, { latitude: latVal, longitude: lngVal, location: nameVal || undefined });
    const idx = CamLoc.cameras.findIndex(c => c.id === CamLoc.selectedId);
    if (idx !== -1) CamLoc.cameras[idx] = { ...CamLoc.cameras[idx], ...updated };
    const si = (State.cameras || []).findIndex(c => c.id === CamLoc.selectedId);
    if (si !== -1) State.cameras[si] = { ...State.cameras[si], ...updated };
    renderCamLocList(); refreshAllCamMarkers(); _updateCamLocStats();
    statusEl.textContent = '✓ Location saved'; statusEl.style.color = 'var(--success)';
    toast(`${CamLoc.selectedId} location saved`, 'success');
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message; statusEl.className = 'status-inline err';
    toast('Failed to save: ' + e.message, 'error');
  }
}

function clearCameraLocationEdit() {
  CamLoc.selectedId = null;
  if (CamLoc.marker) { CamLoc.marker.setMap(null); CamLoc.marker = null; }
  document.getElementById('cam-loc-edit-panel').style.display = 'none';
  renderCamLocList(); refreshAllCamMarkers();
}

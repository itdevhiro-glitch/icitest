import { auth, database, ADMIN_UID } from '../core/firebase.js';
import { $, $$, escapeHtml, formatRupiah, modeLabel, roleClass, toast, getRoundKeys, normalizeWhatsApp } from '../core/utils.js';
import { getAccountByUID } from '../core/team-service.js';

let currentKey = null;
let currentData = null;
let currentType = 'team';
let activeBracketId = null;
let pendingRegistration = null;
let leaderboardTeams = {};
let leaderboardUsers = {};
let leaderboardMode = 'team';
let paymentMethods = {}; // fallback untuk data tournament lama
let cachedTournaments = {};
const TEAM_MIN_PLAYERS = 5;
const TEAM_MAX_PLAYERS = 10;
const refs = [];

function normalizePlayers(players) {
  if (Array.isArray(players)) return players.filter(Boolean);
  if (players && typeof players === 'object') {
    return Object.keys(players)
      .sort((a, b) => Number(a) - Number(b))
      .map(key => players[key])
      .filter(Boolean);
  }
  return [];
}
function getTeamPlayers() { return normalizePlayers(currentData?.players); }
function normalizeLineupMax(value) {
  const raw = Number(value);
  const max = Number.isFinite(raw) && raw > 0 ? raw : TEAM_MIN_PLAYERS;
  return Math.max(TEAM_MIN_PLAYERS, Math.min(TEAM_MAX_PLAYERS, max));
}
function validLineupCount(count, maxPlayers) { return count >= TEAM_MIN_PLAYERS && count <= normalizeLineupMax(maxPlayers); }

const sections = { dashboard: $('#dashboard-section'), team: $('#team-section'), leaderboard: $('#leaderboard-section'), bracket: $('#bracket-section'), profile: $('#profile-section') };
let activeSectionId = 'dashboard';
function listen(path, callback) { const ref = database.ref(path); ref.on('value', callback); refs.push(ref); }
function cleanupListeners() { refs.splice(0).forEach(ref => ref.off()); }

function playSectionEnter(section) {
  if (!section) return;
  section.classList.remove('section-enter', 'section-enter-active');
  section.classList.add('section-enter');
  requestAnimationFrame(() => section.classList.add('section-enter-active'));
  window.setTimeout(() => section.classList.remove('section-enter', 'section-enter-active'), 360);
}

window.showSection = function(sectionId, btn) {
  const target = sections[sectionId];
  if (!target) return;
  if (activeSectionId !== sectionId) {
    Object.entries(sections).forEach(([id, section]) => section.classList.toggle('hidden', id !== sectionId));
    playSectionEnter(target);
    activeSectionId = sectionId;
  }
  $$('.nav-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
};
window.handleLogout = async function() { cleanupListeners(); await auth.signOut(); window.smoothNavigate ? window.smoothNavigate('login.html') : (window.location.href = 'login.html'); };
window.copyWA = async function(value = '') {
  const wa = normalizeWhatsApp(value);
  if (!wa) return toast('Nomor WhatsApp belum tersedia.', 'danger');
  try {
    await navigator.clipboard.writeText(wa);
    toast(`Nomor WA ${wa} berhasil dicopy.`, 'success');
  } catch {
    prompt('Copy nomor WhatsApp ini:', wa);
  }
};
function waAction(wa = '') {
  const clean = normalizeWhatsApp(wa);
  if (!clean) return '<span class="empty-wa">WA kosong</span>';
  return `<button class="btn small ghost" onclick="copyWA('${clean}')"><i class="ri-file-copy-line"></i> Copy WA</button><a class="btn small success" target="_blank" href="https://wa.me/${clean}"><i class="ri-whatsapp-line"></i> Chat</a>`;
}
function renderProfileForm() {
  const input = $('#profileWhatsapp');
  if (input && currentData) input.value = currentData.whatsapp || '';
}

auth.onAuthStateChanged(async user => {
  if (!user) return (window.smoothNavigate ? window.smoothNavigate('login.html') : (window.location.href = 'login.html'));
  if (user.uid === ADMIN_UID) return (window.smoothNavigate ? window.smoothNavigate('admin.html') : (window.location.href = 'admin.html'));
  const result = await getAccountByUID(user.uid);
  if (!result) { toast('Data akun tidak ditemukan.', 'danger'); await auth.signOut(); return (window.smoothNavigate ? window.smoothNavigate('login.html') : (window.location.href = 'login.html')); }
  currentKey = result.key; currentType = result.type; initDashboard();
});

function initDashboard() {
  $('#main-nav').innerHTML = `
    <button class="nav-btn active" onclick="showSection('dashboard', this)"><i class="ri-dashboard-line"></i><span>Dashboard</span></button>
    <button class="nav-btn" onclick="showSection('team', this)"><i class="ri-id-card-line"></i><span>Team Dashboard</span></button>
    <button class="nav-btn" onclick="showSection('leaderboard', this)"><i class="ri-trophy-line"></i><span>Leaderboard</span></button>
    <button class="nav-btn" onclick="showSection('bracket', this)"><i class="ri-organization-chart"></i><span>Brackets</span></button>
    <button class="nav-btn" onclick="showSection('profile', this)"><i class="ri-user-settings-line"></i><span>Edit Profile</span></button>
    <button class="nav-btn logout" onclick="handleLogout()"><i class="ri-logout-box-line"></i><span>Logout</span></button>`;
  const accountPath = currentType === 'team' ? `teams/${currentKey}` : `users/${currentKey}`;
  listen(accountPath, snap => { currentData = snap.val(); renderDashboard(); renderTeamStudio(); renderProfileForm(); });
  listen('tournaments', snap => { const t = snap.val() || {}; cachedTournaments = t; renderTournaments(t); renderBracketView(t); });
  listen('paymentMethods', snap => { paymentMethods = snap.val() || {}; renderPaymentMethodsForUser(); });
  listen('teams', snap => { leaderboardTeams = snap.val() || {}; renderLeaderboard(); });
  listen('users', snap => { leaderboardUsers = snap.val() || {}; renderLeaderboard(); });
}

function renderDashboard() {
  const title = currentType === 'team' ? currentData?.teamName : currentData?.displayName;
  $('#team-name').textContent = title || '-';
  const statusText = currentType === 'team' ? (currentData?.isBanned ? 'BANNED' : currentData?.isApproved ? 'VERIFIED TEAM' : 'WAITING APPROVAL') : 'SOLO USER';
  $('#team-status').textContent = statusText;
  $('#team-status').className = `status-pill ${currentData?.isApproved || currentType === 'user' ? 'success' : 'muted'}`;
  $('#dash-stat-status') && ($('#dash-stat-status').textContent = statusText);
  $('#dash-stat-mode') && ($('#dash-stat-mode').textContent = currentType === 'team' ? 'Team 5v5 + Brawl' : 'Solo Brawl');

  if (currentType === 'user') {
    $('#roster-count').textContent = 'Solo';
    $('#dash-stat-roster') && ($('#dash-stat-roster').textContent = 'Solo');
    $('#roster-list').innerHTML = `<article class="player-card solo-roster-card"><div class="solo-roster-avatar"><i class="ri-user-star-line"></i></div><div class="player-main solo-roster-main"><span class="role-badge role-sub">SOLO PLAYER</span><strong>${escapeHtml(currentData?.displayName || currentData?.username)}</strong><small>WA: ${escapeHtml(currentData?.whatsapp || '-')}</small></div><div class="row-actions solo-roster-actions">${waAction(currentData?.whatsapp || '')}</div></article><div class="empty-state solo-only-note">Akun user hanya bisa ikut tournament 1 vs 1 Brawl. Mode Team 5v5 sengaja disembunyikan agar alurnya tidak rancu.</div>`;
    $('#add-player-form').classList.add('hidden');
    return;
  }

  const maxRoster = Number(currentData?.maxRoster || 10);
  const players = getTeamPlayers().sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
  $('#roster-count').textContent = `${players.length}/${maxRoster}`;
  $('#dash-stat-roster') && ($('#dash-stat-roster').textContent = `${players.length}/${maxRoster}`);
  $('#roster-list').innerHTML = players.length ? players.map((player, index) => `
    <article class="player-card">
      <span class="role-badge role-${roleClass(player.role)}">${escapeHtml(player.role)}</span>
      <div class="player-main"><strong>${escapeHtml(player.name)}</strong><small>ID: ${escapeHtml(player.id)}</small></div>
      <button class="icon-btn danger" onclick="removePlayer('${currentKey}', ${index})" title="Remove"><i class="ri-delete-bin-line"></i></button>
    </article>`).join('') : `<div class="empty-state">Belum ada roster. Tambahkan player dulu.</div>`;
  $('#add-player-form').classList.toggle('hidden', players.length >= maxRoster);
}
function roleWeight(role) { return { Jungler: 1, Roamer: 2, MidLane: 3, ExpLane: 4, GoldLane: 5, Cadangan: 6 }[role] || 99; }

$('#add-player-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (currentType !== 'team') return;
  const players = getTeamPlayers();
  const maxRoster = Number(currentData.maxRoster || 10);
  if (players.length >= maxRoster) return toast(`Roster penuh. Max ${maxRoster} player.`, 'danger');
  const role = $('#playerRole').value, name = $('#playerName').value.trim(), id = $('#playerId').value.trim();
  if (role !== 'Cadangan' && players.some(p => p.role === role) && !confirm(`Role ${role} sudah ada. Tetap tambah?`)) return;
  players.push({ role, name, id });
  await database.ref(`teams/${currentKey}/players`).set(players);
  event.target.reset(); toast('Player ditambahkan.', 'success');
});
window.removePlayer = async function(teamKey, index) { if (!confirm('Remove player?')) return; const snap = await database.ref(`teams/${teamKey}/players`).once('value'); const players = snap.val() || []; players.splice(index, 1); await database.ref(`teams/${teamKey}/players`).set(players); toast('Player dihapus.', 'success'); };


const CARD_THEMES = {
  neon: { label:'Neon Purple', colors:['#7c3aed','#06b6d4','#111827'], accent:'#a78bfa' },
  fire: { label:'Crimson Fire', colors:['#ef4444','#f97316','#111827'], accent:'#fecaca' },
  ocean: { label:'Ocean Blue', colors:['#0ea5e9','#2563eb','#0f172a'], accent:'#bfdbfe' },
  emerald: { label:'Emerald Mint', colors:['#10b981','#14b8a6','#052e2b'], accent:'#bbf7d0' },
  gold: { label:'Royal Gold', colors:['#f59e0b','#facc15','#111827'], accent:'#fef3c7' },
  mono: { label:'Clean Mono', colors:['#111827','#334155','#020617'], accent:'#e5e7eb' }
};
function getTeamThemeKey(){ return CARD_THEMES[currentData?.cardTheme] ? currentData.cardTheme : 'neon'; }
function getTeamTheme(){ return CARD_THEMES[getTeamThemeKey()]; }
function playerFieldValue(index, field) {
  const input = $(`#teamPlayer${index}_${field}`);
  return input ? input.value.trim() : '';
}
function renderTeamStudio() {
  const host = $('#team-studio-content');
  if (!host) return;
  if (!currentData) return (host.innerHTML = '<div class="empty-state">Loading team data...</div>');
  if (currentType !== 'team') return (host.innerHTML = '<div class="empty-state">Dashboard team card hanya tersedia untuk akun team.</div>');
  const players = getTeamPlayers().sort((a,b)=>roleWeight(a.role)-roleWeight(b.role));
  const themeKey = getTeamThemeKey();
  const theme = getTeamTheme();
  host.innerHTML = `
    <div class="team-theme-panel">
      <div>
        <b>Tema kartu team</b>
        <small>Warna ini disimpan ke akun team dan dipakai saat generate card.</small>
      </div>
      <div class="theme-picker-grid">
        ${Object.entries(CARD_THEMES).map(([key,t]) => `<button class="theme-chip ${key === themeKey ? 'active' : ''}" onclick="setTeamCardTheme('${key}')"><span style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]},${t.colors[2]})"></span>${escapeHtml(t.label)}</button>`).join('')}
      </div>
    </div>
    <div class="card-preview-shell" style="--card-a:${theme.colors[0]};--card-b:${theme.colors[1]};--card-c:${theme.colors[2]};--card-accent:${theme.accent}">
      <div class="mini-player-card-demo">
        <span>TEAM CARD</span><h3>${escapeHtml(currentData.teamName || 'Team Name')}</h3><p>${players[0] ? escapeHtml(players[0].name || 'Nickname') : 'Nickname Player'}</p><small>${players[0] ? escapeHtml(players[0].role || 'Role') : 'Role'} • ID ${players[0] ? escapeHtml(players[0].id || '-') : '000000'}</small>
      </div>
      <p class="muted-text">Preview cepat. Tombol download di bawah akan membuat PNG per player ukuran 1080x1350.</p>
    </div>
    <div class="player-editor-list">
      ${players.length ? players.map((p,i)=>renderPlayerEditorRow(p,i)).join('') : '<div class="empty-state">Roster masih kosong. Tambahkan player dulu di dashboard utama.</div>'}
    </div>`;
}
function renderPlayerEditorRow(player, index) {
  const roles = ['Jungler','Roamer','MidLane','ExpLane','GoldLane','Cadangan'];
  return `<article class="team-player-editor">
    <div class="player-editor-title"><span>#${index + 1}</span><div><b>${escapeHtml(player.name || 'Player')}</b><small>${escapeHtml(player.role || '-')} • ID ${escapeHtml(player.id || '-')}</small></div></div>
    <div class="player-editor-form">
      <label>Role<select id="teamPlayer${index}_role">${roles.map(role=>`<option ${role === player.role ? 'selected' : ''}>${role}</option>`).join('')}</select></label>
      <label>Nickname<input id="teamPlayer${index}_name" value="${escapeHtml(player.name || '')}" placeholder="Nickname"></label>
      <label>ID Akun<input id="teamPlayer${index}_id" value="${escapeHtml(player.id || '')}" placeholder="Game ID"></label>
    </div>
    <div class="row-actions player-editor-actions">
      <button class="btn small success" onclick="saveTeamPlayer(${index})"><i class="ri-save-3-line"></i> Save</button>
      <button class="btn small" onclick="downloadPlayerCard(${index})"><i class="ri-download-2-line"></i> Download Card</button>
      <button class="icon-btn danger" onclick="removePlayer('${currentKey}', ${index})" title="Remove"><i class="ri-delete-bin-line"></i></button>
    </div>
  </article>`;
}
window.renderTeamStudio = renderTeamStudio;
window.setTeamCardTheme = async function(themeKey) {
  if (!CARD_THEMES[themeKey] || currentType !== 'team') return;
  await database.ref(`teams/${currentKey}/cardTheme`).set(themeKey);
  toast(`Tema kartu diganti ke ${CARD_THEMES[themeKey].label}.`, 'success');
};
window.saveTeamPlayer = async function(index) {
  if (currentType !== 'team') return;
  const players = getTeamPlayers();
  if (!players[index]) return toast('Player tidak ditemukan. Refresh dashboard dulu.', 'danger');
  const role = playerFieldValue(index,'role');
  const name = playerFieldValue(index,'name');
  const id = playerFieldValue(index,'id');
  if (!role || !name || !id) return toast('Role, nickname, dan ID akun wajib diisi.', 'danger');
  players[index] = { ...players[index], role, name, id };
  await database.ref(`teams/${currentKey}/players`).set(players);
  toast('Data player berhasil diupdate.', 'success');
};
function roundRect(ctx,x,y,w,h,r){ const rr=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath(); }
function drawCardText(ctx,text,x,y,maxWidth,font,fill='#ffffff',align='left'){
  ctx.font=font; ctx.fillStyle=fill; ctx.textAlign=align; ctx.textBaseline='top';
  let value=String(text || '-');
  while(ctx.measureText(value).width > maxWidth && value.length > 3) value=value.slice(0,-2);
  if(value !== String(text || '-')) value=value.slice(0,-1)+'…';
  ctx.fillText(value,x,y);
}
window.downloadPlayerCard = async function(index) {
  const players = getTeamPlayers();
  const player = players[index];
  if (!player) return toast('Player tidak ditemukan.', 'danger');
  const theme = getTeamTheme();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,1080,1350);
  grad.addColorStop(0, theme.colors[0]); grad.addColorStop(.48, theme.colors[1]); grad.addColorStop(1, theme.colors[2]);
  ctx.fillStyle = grad; ctx.fillRect(0,0,1080,1350);
  ctx.globalAlpha=.18; ctx.fillStyle='#fff';
  for(let i=0;i<34;i++){ ctx.beginPath(); ctx.arc(Math.random()*1080, Math.random()*1350, 8+Math.random()*34, 0, Math.PI*2); ctx.fill(); }
  ctx.globalAlpha=1;
  ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.lineWidth=2;
  for(let i=0;i<8;i++){ ctx.beginPath(); ctx.arc(880,180,140+i*54,0,Math.PI*2); ctx.stroke(); }
  roundRect(ctx,70,78,940,1194,54); ctx.fillStyle='rgba(2,6,23,.42)'; ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.30)'; ctx.lineWidth=3; ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.13)'; roundRect(ctx,118,126,844,92,30); ctx.fill();
  drawCardText(ctx,'ICIKIWIR TOURNAMENT OS',150,154,520,'700 30px Arial',theme.accent);
  ctx.textAlign='right'; drawCardText(ctx,'PLAYER CARD',930,154,300,'800 30px Arial','#fff','right');
  ctx.fillStyle='rgba(255,255,255,.14)'; roundRect(ctx,150,285,780,330,42); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.20)'; ctx.beginPath(); ctx.arc(540,450,116,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=theme.accent; ctx.font='900 110px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(player.name || '?').slice(0,1).toUpperCase(),540,452);
  drawCardText(ctx,currentData.teamName || 'Team Name',540,690,820,'900 62px Arial','#fff','center');
  drawCardText(ctx,player.name || 'Nickname',540,780,820,'900 82px Arial',theme.accent,'center');
  ctx.fillStyle='rgba(255,255,255,.12)'; roundRect(ctx,150,920,780,230,34); ctx.fill();
  drawCardText(ctx,'ROLE',195,960,220,'800 28px Arial','rgba(255,255,255,.68)');
  drawCardText(ctx,player.role || '-',195,1002,310,'900 46px Arial','#fff');
  drawCardText(ctx,'ID AKUN',570,960,220,'800 28px Arial','rgba(255,255,255,.68)');
  drawCardText(ctx,player.id || '-',570,1002,310,'900 46px Arial','#fff');
  ctx.fillStyle='rgba(255,255,255,.16)'; roundRect(ctx,150,1190,780,42,21); ctx.fill();
  drawCardText(ctx,'Generated for official team roster',540,1200,700,'700 23px Arial','rgba(255,255,255,.76)','center');
  const a=document.createElement('a');
  const safeName=String(player.name || 'player').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'') || 'player';
  a.download=`${safeName}-team-card.png`; a.href=canvas.toDataURL('image/png'); a.click();
  toast(`Card ${player.name || 'player'} berhasil dibuat.`, 'success');
};

function visibleTournament(t) {
  if (currentType === 'user') return t.mode === 'brawl';
  return t.mode === 'team' || t.mode === 'brawl';
}
function renderTournaments(tournaments) {
  const grid = $('#tournament-grid');
  const rows = Object.entries(tournaments).filter(([,t]) => visibleTournament(t)).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  $('#dash-stat-events') && ($('#dash-stat-events').textContent = rows.length);
  if (!rows.length) return (grid.innerHTML = `<div class="empty-state">Belum ada tournament yang cocok untuk akun ${currentType}.</div>`);
  grid.innerHTML = rows.map(([id, t]) => {
    const participant = t.participants?.[currentKey];
    const count = t.participants ? Object.keys(t.participants).length : 0;
    return `<article class="tournament-card ${t.fee > 0 ? 'premium-border' : ''}"><div class="t-card-top"><span class="badge">${escapeHtml(t.status || 'registration')}</span><span class="badge ${t.mode === 'brawl' ? 'brawl' : ''}">${modeLabel(t.mode)}</span></div><div class="t-card-body"><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.startDate || '-')} • Slots ${count}/${t.maxTeams || 0}</p><div class="money-box">${t.fee > 0 ? `<b>${formatRupiah(t.fee)}</b><small>Prize ${formatRupiah(t.prize)}</small>` : '<b class="success-text">FREE ENTRY</b><small>No fee</small>'}</div><div class="button-grid">${renderTournamentAction(id, t, participant)}<button class="btn ghost" onclick="viewRules('${id}')">Rules</button></div></div></article>`;
  }).join('');
}
function renderTournamentAction(id, t, participant) {
  if (participant) {
    if (participant.status === 'pending_payment') return `<button class="btn warning" onclick="openPaymentModal('${id}', ${Number(t.fee || 0)})">Pay Now</button>`;
    if (t.status === 'ongoing') return `<button class="btn" onclick="showBracketView('${id}')">View Bracket</button>`;
    return `<button class="btn muted" disabled>Registered</button>`;
  }
  if (t.status !== 'registration') return `<button class="btn muted" disabled>Closed</button>`;
  if (t.mode === 'team') {
    if (currentType !== 'team') return `<button class="btn muted" disabled>Khusus Team</button>`;
    const maxLineup = Math.max(TEAM_MIN_PLAYERS, Math.min(TEAM_MAX_PLAYERS, Number(t.playerPerTeam || TEAM_MIN_PLAYERS)));
    return `<button class="btn" onclick="openTeamJoinModal('${id}', ${Number(t.fee || 0)}, ${maxLineup})">Join Team ${TEAM_MIN_PLAYERS}-${maxLineup} Player</button>`;
  }
  if (t.mode === 'brawl') return `<button class="btn brawl" onclick="openSoloJoinModal('${id}', ${Number(t.fee || 0)})">Join 1 vs 1 Brawl</button>`;
  return `<button class="btn muted" disabled>Mode tidak tersedia</button>`;
}

const PAYMENT_ICON_MAP = { link: 'ri-links-line', wallet: 'ri-wallet-3-line', bank: 'ri-bank-card-line', custom: 'ri-information-line' };
function getActivePaymentMethods() {
  const tournamentMethods = pendingRegistration?.paymentMethods || cachedTournaments?.[pendingRegistration?.tid]?.paymentMethods || {};
  const source = Object.keys(tournamentMethods || {}).length ? tournamentMethods : paymentMethods;
  return Object.entries(source || {})
    .filter(([, m]) => (m.status || 'active') === 'active')
    .sort((a,b)=>(Number(a[1].order||99)-Number(b[1].order||99)) || String(a[1].name||a[0]).localeCompare(String(b[1].name||b[0])));
}
function isPaymentLink(value='') { return /^https?:\/\//i.test(String(value || '').trim()); }
window.copyPaymentTarget = async function(value='') {
  if (!value) return toast('Data pembayaran kosong.', 'danger');
  try { await navigator.clipboard.writeText(value); toast('Data pembayaran berhasil dicopy.', 'success'); }
  catch { prompt('Copy data pembayaran ini:', value); }
};
function renderPaymentMethodsForUser() {
  const host = $('#payment-methods-container');
  if (!host) return;
  const rows = getActivePaymentMethods();
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state">Belum ada metode pembayaran aktif untuk tournament ini. Hubungi admin.</div>';
    return;
  }
  host.innerHTML = rows.map(([id, m]) => {
    const target = String(m.target || '').trim();
    const icon = PAYMENT_ICON_MAP[m.type] || PAYMENT_ICON_MAP.custom;
    const safeTarget = escapeHtml(target);
    const detail = `
      <span class="payment-copy">
        <b>${escapeHtml(m.name || id)}</b>
        ${m.owner ? `<small><strong>A.N / Owner:</strong> ${escapeHtml(m.owner)}</small>` : ''}
        ${target ? `<small class="payment-number">${safeTarget}</small>` : ''}
        ${m.note ? `<small>${escapeHtml(m.note)}</small>` : ''}
      </span>`;
    if (isPaymentLink(target)) {
      return `<a href="${safeTarget}" target="_blank" rel="noopener noreferrer" class="payment-option ${escapeHtml(m.type || 'custom')}"><span class="payment-icon"><i class="${icon}"></i></span>${detail}</a>`;
    }
    return `<button type="button" class="payment-option ${escapeHtml(m.type || 'custom')}" onclick="copyPaymentTarget('${String(target).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"><span class="payment-icon"><i class="${icon}"></i></span>${detail}</button>`;
  }).join('');
}

function updateTeamLineupCounter() {
  if (!pendingRegistration || pendingRegistration.mode !== 'team') return;
  const checkedCount = $$('#teamJoinPlayers input:checked').length;
  const min = pendingRegistration.minPlayers || TEAM_MIN_PLAYERS;
  const max = pendingRegistration.maxPlayers || TEAM_MIN_PLAYERS;
  const valid = checkedCount >= min && checkedCount <= max;
  $('#teamJoinHint').textContent = `Pilih minimal ${min} player dan maksimal ${max} player. Terpilih: ${checkedCount}/${max}.`;
  $$('#teamJoinPlayers input:not(:checked)').forEach(input => { input.disabled = checkedCount >= max; });
  const btn = $('#confirmTeamLineupBtn');
  if (btn) {
    btn.disabled = !valid;
    btn.textContent = valid ? `Confirm ${checkedCount} Player` : `Pilih ${min}-${max} Player`;
  }
}
window.openTeamJoinModal = function(tid, fee, playerPerTeam) {
  if (currentType !== 'team') return toast('Mode team hanya untuk akun team.', 'danger');
  if (!currentData?.isApproved && !confirm('Team belum verified. Tetap lanjut daftar?')) return;
  const players = getTeamPlayers();
  const maxPlayers = normalizeLineupMax(playerPerTeam);
  if (players.length < TEAM_MIN_PLAYERS) return toast(`Roster kurang. Minimal ${TEAM_MIN_PLAYERS} player untuk daftar tournament team.`, 'danger');
  pendingRegistration = { tid, fee, mode: 'team', minPlayers: TEAM_MIN_PLAYERS, maxPlayers };
  $('#teamJoinHint').textContent = `Pilih minimal ${TEAM_MIN_PLAYERS} player dan maksimal ${maxPlayers} player.`;
  $('#teamJoinPlayers').innerHTML = players.map((p, i) => `<label class="check-row"><input type="checkbox" value="${i}" onchange="updateTeamLineupCounter()"><span>${escapeHtml(p.name)} • ${escapeHtml(p.role)} • ID ${escapeHtml(p.id)}</span></label>`).join('');
  $('#team-join-modal').classList.remove('hidden');
  updateTeamLineupCounter();
};
window.updateTeamLineupCounter = updateTeamLineupCounter;
window.confirmTeamRegistration = async function() {
  try {
    if (!pendingRegistration || pendingRegistration.mode !== 'team') throw new Error('Data pendaftaran belum siap. Buka ulang modal join.');
    const checked = $$('#teamJoinPlayers input:checked').map(el => Number(el.value));
    const min = pendingRegistration.minPlayers || TEAM_MIN_PLAYERS;
    const max = pendingRegistration.maxPlayers || TEAM_MIN_PLAYERS;
    if (checked.length < min || checked.length > max) return toast(`Pilih ${min}-${max} player. Saat ini terpilih ${checked.length}.`, 'danger');
    const roster = getTeamPlayers();
    const selectedPlayers = checked.map(i => roster[i]).filter(Boolean);
    if (!validLineupCount(selectedPlayers.length, max)) return toast(`Lineup valid itu minimal ${TEAM_MIN_PLAYERS} dan maksimal ${max} player. Saat ini valid terbaca ${selectedPlayers.length}.`, 'danger');
    const extra = { displayName: currentData.teamName, type: 'team', whatsapp: currentData.whatsapp || '', selectedPlayers, lineupMin: min, lineupMax: max };
    closeModal('team-join-modal');
    if (pendingRegistration.fee > 0) return openPaymentModal(pendingRegistration.tid, pendingRegistration.fee, extra);
    await completeRegistration(pendingRegistration.tid, 'approved', extra);
  } catch (error) { toast(String(error.message || error), 'danger'); }
};
window.openSoloJoinModal = function(tid, fee) {
  pendingRegistration = { tid, fee, mode: 'brawl' };
  const players = currentType === 'team' ? getTeamPlayers() : [{ name: currentData.displayName || currentData.username, id: currentData.gameId || currentData.username, role: 'Solo Player' }];
  if (!players.length) return toast('Tambahkan roster dulu sebelum join 1 vs 1 Brawl.', 'danger');
  $('#brawlPlayer').innerHTML = players.map((p, i) => `<option value="${i}">${escapeHtml(p.name)} • ${escapeHtml(p.role)} • ID ${escapeHtml(p.id)}</option>`).join('');
  $('#brawl-modal').classList.remove('hidden');
};
window.confirmBrawlRegistration = async function() {
  try {
    const index = Number($('#brawlPlayer').value);
    const player = currentType === 'team' ? getTeamPlayers()[index] : { name: currentData.displayName || currentData.username, id: currentData.gameId || currentData.username, role: 'Solo Player' };
    if (!player || !pendingRegistration) return;
    const displayName = currentType === 'team' ? `${player.name} (${currentData.teamName})` : player.name;
    const extra = { displayName, playerName: player.name, gameId: player.id, role: player.role, type: currentType === 'team' ? 'brawl' : 'user', whatsapp: currentData.whatsapp || '' };
    closeModal('brawl-modal');
    if (pendingRegistration.fee > 0) return openPaymentModal(pendingRegistration.tid, pendingRegistration.fee, extra);
    await completeRegistration(pendingRegistration.tid, 'approved', extra);
  } catch (error) { toast(String(error.message || error), 'danger'); }
};
window.openPaymentModal = async function(tid, fee, extra = null) {
  let tournament = cachedTournaments?.[tid];
  if (!tournament) {
    const snap = await database.ref(`tournaments/${tid}`).once('value');
    tournament = snap.val() || {};
  }
  pendingRegistration = { ...(pendingRegistration || {}), tid, fee, extra, paymentMethods: tournament.paymentMethods || {} };
  $('#payment-fee-display').textContent = formatRupiah(fee);
  renderPaymentMethodsForUser();
  $('#payment-modal').classList.remove('hidden');
};
window.confirmPayment = async function() { try { const { tid, extra } = pendingRegistration || {}; await completeRegistration(tid, 'pending_payment', extra || defaultParticipantExtra()); closeModal('payment-modal'); toast('Status pending payment. Tunggu approval admin.', 'success'); } catch (error) { toast(String(error.message || error), 'danger'); } };
function defaultParticipantExtra(){ return currentType === 'team' ? { displayName: currentData.teamName, type:'team', whatsapp: currentData.whatsapp || '' } : { displayName: currentData.displayName || currentData.username, type:'user', whatsapp: currentData.whatsapp || '' }; }
async function completeRegistration(tid, status, extra) {
  const snap = await database.ref(`tournaments/${tid}`).once('value');
  const t = snap.val();
  if (!t) throw new Error('Tournament tidak ditemukan.');
  if (!visibleTournament(t)) throw new Error('Tipe akun tidak sesuai dengan tournament ini.');
  if (t.status !== 'registration') throw new Error('Pendaftaran sudah ditutup.');
  const count = t.participants ? Object.keys(t.participants).length : 0;
  if (count >= Number(t.maxTeams || 0)) throw new Error('Slot penuh.');
  if (t.mode === 'team') {
    if (currentType !== 'team') throw new Error('Tournament ini khusus team.');
    const maxPlayers = normalizeLineupMax(t.playerPerTeam);
    const selectedPlayers = normalizePlayers(extra?.selectedPlayers);
    if (!validLineupCount(selectedPlayers.length, maxPlayers)) throw new Error(`Lineup harus minimal ${TEAM_MIN_PLAYERS} player dan maksimal ${maxPlayers} player sesuai setting admin. Saat ini terbaca ${selectedPlayers.length}.`);
    extra.selectedPlayers = selectedPlayers;
    extra.lineupMin = TEAM_MIN_PLAYERS;
    extra.lineupMax = maxPlayers;
  }
  await database.ref(`tournaments/${tid}/participants/${currentKey}`).set({ accountKey: currentKey, teamKey: currentType === 'team' ? currentKey : '', teamName: currentData.teamName || '', status, registeredAt: firebase.database.ServerValue.TIMESTAMP, ...extra });
  toast('Berhasil daftar tournament.', 'success');
}

window.viewRules = async function(id) { const snap = await database.ref(`tournaments/${id}`).once('value'); $('#rules-content').textContent = snap.val()?.rules || 'Rules belum diisi.'; $('#rules-modal').classList.remove('hidden'); };
window.closeModal = function(id) { $(`#${id}`).classList.add('hidden'); };
window.showBracketView = async function(tournamentId) { activeBracketId = tournamentId; window.showSection('bracket', $$('.nav-btn').find(btn => btn.textContent.includes('Brackets')) || $$('.nav-btn')[3]); const snap = await database.ref(`tournaments/${tournamentId}`).once('value'); renderSingleBracket(snap.val()); };
function renderBracketView(tournaments) { if (!activeBracketId) return; const t = tournaments[activeBracketId]; if (t) renderSingleBracket(t); }
function participantName(t, id) { return t?.participants?.[id]?.displayName || t?.participants?.[id]?.teamName || id || 'TBD'; }
function renderSingleBracket(t) {
  const host = $('#tournament-bracket-view');
  if (!t?.bracket) return (host.innerHTML = '<div class="empty-state">Bracket belum dibuat admin.</div>');
  const participantContacts = Object.entries(t.participants || {}).map(([key,p]) => `
    <article class="contact-card"><div><b>${escapeHtml(p.displayName || p.teamName || key)}</b><small>${escapeHtml(p.type || t.mode)} • ${p.selectedPlayers ? `${p.selectedPlayers.length} player` : escapeHtml(p.role || 'Participant')}</small></div><div class="row-actions">${waAction(p.whatsapp || '')}</div></article>`).join('');
  host.innerHTML = `<div class="bracket-heading"><div><h2>${escapeHtml(t.name)}</h2><span>${modeLabel(t.mode)} • ${escapeHtml(t.status)}</span></div></div>
  <div class="contact-panel"><div class="section-title"><i class="ri-whatsapp-line"></i> Kontak Koordinasi Lawan</div><div class="contact-grid">${participantContacts || '<div class="empty-state">Belum ada kontak participant.</div>'}</div></div>
  <div class="bracket-scroll">${getRoundKeys(t.bracket).map(roundKey => `<section class="round-column"><h3>${roundKey === 'bronze' ? 'Bronze Match' : roundKey.toUpperCase()}</h3>${t.bracket[roundKey].map(m => renderPublicMatch(t,m)).join('')}</section>`).join('')}</div>`;
}
function renderPublicMatch(t,m){
  const a=t.participants?.[m.teamA], b=t.participants?.[m.teamB];
  return `<article class="match-card ${m.completed ? 'done' : ''}"><div class="match-meta"><span>${escapeHtml(m.id)}</span><b>BO${m.format || 1}</b></div>
  <div class="match-team ${m.winner === m.teamA ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamA))}</span><strong>${m.scoreA || 0}</strong></div>
  <div class="match-contact">${waAction(a?.whatsapp || '')}</div>
  <div class="match-team ${m.winner === m.teamB ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamB))}</span><strong>${m.scoreB || 0}</strong></div>
  <div class="match-contact">${waAction(b?.whatsapp || '')}</div></article>`;
}

$('#profile-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentData || !auth.currentUser) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const wa = normalizeWhatsApp($('#profileWhatsapp').value.trim());
    const newPassword = $('#profilePassword').value.trim();
    if (!/^62\d{8,15}$/.test(wa)) throw new Error('Nomor WhatsApp tidak valid. Contoh: 08123456789');
    const path = currentType === 'team' ? `teams/${currentKey}` : `users/${currentKey}`;
    await database.ref(`${path}/whatsapp`).set(wa);
    if (newPassword) {
      if (newPassword.length < 6) throw new Error('Password minimal 6 karakter.');
      await auth.currentUser.updatePassword(newPassword);
      $('#profilePassword').value = '';
    }
    toast('Profile berhasil diupdate.', 'success');
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('requires-recent-login')) toast('Untuk ganti password, logout lalu login ulang dulu agar Firebase mengizinkan perubahan password.', 'danger');
    else toast(msg, 'danger');
  } finally {
    button.disabled = false;
  }
});

window.switchLeaderboard = function(mode) {
  leaderboardMode = mode === 'solo' ? 'solo' : 'team';
  $$('.leaderboard-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.board === leaderboardMode));
  renderLeaderboard();
};

function scoreSet(stats = {}, keys = [], weights = []) {
  return keys.reduce((total, key, index) => total + Number(stats[key] || 0) * Number(weights[index] || 0), 0);
}
function medalTotal(stats = {}, keys = []) {
  return keys.reduce((total, key) => total + Number(stats[key] || 0), 0);
}
function renderLeaderboardSummary(rows, mode) {
  const totalPlayers = rows.length;
  const topName = rows[0]?.name || '-';
  const totalPoints = rows.reduce((sum, row) => sum + row.total, 0);
  $('#leaderboard-summary').innerHTML = `
    <article><small>Kategori</small><b>${mode === 'solo' ? 'Solo 1v1 Brawl' : 'Team 5v5'}</b></article>
    <article><small>Peserta terhitung</small><b>${totalPlayers}</b></article>
    <article><small>Top sementara</small><b>${escapeHtml(topName)}</b></article>
    <article><small>Total poin</small><b>${totalPoints}</b></article>`;
}
function rankClass(index) { return index < 3 ? `rank-${index + 1}` : ''; }
function renderLeaderboard() {
  const head = $('#leaderboard-head-row');
  const tbody = $('#leaderboard-body');
  if (!head || !tbody) return;

  if (leaderboardMode === 'solo') {
    const rows = Object.values(leaderboardUsers).map(user => {
      const s = user.stats || {};
      const champion = Number(s.brawlCh1 || 0), runnerUp = Number(s.brawlCh2 || 0), third = Number(s.brawlCh3 || 0);
      const total = scoreSet(s, ['brawlCh1', 'brawlCh2', 'brawlCh3'], [4, 2, 1]);
      return { name: user.displayName || user.username || 'Solo Player', username: user.username || '-', champion, runnerUp, third, medals: medalTotal(s, ['brawlCh1', 'brawlCh2', 'brawlCh3']), total };
    }).filter(row => row.total > 0 || row.medals > 0).sort((a, b) => b.total - a.total || b.champion - a.champion || a.name.localeCompare(b.name));
    head.innerHTML = '<tr><th>Rank</th><th>Solo Player</th><th>Juara 1</th><th>Juara 2</th><th>Juara 3</th><th>Total</th></tr>';
    renderLeaderboardSummary(rows, 'solo');
    tbody.innerHTML = rows.map((r, i) => `<tr class="${rankClass(i)}"><td>#${i + 1}</td><td><strong>${escapeHtml(r.name)}</strong><small>@${escapeHtml(r.username)}</small></td><td>${r.champion}</td><td>${r.runnerUp}</td><td>${r.third}</td><td><b>${r.total}</b></td></tr>`).join('') || '<tr><td colspan="6">Belum ada data Solo Brawl. Poin akan muncul setelah admin input hasil juara.</td></tr>';
    return;
  }

  const rows = Object.values(leaderboardTeams).map(team => {
    const s = team.stats || {};
    const free = scoreSet(s, ['ch1', 'ch2', 'ch3'], [5, 3, 1]);
    const paid = scoreSet(s, ['paidCh1', 'paidCh2', 'paidCh3'], [7, 4, 2]);
    const total = free + paid;
    return { name: team.teamName || team.username || 'Team', username: team.username || '-', free, paid, champion: Number(s.ch1 || 0) + Number(s.paidCh1 || 0), total };
  }).filter(row => row.total > 0 || row.champion > 0).sort((a, b) => b.total - a.total || b.champion - a.champion || a.name.localeCompare(b.name));
  head.innerHTML = '<tr><th>Rank</th><th>Team</th><th>Free 5v5</th><th>Paid 5v5</th><th>Juara 1</th><th>Total</th></tr>';
  renderLeaderboardSummary(rows, 'team');
  tbody.innerHTML = rows.map((r, i) => `<tr class="${rankClass(i)}"><td>#${i + 1}</td><td><strong>${escapeHtml(r.name)}</strong><small>@${escapeHtml(r.username)}</small></td><td>${r.free}</td><td>${r.paid}</td><td>${r.champion}</td><td><b>${r.total}</b></td></tr>`).join('') || '<tr><td colspan="6">Belum ada data Team 5v5. Poin brawl tidak dicampur ke leaderboard team.</td></tr>';
}

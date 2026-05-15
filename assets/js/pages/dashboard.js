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
const refs = [];

const sections = { dashboard: $('#dashboard-section'), leaderboard: $('#leaderboard-section'), bracket: $('#bracket-section'), profile: $('#profile-section') };
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
    <button class="nav-btn" onclick="showSection('leaderboard', this)"><i class="ri-trophy-line"></i><span>Leaderboard</span></button>
    <button class="nav-btn" onclick="showSection('bracket', this)"><i class="ri-organization-chart"></i><span>Brackets</span></button>
    <button class="nav-btn" onclick="showSection('profile', this)"><i class="ri-user-settings-line"></i><span>Edit Profile</span></button>
    <button class="nav-btn logout" onclick="handleLogout()"><i class="ri-logout-box-line"></i><span>Logout</span></button>`;
  const accountPath = currentType === 'team' ? `teams/${currentKey}` : `users/${currentKey}`;
  listen(accountPath, snap => { currentData = snap.val(); renderDashboard(); renderProfileForm(); });
  listen('tournaments', snap => { const t = snap.val() || {}; renderTournaments(t); renderBracketView(t); });
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
  const players = [...(currentData?.players || [])].sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
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
  const players = [...(currentData.players || [])];
  const maxRoster = Number(currentData.maxRoster || 10);
  if (players.length >= maxRoster) return toast(`Roster penuh. Max ${maxRoster} player.`, 'danger');
  const role = $('#playerRole').value, name = $('#playerName').value.trim(), id = $('#playerId').value.trim();
  if (role !== 'Cadangan' && players.some(p => p.role === role) && !confirm(`Role ${role} sudah ada. Tetap tambah?`)) return;
  players.push({ role, name, id });
  await database.ref(`teams/${currentKey}/players`).set(players);
  event.target.reset(); toast('Player ditambahkan.', 'success');
});
window.removePlayer = async function(teamKey, index) { if (!confirm('Remove player?')) return; const snap = await database.ref(`teams/${teamKey}/players`).once('value'); const players = snap.val() || []; players.splice(index, 1); await database.ref(`teams/${teamKey}/players`).set(players); toast('Player dihapus.', 'success'); };

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
    return `<button class="btn" onclick="openTeamJoinModal('${id}', ${Number(t.fee || 0)}, ${Number(t.playerPerTeam || 5)})">Join Team 5v5</button>`;
  }
  if (t.mode === 'brawl') return `<button class="btn brawl" onclick="openSoloJoinModal('${id}', ${Number(t.fee || 0)})">Join 1 vs 1 Brawl</button>`;
  return `<button class="btn muted" disabled>Mode tidak tersedia</button>`;
}

window.openTeamJoinModal = function(tid, fee, playerPerTeam) {
  if (currentType !== 'team') return toast('Mode 5v5 hanya untuk akun team.', 'danger');
  if (!currentData?.isApproved && !confirm('Team belum verified. Tetap lanjut daftar?')) return;
  const players = currentData.players || [];
  if (players.length < playerPerTeam) return toast(`Roster kurang. Tournament ini butuh ${playerPerTeam} player.`, 'danger');
  pendingRegistration = { tid, fee, mode: 'team', playerPerTeam };
  $('#teamJoinHint').textContent = `Pilih ${playerPerTeam} player utama untuk tournament ini.`;
  $('#teamJoinPlayers').innerHTML = players.map((p, i) => `<label class="check-row"><input type="checkbox" value="${i}"><span>${escapeHtml(p.name)} • ${escapeHtml(p.role)} • ID ${escapeHtml(p.id)}</span></label>`).join('');
  $('#team-join-modal').classList.remove('hidden');
};
window.confirmTeamRegistration = async function() {
  const checked = $$('#teamJoinPlayers input:checked').map(el => Number(el.value));
  if (checked.length !== pendingRegistration.playerPerTeam) return toast(`Pilih tepat ${pendingRegistration.playerPerTeam} player.`, 'danger');
  const selectedPlayers = checked.map(i => currentData.players[i]);
  const extra = { displayName: currentData.teamName, type: 'team', whatsapp: currentData.whatsapp || '', selectedPlayers };
  closeModal('team-join-modal');
  if (pendingRegistration.fee > 0) return openPaymentModal(pendingRegistration.tid, pendingRegistration.fee, extra);
  await completeRegistration(pendingRegistration.tid, 'approved', extra);
};
window.openSoloJoinModal = function(tid, fee) {
  pendingRegistration = { tid, fee, mode: 'brawl' };
  const players = currentType === 'team' ? (currentData.players || []) : [{ name: currentData.displayName || currentData.username, id: currentData.gameId || currentData.username, role: 'Solo Player' }];
  if (!players.length) return toast('Tambahkan roster dulu sebelum join 1 vs 1 Brawl.', 'danger');
  $('#brawlPlayer').innerHTML = players.map((p, i) => `<option value="${i}">${escapeHtml(p.name)} • ${escapeHtml(p.role)} • ID ${escapeHtml(p.id)}</option>`).join('');
  $('#brawl-modal').classList.remove('hidden');
};
window.confirmBrawlRegistration = async function() {
  const index = Number($('#brawlPlayer').value);
  const player = currentType === 'team' ? (currentData.players || [])[index] : { name: currentData.displayName || currentData.username, id: currentData.gameId || currentData.username, role: 'Solo Player' };
  if (!player || !pendingRegistration) return;
  const displayName = currentType === 'team' ? `${player.name} (${currentData.teamName})` : player.name;
  const extra = { displayName, playerName: player.name, gameId: player.id, role: player.role, type: currentType === 'team' ? 'brawl' : 'user', whatsapp: currentData.whatsapp || '' };
  closeModal('brawl-modal');
  if (pendingRegistration.fee > 0) return openPaymentModal(pendingRegistration.tid, pendingRegistration.fee, extra);
  await completeRegistration(pendingRegistration.tid, 'approved', extra);
};
window.openPaymentModal = function(tid, fee, extra = null) { pendingRegistration = { ...(pendingRegistration || {}), tid, fee, extra }; $('#payment-fee-display').textContent = formatRupiah(fee); $('#payment-modal').classList.remove('hidden'); };
window.confirmPayment = async function() { const { tid, extra } = pendingRegistration || {}; await completeRegistration(tid, 'pending_payment', extra || defaultParticipantExtra()); closeModal('payment-modal'); toast('Status pending payment. Tunggu approval admin.', 'success'); };
function defaultParticipantExtra(){ return currentType === 'team' ? { displayName: currentData.teamName, type:'team', whatsapp: currentData.whatsapp || '' } : { displayName: currentData.displayName || currentData.username, type:'user', whatsapp: currentData.whatsapp || '' }; }
async function completeRegistration(tid, status, extra) { const snap = await database.ref(`tournaments/${tid}`).once('value'); const t = snap.val(); if (!visibleTournament(t)) throw new Error('Tipe akun tidak sesuai dengan tournament ini.'); const count = t.participants ? Object.keys(t.participants).length : 0; if (count >= Number(t.maxTeams || 0)) throw new Error('Slot penuh.'); await database.ref(`tournaments/${tid}/participants/${currentKey}`).set({ accountKey: currentKey, teamKey: currentType === 'team' ? currentKey : '', teamName: currentData.teamName || '', status, registeredAt: firebase.database.ServerValue.TIMESTAMP, ...extra }); toast('Berhasil daftar tournament.', 'success'); }

window.viewRules = async function(id) { const snap = await database.ref(`tournaments/${id}`).once('value'); $('#rules-content').textContent = snap.val()?.rules || 'Rules belum diisi.'; $('#rules-modal').classList.remove('hidden'); };
window.closeModal = function(id) { $(`#${id}`).classList.add('hidden'); };
window.showBracketView = async function(tournamentId) { activeBracketId = tournamentId; window.showSection('bracket', $$('.nav-btn')[2]); const snap = await database.ref(`tournaments/${tournamentId}`).once('value'); renderSingleBracket(snap.val()); };
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

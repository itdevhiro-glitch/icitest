import { auth, database, ADMIN_UID } from '../core/firebase.js';
import { $, $$, escapeHtml, formatRupiah, modeLabel, roleClass, toast, getRoundKeys, normalizeWhatsApp } from '../core/utils.js';
import { getAccountByUID } from '../core/team-service.js';

let currentKey = null;
let currentData = null;
let currentType = 'team';
let activeBracketId = null;
let pendingRegistration = null;
const refs = [];

const sections = { dashboard: $('#dashboard-section'), leaderboard: $('#leaderboard-section'), bracket: $('#bracket-section') };
function listen(path, callback) { const ref = database.ref(path); ref.on('value', callback); refs.push(ref); }
function cleanupListeners() { refs.splice(0).forEach(ref => ref.off()); }

window.showSection = function(sectionId, btn) {
  Object.values(sections).forEach(section => section.classList.add('hidden'));
  sections[sectionId]?.classList.remove('hidden');
  $$('.nav-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
};
window.handleLogout = async function() { cleanupListeners(); await auth.signOut(); window.location.href = 'login.html'; };

auth.onAuthStateChanged(async user => {
  if (!user) return (window.location.href = 'login.html');
  if (user.uid === ADMIN_UID) return (window.location.href = 'admin.html');
  const result = await getAccountByUID(user.uid);
  if (!result) { toast('Data akun tidak ditemukan.', 'danger'); await auth.signOut(); return (window.location.href = 'login.html'); }
  currentKey = result.key; currentType = result.type; initDashboard();
});

function initDashboard() {
  $('#main-nav').innerHTML = `
    <button class="nav-btn active" onclick="showSection('dashboard', this)"><i class="ri-dashboard-line"></i><span>Dashboard</span></button>
    <button class="nav-btn" onclick="showSection('leaderboard', this)"><i class="ri-trophy-line"></i><span>Leaderboard</span></button>
    <button class="nav-btn" onclick="showSection('bracket', this)"><i class="ri-organization-chart"></i><span>Brackets</span></button>
    <button class="nav-btn logout" onclick="handleLogout()"><i class="ri-logout-box-line"></i><span>Logout</span></button>`;
  const accountPath = currentType === 'team' ? `teams/${currentKey}` : `users/${currentKey}`;
  listen(accountPath, snap => { currentData = snap.val(); renderDashboard(); });
  listen('tournaments', snap => { const t = snap.val() || {}; renderTournaments(t); renderBracketView(t); });
  listen('teams', snap => renderLeaderboard(snap.val() || {}));
}

function renderDashboard() {
  const title = currentType === 'team' ? currentData?.teamName : currentData?.displayName;
  $('#team-name').textContent = title || '-';
  $('#team-status').textContent = currentType === 'team' ? (currentData?.isBanned ? 'BANNED' : currentData?.isApproved ? 'VERIFIED TEAM' : 'WAITING APPROVAL') : 'SOLO USER';
  $('#team-status').className = `status-pill ${currentData?.isApproved || currentType === 'user' ? 'success' : 'muted'}`;

  if (currentType === 'user') {
    $('#roster-count').textContent = 'Solo';
    $('#roster-list').innerHTML = `<article class="player-card"><span class="role-badge role-sub">USER</span><div class="player-main"><strong>${escapeHtml(currentData?.displayName || currentData?.username)}</strong><small>WA: ${escapeHtml(currentData?.whatsapp || '-')}</small></div></article><div class="empty-state">Akun user hanya bisa ikut tournament Solo / 1v1 Brawl. Mode Team 5v5 sengaja disembunyikan.</div>`;
    $('#add-player-form').classList.add('hidden');
    return;
  }

  const maxRoster = Number(currentData?.maxRoster || 10);
  const players = [...(currentData?.players || [])].sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
  $('#roster-count').textContent = `${players.length}/${maxRoster}`;
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
  if (currentType === 'user') return t.mode === 'brawl' || t.mode === 'solo';
  return t.mode !== 'solo';
}
function renderTournaments(tournaments) {
  const grid = $('#tournament-grid');
  const rows = Object.entries(tournaments).filter(([,t]) => visibleTournament(t)).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
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
  if (t.mode === 'team') return `<button class="btn" onclick="openTeamJoinModal('${id}', ${Number(t.fee || 0)}, ${Number(t.playerPerTeam || 5)})">Join Team 5v5</button>`;
  return `<button class="btn brawl" onclick="openSoloJoinModal('${id}', ${Number(t.fee || 0)})">Join ${modeLabel(t.mode)}</button>`;
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
  pendingRegistration = { tid, fee, mode: currentType === 'team' ? 'brawl' : 'user' };
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
function renderSingleBracket(t) { const host = $('#tournament-bracket-view'); if (!t?.bracket) return (host.innerHTML = '<div class="empty-state">Bracket belum dibuat admin.</div>'); host.innerHTML = `<div class="bracket-heading"><div><h2>${escapeHtml(t.name)}</h2><span>${modeLabel(t.mode)} • ${escapeHtml(t.status)}</span></div></div><div class="bracket-scroll">${getRoundKeys(t.bracket).map(roundKey => `<section class="round-column"><h3>${roundKey === 'bronze' ? 'Bronze Match' : roundKey.toUpperCase()}</h3>${t.bracket[roundKey].map(m => `<article class="match-card ${m.completed ? 'done' : ''}"><div class="match-meta"><span>${escapeHtml(m.id)}</span><b>BO${m.format || 1}</b></div><div class="match-team ${m.winner === m.teamA ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamA))}</span><strong>${m.scoreA || 0}</strong></div><div class="match-team ${m.winner === m.teamB ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamB))}</span><strong>${m.scoreB || 0}</strong></div></article>`).join('')}</section>`).join('')}</div>`; }
function renderLeaderboard(teams) { const tbody = $('#leaderboard-body'); const rows = Object.values(teams).map(t => { const s = t.stats || {}; const free = (s.ch1||0)*5+(s.ch2||0)*3+(s.ch3||0); const paid=(s.paidCh1||0)*7+(s.paidCh2||0)*4+(s.paidCh3||0)*2; const brawl=(s.brawlCh1||0)*4+(s.brawlCh2||0)*2+(s.brawlCh3||0); return { name:t.teamName, username:t.username, free, paid, brawl, total: free+paid+brawl }; }).sort((a,b)=>b.total-a.total); tbody.innerHTML = rows.map((r,i)=>`<tr><td>#${i+1}</td><td><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.username)}</small></td><td>${r.free}</td><td>${r.paid}</td><td>${r.brawl}</td><td><b>${r.total}</b></td></tr>`).join('') || '<tr><td colspan="6">No leaderboard data.</td></tr>'; }

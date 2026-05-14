import { auth, database, ADMIN_UID } from '../core/firebase.js';
import { $, $$, escapeHtml, formatRupiah, modeLabel, roleClass, toast } from '../core/utils.js';
import { getTeamDataByUID } from '../core/team-service.js';
import { getRoundKeys } from '../core/utils.js';

let currentTeamKey = null;
let currentTeamData = null;
let activeBracketId = null;
let currentBrawlRegistration = null;
const refs = [];

const sections = {
  dashboard: $('#dashboard-section'),
  leaderboard: $('#leaderboard-section'),
  bracket: $('#bracket-section')
};

function listen(path, callback) {
  const ref = database.ref(path);
  ref.on('value', callback);
  refs.push(ref);
}

function cleanupListeners() {
  refs.splice(0).forEach(ref => ref.off());
}

window.showSection = function(sectionId, btn) {
  Object.values(sections).forEach(section => section.classList.add('hidden'));
  sections[sectionId]?.classList.remove('hidden');
  $$('.nav-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
};

window.handleLogout = async function() {
  cleanupListeners();
  await auth.signOut();
  window.location.href = 'login.html';
};

auth.onAuthStateChanged(async user => {
  if (!user) return (window.location.href = 'login.html');
  if (user.uid === ADMIN_UID) return (window.location.href = 'admin.html');

  const result = await getTeamDataByUID(user.uid);
  if (!result) {
    toast('Team data tidak ditemukan.', 'danger');
    await auth.signOut();
    return (window.location.href = 'login.html');
  }
  currentTeamKey = result.key;
  initDashboard(currentTeamKey);
});

function initDashboard(teamKey) {
  $('#main-nav').innerHTML = `
    <button class="nav-btn active" onclick="showSection('dashboard', this)"><i class="ri-dashboard-line"></i><span>Dashboard</span></button>
    <button class="nav-btn" onclick="showSection('leaderboard', this)"><i class="ri-trophy-line"></i><span>Leaderboard</span></button>
    <button class="nav-btn" onclick="showSection('bracket', this)"><i class="ri-organization-chart"></i><span>Brackets</span></button>
    <button class="nav-btn logout" onclick="handleLogout()"><i class="ri-logout-box-line"></i><span>Logout</span></button>
  `;

  listen(`teams/${teamKey}`, snap => {
    currentTeamData = snap.val();
    renderDashboard(teamKey, currentTeamData);
  });
  listen('tournaments', snap => {
    const tournaments = snap.val() || {};
    renderTournaments(teamKey, tournaments);
    renderBracketView(tournaments);
  });
  listen('teams', snap => renderLeaderboard(snap.val() || {}));
}

function renderDashboard(teamKey, teamData = {}) {
  const players = [...(teamData.players || [])].sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
  $('#team-name').textContent = teamData.teamName || '-';
  $('#team-status').textContent = teamData.isBanned ? 'BANNED' : teamData.isApproved ? 'VERIFIED TEAM' : 'WAITING APPROVAL';
  $('#team-status').className = `status-pill ${teamData.isApproved ? 'success' : 'muted'}`;
  $('#roster-count').textContent = `${players.length}/10`;

  $('#roster-list').innerHTML = players.length ? players.map((player, index) => `
    <article class="player-card">
      <span class="role-badge role-${roleClass(player.role)}">${escapeHtml(player.role)}</span>
      <div class="player-main"><strong>${escapeHtml(player.name)}</strong><small>ID: ${escapeHtml(player.id)}</small></div>
      <button class="icon-btn danger" onclick="removePlayer('${teamKey}', ${index})" title="Remove"><i class="ri-delete-bin-line"></i></button>
    </article>
  `).join('') : `<div class="empty-state">Belum ada roster. Tambahkan player dulu.</div>`;

  $('#add-player-form').classList.toggle('hidden', players.length >= 10);
}

function roleWeight(role) {
  return { Jungler: 1, Roamer: 2, MidLane: 3, ExpLane: 4, GoldLane: 5, Cadangan: 6 }[role] || 99;
}

$('#add-player-form').addEventListener('submit', async event => {
  event.preventDefault();
  const players = [...(currentTeamData.players || [])];
  const role = $('#playerRole').value;
  const name = $('#playerName').value.trim();
  const id = $('#playerId').value.trim();
  if (role !== 'Cadangan' && players.some(p => p.role === role) && !confirm(`Role ${role} sudah ada. Tetap tambah?`)) return;
  players.push({ role, name, id });
  await database.ref(`teams/${currentTeamKey}/players`).set(players);
  event.target.reset();
  toast('Player ditambahkan.', 'success');
});

window.removePlayer = async function(teamKey, index) {
  if (!confirm('Remove player?')) return;
  const snap = await database.ref(`teams/${teamKey}/players`).once('value');
  const players = snap.val() || [];
  players.splice(index, 1);
  await database.ref(`teams/${teamKey}/players`).set(players);
  toast('Player dihapus.', 'success');
};

function renderTournaments(teamKey, tournaments) {
  const grid = $('#tournament-grid');
  const rows = Object.entries(tournaments).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  if (!rows.length) return (grid.innerHTML = '<div class="empty-state">Belum ada tournament aktif.</div>');

  grid.innerHTML = rows.map(([id, t]) => {
    const participant = t.participants?.[teamKey];
    const count = t.participants ? Object.keys(t.participants).length : 0;
    const status = participant?.status || '';
    const action = renderTournamentAction(id, t, participant, status);
    return `
      <article class="tournament-card ${t.fee > 0 ? 'premium-border' : ''}">
        <div class="t-card-top">
          <span class="badge">${escapeHtml(t.status || 'registration')}</span>
          <span class="badge ${t.mode === 'brawl' ? 'brawl' : ''}">${modeLabel(t.mode)}</span>
        </div>
        <div class="t-card-body">
          <h3>${escapeHtml(t.name)}</h3>
          <p>${escapeHtml(t.startDate || '-')} • Slots ${count}/${t.maxTeams || 0}</p>
          <div class="money-box">${t.fee > 0 ? `<b>${formatRupiah(t.fee)}</b><small>Prize ${formatRupiah(t.prize)}</small>` : '<b class="success-text">FREE ENTRY</b><small>No fee</small>'}</div>
          <div class="button-grid">${action}<button class="btn ghost" onclick="viewRules('${id}')">Rules</button></div>
        </div>
      </article>`;
  }).join('');
}

function renderTournamentAction(id, t, participant, status) {
  if (participant) {
    if (status === 'pending_payment') return `<button class="btn warning" onclick="openPaymentModal('${id}', ${Number(t.fee || 0)})">Pay Now</button>`;
    if (t.status === 'ongoing') return `<button class="btn" onclick="showBracketView('${id}')">View Bracket</button>`;
    return `<button class="btn muted" disabled>Registered</button>`;
  }
  if (t.status !== 'registration') return `<button class="btn muted" disabled>Closed</button>`;
  if (t.mode === 'brawl') return `<button class="btn brawl" onclick="openBrawlJoinModal('${id}', ${Number(t.fee || 0)})">Join Brawl</button>`;
  return `<button class="btn" onclick="initiateTeamRegistration('${id}', ${Number(t.fee || 0)})">Join Team</button>`;
}

window.initiateTeamRegistration = async function(tid, fee) {
  if (!currentTeamData?.isApproved && !confirm('Team belum verified. Tetap lanjut daftar?')) return;
  if (fee > 0) return openPaymentModal(tid, fee);
  await completeRegistration(tid, 'approved', { displayName: currentTeamData.teamName, type: 'team' });
};

window.openBrawlJoinModal = function(tid, fee) {
  currentBrawlRegistration = { tid, fee };
  const players = currentTeamData.players || [];
  if (!players.length) return toast('Tambahkan roster dulu sebelum join 1 vs 1 Brawl.', 'danger');
  $('#brawlPlayer').innerHTML = players.map((p, i) => `<option value="${i}">${escapeHtml(p.name)} • ${escapeHtml(p.role)} • ID ${escapeHtml(p.id)}</option>`).join('');
  $('#brawl-modal').classList.remove('hidden');
};

window.confirmBrawlRegistration = async function() {
  const index = Number($('#brawlPlayer').value);
  const player = (currentTeamData.players || [])[index];
  if (!player || !currentBrawlRegistration) return;
  const extra = { displayName: `${player.name} (${currentTeamData.teamName})`, playerName: player.name, gameId: player.id, role: player.role, type: 'brawl' };
  closeModal('brawl-modal');
  if (currentBrawlRegistration.fee > 0) return openPaymentModal(currentBrawlRegistration.tid, currentBrawlRegistration.fee, extra);
  await completeRegistration(currentBrawlRegistration.tid, 'approved', extra);
};

window.openPaymentModal = function(tid, fee, extra = null) {
  currentBrawlRegistration = { tid, fee, extra };
  $('#payment-fee-display').textContent = formatRupiah(fee);
  $('#payment-modal').classList.remove('hidden');
};

window.confirmPayment = async function() {
  const { tid, extra } = currentBrawlRegistration || {};
  await completeRegistration(tid, 'pending_payment', extra || { displayName: currentTeamData.teamName, type: 'team' });
  closeModal('payment-modal');
  toast('Status pending payment. Tunggu approval admin.', 'success');
};

async function completeRegistration(tid, status, extra) {
  const snap = await database.ref(`tournaments/${tid}`).once('value');
  const t = snap.val();
  const count = t.participants ? Object.keys(t.participants).length : 0;
  if (count >= Number(t.maxTeams || 0)) throw new Error('Slot penuh.');
  await database.ref(`tournaments/${tid}/participants/${currentTeamKey}`).set({
    teamKey: currentTeamKey,
    teamName: currentTeamData.teamName,
    status,
    registeredAt: firebase.database.ServerValue.TIMESTAMP,
    ...extra
  });
  toast('Berhasil daftar tournament.', 'success');
}

window.viewRules = async function(id) {
  const snap = await database.ref(`tournaments/${id}`).once('value');
  $('#rules-content').textContent = snap.val()?.rules || 'Rules belum diisi.';
  $('#rules-modal').classList.remove('hidden');
};

window.closeModal = function(id) { $(`#${id}`).classList.add('hidden'); };

window.showBracketView = async function(tournamentId) {
  activeBracketId = tournamentId;
  window.showSection('bracket');
  const snap = await database.ref('tournaments').once('value');
  renderBracketView(snap.val() || {});
};

function renderBracketView(tournaments) {
  if (!activeBracketId || !tournaments[activeBracketId]) return;
  const t = tournaments[activeBracketId];
  const view = $('#tournament-bracket-view');
  if (!t.bracket) return (view.innerHTML = '<div class="empty-state">Bracket belum dibuat admin.</div>');
  view.innerHTML = `<div class="bracket-heading"><h2>${escapeHtml(t.name)}</h2><span>${modeLabel(t.mode)}</span></div><div class="bracket-scroll">${getRoundKeys(t.bracket).map(key => renderRound(t, key)).join('')}</div>`;
}

function renderRound(t, roundKey) {
  const title = roundKey === 'bronze' ? 'Bronze Match' : (t.bracket[roundKey].length === 1 && roundKey !== 'r1' ? 'Grand Final' : roundKey.toUpperCase());
  return `<section class="round-column"><h3>${title}</h3>${t.bracket[roundKey].map(match => renderMatch(t, match)).join('')}</section>`;
}

function participantName(t, id) {
  return t.participants?.[id]?.displayName || t.participants?.[id]?.teamName || id || 'TBD';
}

function renderMatch(t, m) {
  const aName = participantName(t, m.teamA);
  const bName = participantName(t, m.teamB);
  return `<article class="match-card ${m.completed ? 'done' : ''}">
    <div class="match-meta"><span>${escapeHtml(m.id)}</span><b>BO${m.format || 1}</b></div>
    <div class="match-team ${m.winner === m.teamA ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(aName)}</span><strong>${m.scoreA || 0}</strong></div>
    <div class="match-team ${m.winner === m.teamB ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(bName)}</span><strong>${m.scoreB || 0}</strong></div>
  </article>`;
}

function renderLeaderboard(teams) {
  const list = Object.values(teams).map(team => {
    const s = team.stats || {};
    const free = (s.ch1 || 0) * 3 + (s.ch2 || 0) * 2 + (s.ch3 || 0);
    const paid = (s.paidCh1 || 0) * 6 + (s.paidCh2 || 0) * 4 + (s.paidCh3 || 0) * 2;
    const brawl = (s.brawlCh1 || 0) * 4 + (s.brawlCh2 || 0) * 2 + (s.brawlCh3 || 0);
    return { ...team, s, total: free + paid + brawl };
  }).sort((a, b) => b.total - a.total);
  $('#leaderboard-body').innerHTML = list.map((t, i) => `<tr class="rank-${i + 1}"><td>#${i + 1}</td><td><b>${escapeHtml(t.teamName)}</b><small>${escapeHtml(t.username)}</small></td><td>${t.s.ch1 || 0}/${t.s.ch2 || 0}/${t.s.ch3 || 0}</td><td>${t.s.paidCh1 || 0}/${t.s.paidCh2 || 0}/${t.s.paidCh3 || 0}</td><td>${t.s.brawlCh1 || 0}/${t.s.brawlCh2 || 0}/${t.s.brawlCh3 || 0}</td><td><b>${t.total} PTS</b></td></tr>`).join('') || '<tr><td colspan="6">No team data.</td></tr>';
}

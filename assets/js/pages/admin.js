import { auth, database, ADMIN_UID, serverTimestamp } from '../core/firebase.js';
import { $, $$, escapeHtml, formatRupiah, getRoundKeys, modeLabel, toast } from '../core/utils.js';
import { createSingleEliminationBracket, findMatchLocation } from '../core/bracket.js';

let activeTournamentId = null;
let activeTournament = null;
let editingMatch = null;
const refs = [];

function listen(path, callback) {
  const ref = database.ref(path);
  ref.on('value', callback);
  refs.push(ref);
}

function cleanup() { refs.splice(0).forEach(ref => ref.off()); }

window.showSection = function(section) {
  ['admin-dashboard-section', 'admin-teams-section', 'tournament-control-section'].forEach(id => $(`#${id}`).classList.add('hidden'));
  $(`#admin-${section}-section`)?.classList.remove('hidden');
  if (section === 'control') $('#tournament-control-section').classList.remove('hidden');
  $$('.nav-btn').forEach(btn => btn.classList.remove('active'));
};

window.handleLogout = async function() {
  cleanup();
  await auth.signOut();
  window.location.href = 'login.html';
};

auth.onAuthStateChanged(user => {
  if (!user) return (window.location.href = 'login.html');
  if (user.uid !== ADMIN_UID) {
    alert('ACCESS DENIED');
    return (window.location.href = 'dashboard.html');
  }
  listen('tournaments', snap => renderTournamentList(snap.val() || {}));
  listen('teams', snap => renderTeamStats(snap.val() || {}));
});

$('#create-tournament-form').addEventListener('submit', async event => {
  event.preventDefault();
  const mode = $('#tourMode').value;
  const maxTeams = Number($('#tourMax').value);
  const payload = {
    name: $('#tourName').value.trim(),
    mode,
    maxTeams,
    format: mode === 'brawl' ? 1 : Number($('#tourFormat').value),
    fee: Number($('#tourFee').value || 0),
    prize: Number($('#tourPrize').value || 0),
    rules: $('#tourRules').value.trim(),
    startDate: $('#tourDate').value,
    status: 'registration',
    createdAt: serverTimestamp
  };
  if (!payload.name || maxTeams < 2) return toast('Nama dan slot minimal 2 wajib diisi.', 'danger');
  await database.ref('tournaments').push().set(payload);
  event.target.reset();
  $('#tourFormat').disabled = false;
  toast('Tournament berhasil dibuat.', 'success');
});

$('#tourMode').addEventListener('change', () => {
  const isBrawl = $('#tourMode').value === 'brawl';
  $('#tourFormat').value = '1';
  $('#tourFormat').disabled = isBrawl;
});

function renderTournamentList(tournaments) {
  const container = $('#tournament-list-container');
  const rows = Object.entries(tournaments).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  if (!rows.length) return (container.innerHTML = '<div class="empty-state">Belum ada tournament.</div>');
  container.innerHTML = rows.map(([id, t]) => {
    const count = t.participants ? Object.keys(t.participants).length : 0;
    return `<article class="mini-tournament ${t.mode === 'brawl' ? 'brawl-border' : ''}">
      <div><h3>${escapeHtml(t.name)}</h3><p>${modeLabel(t.mode)} • ${escapeHtml(t.status)} • ${count}/${t.maxTeams}</p></div>
      <div class="row-actions"><button class="btn small" onclick="openTournamentControl('${id}')">Manage</button><button class="btn small danger" onclick="deleteTournament('${id}')">Del</button></div>
    </article>`;
  }).join('');
}

function renderTeamStats(teams) {
  const container = $('#team-stats-list');
  const list = Object.values(teams).sort((a, b) => String(a.teamName).localeCompare(String(b.teamName)));
  container.innerHTML = list.map(t => {
    const s = t.stats || {};
    return `<article class="stat-card"><h3>${escapeHtml(t.teamName)}</h3><small>${escapeHtml(t.username)}</small>
      ${statGroup(t.username, 'Free', [['ch1','1st'],['ch2','2nd'],['ch3','3rd']], s)}
      ${statGroup(t.username, 'Paid', [['paidCh1','1st'],['paidCh2','2nd'],['paidCh3','3rd']], s)}
      ${statGroup(t.username, '1v1 Brawl', [['brawlCh1','1st'],['brawlCh2','2nd'],['brawlCh3','3rd']], s)}
    </article>`;
  }).join('') || '<div class="empty-state">No teams.</div>';
}

function statGroup(username, label, fields, stats) {
  return `<div class="stat-group"><span>${label}</span><div class="stat-inputs">${fields.map(([key, title]) => `<label>${title}<input type="number" value="${Number(stats[key] || 0)}" onchange="updateStat('${username}','${key}',this.value)"></label>`).join('')}</div></div>`;
}

window.updateStat = async (username, type, val) => database.ref(`teams/${username}/stats/${type}`).set(Number(val || 0));
window.deleteTournament = async id => { if (confirm('Delete tournament permanently?')) await database.ref(`tournaments/${id}`).remove(); };

window.openTournamentControl = function(id) {
  activeTournamentId = id;
  $('#admin-dashboard-section').classList.add('hidden');
  $('#admin-teams-section').classList.add('hidden');
  $('#tournament-control-section').classList.remove('hidden');
  database.ref(`tournaments/${id}`).off();
  database.ref(`tournaments/${id}`).on('value', snap => {
    const t = snap.val();
    if (!t) return window.showSection('dashboard');
    activeTournament = t;
    $('#control-title').textContent = t.name;
    $('#format-display').textContent = `${modeLabel(t.mode)} • ${t.mode === 'brawl' ? 'Single Match' : 'Mixed BO System'}`;
    $('#fee-display').textContent = t.fee > 0 ? `${formatRupiah(t.fee)} • Prize ${formatRupiah(t.prize)}` : 'Free Entry';
    renderActions(t);
    renderParticipants(t);
    renderAdminBracket(t);
  });
};

function renderActions(t) {
  const actions = $('#admin-actions');
  if (t.status === 'registration') actions.innerHTML = `<button class="btn success" onclick="generateBracket()">Randomize Bracket & Start</button>`;
  else if (t.status === 'ongoing') actions.innerHTML = `<button class="btn" onclick="finishTournament()">End Tournament</button><button class="btn danger" onclick="resetBracket()">Reset Bracket</button>`;
  else actions.innerHTML = `<div class="empty-state success-text">Tournament Finished</div><button class="btn" onclick="resetBracket()">Re-open Registration</button>`;
}

function renderParticipants(t) {
  const list = $('#participant-list');
  const rows = Object.entries(t.participants || {});
  if (!rows.length) return (list.innerHTML = '<li class="empty-state">No participants</li>');
  list.innerHTML = rows.map(([key, p]) => `<li class="participant-row"><div><strong>${escapeHtml(p.displayName || p.teamName || key)}</strong><small>${escapeHtml(p.type || t.mode || 'team')} • ${escapeHtml(p.status || 'approved')}</small></div><div>${p.status === 'pending_payment' ? `<button class="btn small success" onclick="approvePayment('${key}')">Approve</button>` : ''}<button class="btn small danger" onclick="kickTeam('${key}')">Kick</button></div></li>`).join('');
}

window.approvePayment = async key => {
  await database.ref(`tournaments/${activeTournamentId}/participants/${key}/status`).set('approved');
  toast('Payment approved.', 'success');
};
window.kickTeam = async key => { if (confirm('Kick participant?')) await database.ref(`tournaments/${activeTournamentId}/participants/${key}`).remove(); };

window.generateBracket = async function() {
  const t = activeTournament;
  const approved = Object.entries(t.participants || {}).filter(([, p]) => t.fee > 0 ? p.status === 'approved' : true).map(([key]) => key);
  if (approved.length < 2) return toast('Minimal 2 approved participants.', 'danger');
  const bracket = createSingleEliminationBracket(approved, t.mode || 'team');
  await database.ref(`tournaments/${activeTournamentId}`).update({ bracket, status: 'ongoing' });
  toast('Bracket dibuat dan tournament dimulai.', 'success');
};

function renderAdminBracket(t) {
  const container = $('#admin-bracket-view');
  if (!t.bracket) return (container.innerHTML = '<div class="empty-state">Bracket not created.</div>');
  container.innerHTML = `<div class="bracket-scroll">${getRoundKeys(t.bracket).map(key => renderRound(t, key)).join('')}</div>`;
}

function renderRound(t, roundKey) {
  const title = roundKey === 'bronze' ? 'Bronze Match' : (t.bracket[roundKey].length === 1 && roundKey !== 'r1' ? 'Grand Final' : roundKey.toUpperCase());
  return `<section class="round-column"><h3>${title}</h3>${t.bracket[roundKey].map((m, i) => renderMatch(t, roundKey, i, m)).join('')}</section>`;
}

function participantName(t, id) {
  return t.participants?.[id]?.displayName || t.participants?.[id]?.teamName || id || 'TBD';
}

function renderMatch(t, roundKey, index, m) {
  return `<article class="match-card admin-match ${m.completed ? 'done' : ''}" onclick="openScoreModal('${roundKey}', ${index})">
    <div class="match-meta"><span>${escapeHtml(m.id)}</span><b>BO${m.format || 1}</b></div>
    <div class="match-team ${m.winner === m.teamA ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamA))}</span><strong>${m.scoreA || 0}</strong></div>
    <div class="match-team ${m.winner === m.teamB ? 'winner' : m.winner ? 'loser' : ''}"><span>${escapeHtml(participantName(t, m.teamB))}</span><strong>${m.scoreB || 0}</strong></div>
  </article>`;
}

window.openScoreModal = function(roundKey, index) {
  const m = activeTournament.bracket?.[roundKey]?.[index];
  if (!m?.teamA || !m?.teamB) return toast('Match belum siap.', 'danger');
  if (m.completed && !confirm('Match sudah DONE. Edit lagi?')) return;
  editingMatch = { roundKey, index };
  $('#score-modal-match-info').textContent = `${roundKey.toUpperCase()} • ${m.id}`;
  $('#score-team-a-name').textContent = participantName(activeTournament, m.teamA);
  $('#score-team-b-name').textContent = participantName(activeTournament, m.teamB);
  $('#input-score-a').value = m.scoreA || 0;
  $('#input-score-b').value = m.scoreB || 0;
  $('#modalMatchFormat').value = m.format || 1;
  $('#score-modal').classList.remove('hidden');
};

window.closeScoreModal = function() { $('#score-modal').classList.add('hidden'); editingMatch = null; };

window.saveMatchScore = async function(markDone) {
  if (!editingMatch) return;
  const { roundKey, index } = editingMatch;
  const match = activeTournament.bracket[roundKey][index];
  const sA = Number($('#input-score-a').value || 0);
  const sB = Number($('#input-score-b').value || 0);
  const fmt = Number($('#modalMatchFormat').value || 1);
  let winner = null, loser = null;
  if (sA > sB) [winner, loser] = [match.teamA, match.teamB];
  else if (sB > sA) [winner, loser] = [match.teamB, match.teamA];
  else if (markDone) return toast('Score draw tidak bisa diselesaikan.', 'danger');

  const base = `tournaments/${activeTournamentId}/bracket/${roundKey}/${index}`;
  const updates = { [`${base}/scoreA`]: sA, [`${base}/scoreB`]: sB, [`${base}/format`]: fmt };
  if (markDone) Object.assign(updates, { [`${base}/completed`]: true, [`${base}/winner`]: winner });
  await database.ref().update(updates);
  if (markDone) await advanceWinner(roundKey, index, winner, loser);
  window.closeScoreModal();
};

async function advanceWinner(roundKey, index, winner, loser) {
  const snap = await database.ref(`tournaments/${activeTournamentId}/bracket`).once('value');
  const bracket = snap.val();
  const match = bracket[roundKey][index];
  if (match.nextMatchId) await setTeamToMatch(bracket, match.nextMatchId, winner);
  else if (roundKey !== 'bronze') {
    await addLeaderboardPoint(winner, 1);
    await addLeaderboardPoint(loser, 2);
    toast(`Winner: ${participantName(activeTournament, winner)}`, 'success');
  } else {
    await addLeaderboardPoint(winner, 3);
    toast(`3rd Place: ${participantName(activeTournament, winner)}`, 'success');
  }
  if (match.bronzeMatchId) await setTeamToMatch(bracket, match.bronzeMatchId, loser);
}

async function setTeamToMatch(bracket, matchId, teamKey) {
  const loc = findMatchLocation(bracket, matchId);
  if (!loc) return;
  const target = bracket[loc.roundKey][loc.index];
  const field = target.teamA ? 'teamB' : 'teamA';
  await database.ref(`tournaments/${activeTournamentId}/bracket/${loc.roundKey}/${loc.index}/${field}`).set(teamKey);
}

async function addLeaderboardPoint(teamKey, rank) {
  if (!teamKey) return;
  const mode = activeTournament.mode === 'brawl' ? 'brawl' : activeTournament.fee > 0 ? 'paid' : 'free';
  const fieldMap = { free: ['ch1','ch2','ch3'], paid: ['paidCh1','paidCh2','paidCh3'], brawl: ['brawlCh1','brawlCh2','brawlCh3'] };
  const field = fieldMap[mode][rank - 1];
  const snap = await database.ref(`teams/${teamKey}/stats/${field}`).once('value');
  await database.ref(`teams/${teamKey}/stats/${field}`).set(Number(snap.val() || 0) + 1);
}

window.resetBracket = async () => { if (confirm('Reset bracket?')) await database.ref(`tournaments/${activeTournamentId}`).update({ bracket: null, status: 'registration' }); };
window.finishTournament = async () => { if (confirm('End Tournament?')) await database.ref(`tournaments/${activeTournamentId}`).update({ status: 'completed' }); };

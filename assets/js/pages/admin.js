import { auth, database, ADMIN_UID, serverTimestamp } from '../core/firebase.js';
import { $, $$, escapeHtml, formatRupiah, getRoundKeys, modeLabel, toast } from '../core/utils.js';
import { createSingleEliminationBracket, findMatchLocation } from '../core/bracket.js';

let activeTournamentId = null;
let activeTournament = null;
let editingMatch = null;
let cachedTeams = {};
let cachedForms = {};
let cachedPaymentMethods = {};
let draftFormFields = [];
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
function normalizeLineupMax(value) {
  const raw = Number(value);
  const max = Number.isFinite(raw) && raw > 0 ? raw : TEAM_MIN_PLAYERS;
  return Math.max(TEAM_MIN_PLAYERS, Math.min(TEAM_MAX_PLAYERS, max));
}
function validLineupCount(count, maxPlayers) { return count >= TEAM_MIN_PLAYERS && count <= normalizeLineupMax(maxPlayers); }
function listen(path, callback) { const ref = database.ref(path); ref.on('value', callback); refs.push(ref); }
function cleanup() { refs.splice(0).forEach(ref => ref.off()); }
window.showSection = function(section) {
  ['admin-dashboard-section','admin-forms-section','admin-teams-section','admin-payments-section','tournament-control-section'].forEach(id => $(`#${id}`).classList.add('hidden'));
  if (section === 'control') $('#tournament-control-section').classList.remove('hidden');
  else $(`#admin-${section}-section`)?.classList.remove('hidden');
  if(section === 'teams') renderTeamStats(cachedTeams);
  if(section === 'forms') renderFormsList(cachedForms);
  if(section === 'payments') renderPaymentMethods(cachedPaymentMethods);
};
window.handleLogout = async function(){ cleanup(); await auth.signOut(); window.smoothNavigate ? window.smoothNavigate('login.html') : (window.location.href='login.html'); };
window.copyWA = async function(value=''){
  if(!value) return toast('Nomor WA kosong.','danger');
  try{ await navigator.clipboard.writeText(value); toast(`Nomor WA ${value} dicopy.`, 'success'); }
  catch{ prompt('Copy nomor WhatsApp ini:', value); }
};
function waButtons(wa=''){
  return wa ? `<button class="btn small ghost" onclick="copyWA('${wa}')"><i class="ri-file-copy-line"></i> Copy WA</button><a class="btn small success" target="_blank" href="https://wa.me/${wa}"><i class="ri-whatsapp-line"></i> Chat</a>` : '';
}

auth.onAuthStateChanged(user => {
  if (!user) return (window.smoothNavigate ? window.smoothNavigate('login.html') : (window.location.href='login.html'));
  if (user.uid !== ADMIN_UID) { alert('ACCESS DENIED'); return (window.smoothNavigate ? window.smoothNavigate('dashboard.html') : (window.location.href='dashboard.html')); }
  listen('tournaments', snap => scheduleRender('tournaments', snap.val() || {}));
  listen('teams', snap => { cachedTeams = snap.val() || {}; scheduleRender('teams', cachedTeams); });
  listen('publicForms', snap => { cachedForms = snap.val() || {}; scheduleRender('forms', cachedForms); });
  ensureDefaultPaymentMethods();
  listen('paymentMethods', snap => { cachedPaymentMethods = snap.val() || {}; scheduleRender('payments', cachedPaymentMethods); });
});

const renderQueue = {};
function isVisible(id){ return !$(`#${id}`)?.classList.contains('hidden'); }
function scheduleRender(type, data){
  cancelAnimationFrame(renderQueue[type]);
  renderQueue[type] = requestAnimationFrame(() => {
    if(type === 'tournaments') renderTournamentList(data);
    if(type === 'teams' && isVisible('admin-teams-section')) renderTeamStats(data);
    if(type === 'forms' && isVisible('admin-forms-section')) renderFormsList(data);
    if(type === 'payments' && isVisible('admin-payments-section')) renderPaymentMethods(data);
  });
}


const DEFAULT_PAYMENT_METHODS = {
  saweria: { name: 'Saweria', type: 'link', target: '', owner: '', note: 'Isi link Saweria di admin jika sudah aktif.', status: 'inactive', order: 1 },
  trakteer: { name: 'Trakteer', type: 'link', target: 'https://trakteer.id/icikiwirfamily', owner: 'Icikiwir Family', note: 'Klik link lalu upload bukti pembayaran setelah selesai.', status: 'active', order: 2 },
  gopay: { name: 'GoPay', type: 'wallet', target: '081386906020', owner: 'kenzyro', note: 'Pastikan nominal sesuai fee tournament.', status: 'active', order: 3 },
  dana: { name: 'DANA', type: 'wallet', target: '081386906020', owner: 'elkenyot', note: 'Pastikan nominal sesuai fee tournament.', status: 'active', order: 4 }
};

let tournamentPaymentDraft = [
  { name: 'Trakteer', type: 'link', status: 'active', target: '', owner: '', note: 'Klik link lalu upload bukti pembayaran setelah selesai.' },
  { name: 'GoPay', type: 'wallet', status: 'active', target: '', owner: '', note: 'Pastikan nominal sesuai fee tournament.' }
];
function clonePaymentMethod(m = {}) {
  return {
    name: String(m.name || '').trim(),
    type: m.type || 'custom',
    status: m.status || 'active',
    target: String(m.target || '').trim(),
    owner: String(m.owner || '').trim(),
    note: String(m.note || '').trim(),
    order: Number(m.order || Date.now())
  };
}
function getTournamentPaymentMethodsPayload() {
  const payload = {};
  tournamentPaymentDraft
    .map(clonePaymentMethod)
    .filter(m => m.name && m.target)
    .forEach((m, index) => {
      payload[slugifyPaymentName(m.name) + '-' + (index + 1)] = { ...m, order: index + 1 };
    });
  return payload;
}
function renderTournamentPaymentDraft() {
  const host = $('#tourPaymentMethodsList');
  if (!host) return;
  if (!tournamentPaymentDraft.length) {
    host.innerHTML = '<div class="empty-state">Belum ada metode. Tambahkan minimal 1 metode kalau fee tournament berbayar.</div>';
    return;
  }
  host.innerHTML = tournamentPaymentDraft.map((m, index) => `
    <article class="payment-admin-card ${m.status === 'active' ? 'active' : 'inactive'}">
      <div class="payment-admin-head">
        <span class="payment-icon"><i class="${paymentIcon(m.type)}"></i></span>
        <div><h3>${escapeHtml(m.name || 'Payment Method')}</h3><small>${escapeHtml(m.type || 'custom')} • ${m.status === 'active' ? 'Available di tournament ini' : 'Hidden'}</small></div>
      </div>
      <p><b>Target:</b> ${escapeHtml(m.target || '-')}</p>
      <p><b>Owner:</b> ${escapeHtml(m.owner || '-')}</p>
      <p><b>Note:</b> ${escapeHtml(m.note || '-')}</p>
      <div class="row-actions">
        <button class="btn small" type="button" onclick="editTournamentPaymentMethod(${index})"><i class="ri-edit-line"></i> Edit</button>
        <button class="btn small danger" type="button" onclick="removeTournamentPaymentMethod(${index})"><i class="ri-delete-bin-line"></i> Delete</button>
      </div>
    </article>`).join('');
}
window.addTournamentPaymentMethod = function() {
  const name = $('#tourPaymentName').value.trim();
  const target = $('#tourPaymentTarget').value.trim();
  if (!name || !target) return toast('Nama metode dan link/nomor wajib diisi.', 'danger');
  const editIndex = $('#tourPaymentEditIndex').value;
  const method = {
    name,
    type: $('#tourPaymentType').value,
    status: $('#tourPaymentStatus').value,
    target,
    owner: $('#tourPaymentOwner').value.trim(),
    note: $('#tourPaymentNote').value.trim(),
    order: Date.now()
  };
  if (editIndex !== '') tournamentPaymentDraft[Number(editIndex)] = method;
  else tournamentPaymentDraft.push(method);
  resetTournamentPaymentForm();
  renderTournamentPaymentDraft();
};
window.editTournamentPaymentMethod = function(index) {
  const m = tournamentPaymentDraft[index];
  if (!m) return;
  $('#tourPaymentEditIndex').value = index;
  $('#tourPaymentName').value = m.name || '';
  $('#tourPaymentType').value = m.type || 'custom';
  $('#tourPaymentStatus').value = m.status || 'active';
  $('#tourPaymentTarget').value = m.target || '';
  $('#tourPaymentOwner').value = m.owner || '';
  $('#tourPaymentNote').value = m.note || '';
};
window.removeTournamentPaymentMethod = function(index) {
  tournamentPaymentDraft.splice(index, 1);
  renderTournamentPaymentDraft();
};
window.resetTournamentPaymentForm = function() {
  $('#tourPaymentEditIndex').value = '';
  $('#tourPaymentName').value = '';
  $('#tourPaymentType').value = 'link';
  $('#tourPaymentStatus').value = 'active';
  $('#tourPaymentTarget').value = '';
  $('#tourPaymentOwner').value = '';
  $('#tourPaymentNote').value = '';
};

function slugifyPaymentName(name='') {
  return String(name || 'payment').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `payment-${Date.now()}`;
}
async function ensureDefaultPaymentMethods() {
  const snap = await database.ref('paymentMethods').once('value');
  if (snap.exists()) return;
  await database.ref('paymentMethods').set(DEFAULT_PAYMENT_METHODS);
}
function paymentIcon(type='custom') {
  if (type === 'link') return 'ri-links-line';
  if (type === 'wallet') return 'ri-wallet-3-line';
  if (type === 'bank') return 'ri-bank-card-line';
  return 'ri-information-line';
}
function renderPaymentMethods(methods = {}) {
  const host = $('#payment-method-list');
  if (!host) return;
  const rows = Object.entries(methods).sort((a,b)=>(Number(a[1].order||99)-Number(b[1].order||99)) || String(a[1].name||a[0]).localeCompare(String(b[1].name||b[0])));
  if (!rows.length) return host.innerHTML = '<div class="empty-state">Belum ada metode pembayaran. Tambahkan dari form kiri.</div>';
  host.innerHTML = rows.map(([id, m]) => `
    <article class="payment-admin-card ${m.status === 'active' ? 'active' : 'inactive'}">
      <div class="payment-admin-head">
        <span class="payment-icon"><i class="${paymentIcon(m.type)}"></i></span>
        <div><h3>${escapeHtml(m.name || id)}</h3><small>${escapeHtml(m.type || 'custom')} • ${m.status === 'active' ? 'Available' : 'Hidden'}</small></div>
      </div>
      <p><b>Target:</b> ${escapeHtml(m.target || '-')}</p>
      <p><b>Owner:</b> ${escapeHtml(m.owner || '-')}</p>
      <p><b>Note:</b> ${escapeHtml(m.note || '-')}</p>
      <div class="row-actions">
        <button class="btn small" onclick="editPaymentMethod('${id}')"><i class="ri-edit-line"></i> Edit</button>
        <button class="btn small ${m.status === 'active' ? 'warning' : 'success'}" onclick="togglePaymentMethod('${id}', '${m.status === 'active' ? 'inactive' : 'active'}')">${m.status === 'active' ? 'Hide' : 'Activate'}</button>
        <button class="btn small danger" onclick="deletePaymentMethod('${id}')"><i class="ri-delete-bin-line"></i> Delete</button>
      </div>
    </article>`).join('');
}
window.resetPaymentForm = function() {
  $('#paymentEditId').value = '';
  $('#payment-method-form')?.reset();
  $('#paymentStatus').value = 'active';
  $('#paymentType').value = 'link';
};
window.editPaymentMethod = function(id) {
  const m = cachedPaymentMethods[id];
  if (!m) return toast('Metode pembayaran tidak ditemukan.', 'danger');
  $('#paymentEditId').value = id;
  $('#paymentName').value = m.name || '';
  $('#paymentType').value = m.type || 'custom';
  $('#paymentStatus').value = m.status || 'active';
  $('#paymentTarget').value = m.target || '';
  $('#paymentOwner').value = m.owner || '';
  $('#paymentNote').value = m.note || '';
  window.showSection('payments');
};
window.togglePaymentMethod = async function(id, status) {
  await database.ref(`paymentMethods/${id}/status`).set(status === 'active' ? 'active' : 'inactive');
  toast(status === 'active' ? 'Metode diaktifkan.' : 'Metode disembunyikan.', 'success');
};
window.deletePaymentMethod = async function(id) {
  if (!confirm('Delete metode pembayaran ini?')) return;
  await database.ref(`paymentMethods/${id}`).remove();
  toast('Metode pembayaran dihapus.', 'success');
};
$('#payment-method-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const editId = $('#paymentEditId').value.trim();
  const name = $('#paymentName').value.trim();
  const payload = {
    name,
    type: $('#paymentType').value,
    status: $('#paymentStatus').value,
    target: $('#paymentTarget').value.trim(),
    owner: $('#paymentOwner').value.trim(),
    note: $('#paymentNote').value.trim(),
    updatedAt: serverTimestamp,
    order: cachedPaymentMethods[editId]?.order || Date.now()
  };
  if (!payload.name || !payload.target) return toast('Nama metode dan link/nomor wajib diisi.', 'danger');
  const id = editId || slugifyPaymentName(name);
  await database.ref(`paymentMethods/${id}`).update(payload);
  resetPaymentForm();
  toast('Metode pembayaran berhasil disimpan.', 'success');
});

$('#create-tournament-form').addEventListener('submit', async event => {
  event.preventDefault();
  const mode = $('#tourMode').value;
  if (!['team', 'brawl'].includes(mode)) return toast('Mode tournament hanya Team 5v5 atau 1 vs 1 Brawl.', 'danger');
  const maxTeams = Number($('#tourMax').value);
  const playerPerTeam = mode === 'team' ? normalizeLineupMax($('#tourPlayerPerTeam').value) : 1;
  const tournamentPaymentMethods = getTournamentPaymentMethodsPayload();
  const payload = { name: $('#tourName').value.trim(), mode, maxTeams, playerPerTeam, format: mode === 'team' ? Number($('#tourFormat').value) : 1, fee: Number($('#tourFee').value || 0), prize: Number($('#tourPrize').value || 0), rules: $('#tourRules').value.trim(), startDate: $('#tourDate').value, status: 'registration', paymentMethods: tournamentPaymentMethods, createdAt: serverTimestamp };
  if (!payload.name || maxTeams < 2) return toast('Nama dan slot minimal 2 wajib diisi.', 'danger');
  if (payload.fee > 0 && !Object.values(tournamentPaymentMethods).some(m => m.status === 'active')) return toast('Tournament berbayar wajib punya minimal 1 metode pembayaran aktif.', 'danger');
  if (mode === 'team' && (playerPerTeam < TEAM_MIN_PLAYERS || playerPerTeam > TEAM_MAX_PLAYERS)) return toast(`Max player team harus ${TEAM_MIN_PLAYERS}-${TEAM_MAX_PLAYERS}.`, 'danger');
  await database.ref('tournaments').push().set(payload);
  event.target.reset(); $('#tourPlayerPerTeam').value = TEAM_MIN_PLAYERS; resetTournamentPaymentForm(); renderTournamentPaymentDraft(); updateModeInputs(); toast('Tournament berhasil dibuat.', 'success');
});
$('#tourMode').addEventListener('change', updateModeInputs);
renderTournamentPaymentDraft();
function updateModeInputs(){ const mode=$('#tourMode').value; $('#tourFormat').disabled = mode !== 'team'; $('#tourFormat').value = mode === 'team' ? ($('#tourFormat').value || '1') : '1'; $('#tourPlayerPerTeam').disabled = mode !== 'team'; $('#tourPlayerPerTeam').value = mode === 'team' ? Math.max(TEAM_MIN_PLAYERS, Math.min(TEAM_MAX_PLAYERS, Number($('#tourPlayerPerTeam').value || TEAM_MIN_PLAYERS))) : 1; }
updateModeInputs();

function renderTournamentList(tournaments){
  const c=$('#tournament-list-container');
  const rows=Object.entries(tournaments).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
  if(!rows.length) return c.innerHTML='<div class="empty-state">Belum ada tournament.</div>';
  const limited = rows.slice(0,80);
  c.innerHTML=limited.map(([id,t])=>{ const count=t.participants?Object.keys(t.participants).length:0; const payCount=Object.values(t.paymentMethods||{}).filter(m=>(m.status||'active')==='active').length; return `<article class="mini-tournament ${t.mode === 'brawl' ? 'brawl-border' : ''}"><div><h3>${escapeHtml(t.name)}</h3><p>${modeLabel(t.mode)} • ${escapeHtml(t.status)} • ${count}/${t.maxTeams} ${t.mode==='team'?`• min ${TEAM_MIN_PLAYERS}, max ${t.playerPerTeam||TEAM_MIN_PLAYERS} player`:''} • Payment ${payCount} aktif</p></div><div class="row-actions"><button class="btn small" onclick="openTournamentControl('${id}')">Manage</button><button class="btn small danger" onclick="deleteTournament('${id}')">Del</button></div></article>`; }).join('') + (rows.length>80?`<div class="empty-state">Menampilkan 80 tournament terbaru dari ${rows.length} data agar dashboard tetap ringan.</div>`:'');
}

function renderTeamStats(teams){
  const c=$('#team-stats-list');
  const list=Object.values(teams).sort((a,b)=>String(a.teamName||a.username).localeCompare(String(b.teamName||b.username)));
  const limited=list.slice(0,120);
  c.innerHTML=limited.map(t=>{
    const rosterCount=Array.isArray(t.players)?t.players.length:0;
    return `<article class="stat-card team-card lite-team-card"><div class="team-card-head"><div><h3>${escapeHtml(t.teamName||t.username||'Team')}</h3><small>@${escapeHtml(t.username||'-')} • ${rosterCount}/${Number(t.maxRoster||10)} player • WA ${escapeHtml(t.whatsapp||'-')}</small></div><span class="team-status ${t.isApproved?'ok':'wait'}">${t.isApproved?'Verified':'Pending'}</span></div><div class="row-actions" style="margin-top:10px"><button class="btn small" onclick="openTeamDetail('${t.username}')"><i class="ri-eye-line"></i> Detail/Edit</button><button class="btn small ${t.isApproved?'success':'warning'}" onclick="toggleApprove('${t.username}', ${!t.isApproved})">${t.isApproved?'Verified':'Approve'}</button><button class="btn small danger" onclick="toggleBan('${t.username}', ${!t.isBanned})">${t.isBanned?'Unban':'Ban'}</button>${t.whatsapp?`<a class="btn small ghost" target="_blank" href="https://wa.me/${t.whatsapp}">WA</a>`:''}</div></article>`;
  }).join('') || '<div class="empty-state">No teams.</div>';
  if(list.length>120) c.innerHTML += `<div class="empty-state">Menampilkan 120 team pertama dari ${list.length} data. Buka detail untuk edit statistik biar halaman tidak berat.</div>`;
}
function statGroup(username,label,fields,stats){ return `<div class="stat-group"><span>${label}</span><div class="stat-inputs">${fields.map(([key,title])=>`<label>${title}<input type="number" value="${Number(stats[key]||0)}" onchange="updateStat('${username}','${key}',this.value)"></label>`).join('')}</div></div>`; }
window.updateStat = async (u,type,val)=>database.ref(`teams/${u}/stats/${type}`).set(Number(val||0));
window.updateMaxRoster = async (u,val)=>database.ref(`teams/${u}/maxRoster`).set(Number(val||10));
window.toggleApprove = async (u,val)=>database.ref(`teams/${u}/isApproved`).set(Boolean(val));
window.toggleBan = async (u,val)=>database.ref(`teams/${u}/isBanned`).set(Boolean(val));
window.deleteTournament = async id => { if(confirm('Delete tournament permanently?')) await database.ref(`tournaments/${id}`).remove(); };

function renderTournamentPaymentSummary(t = {}) {
  const methods = Object.values(t.paymentMethods || {}).filter(m => (m.status || 'active') === 'active');
  if (!methods.length) return t.fee > 0 ? ' • Payment belum diset' : '';
  return ` • Payment: ${methods.map(m => escapeHtml(m.name || 'Method')).join(', ')}`;
}
window.openTournamentControl = function(id){ activeTournamentId=id; window.showSection('control'); database.ref(`tournaments/${id}`).off(); database.ref(`tournaments/${id}`).on('value', snap=>{ const t=snap.val(); if(!t) return window.showSection('dashboard'); activeTournament=t; $('#control-title').textContent=t.name; $('#format-display').textContent=`${modeLabel(t.mode)} • ${t.mode==='team'?`min ${TEAM_MIN_PLAYERS}, max ${t.playerPerTeam||TEAM_MIN_PLAYERS} player • BO${t.format||1}`:'Single Player'} • Anti-error bracket`; $('#fee-display').textContent=t.fee>0?`${formatRupiah(t.fee)} • Prize ${formatRupiah(t.prize)}${renderTournamentPaymentSummary(t).replace(/&amp;/g, '&')}`:'Free Entry'; renderActions(t); renderParticipants(t); renderAdminBracket(t); }); };
function renderActions(t){ const a=$('#admin-actions'); if(t.status==='registration') a.innerHTML=`<button class="btn success" onclick="generateBracket()">Validate, Randomize & Start</button><div class="empty-state">Sistem mengecek slot, payment approval, duplicate, dan lineup team minimal ${TEAM_MIN_PLAYERS} sampai maksimal setting admin sebelum bracket dibuat.</div>`; else if(t.status==='ongoing') a.innerHTML=`<button class="btn" onclick="finishTournament()">End Tournament</button><button class="btn danger" onclick="resetBracket()">Reset Bracket</button>`; else a.innerHTML=`<div class="empty-state success-text">Tournament Finished</div><button class="btn" onclick="resetBracket()">Re-open Registration</button>`; }
function renderParticipants(t){ const list=$('#participant-list'); const rows=Object.entries(t.participants||{}); if(!rows.length) return list.innerHTML='<li class="empty-state">No participants</li>'; list.innerHTML=rows.map(([key,p])=>`<li class="participant-row"><div><strong>${escapeHtml(p.displayName||p.teamName||key)}</strong><small>${escapeHtml(p.type||t.mode||'team')} • ${escapeHtml(p.status||'approved')} ${p.whatsapp?`• WA ${escapeHtml(p.whatsapp)}`:''}</small>${normalizePlayers(p.selectedPlayers).length?`<small>Lineup (${normalizePlayers(p.selectedPlayers).length} player): ${normalizePlayers(p.selectedPlayers).map(x=>escapeHtml(x.name)).join(', ')}</small>`:''}</div><div>${waButtons(p.whatsapp||'')}${p.status==='pending_payment'?`<button class="btn small success" onclick="approvePayment('${key}')">Approve</button>`:''}<button class="btn small danger" onclick="kickTeam('${key}')">Kick</button></div></li>`).join(''); }
window.approvePayment=async key=>{ await database.ref(`tournaments/${activeTournamentId}/participants/${key}/status`).set('approved'); toast('Payment approved.','success'); };
window.kickTeam=async key=>{ if(confirm('Kick participant?')) await database.ref(`tournaments/${activeTournamentId}/participants/${key}`).remove(); };

window.generateBracket = async function(){
  const t=activeTournament;
  const rows=Object.entries(t.participants||{});
  const approved=rows.filter(([,p])=>t.fee>0?p.status==='approved':p.status!=='rejected');
  if(approved.length<2) return toast('Minimal 2 approved participants.', 'danger');
  if(approved.length>Number(t.maxTeams||0)) return toast('Participant melebihi max slot.', 'danger');
  if(t.mode==='team'){
    const maxPlayers=normalizeLineupMax(t.playerPerTeam);
    const invalid=approved.find(([,p])=>!validLineupCount(normalizePlayers(p.selectedPlayers).length, maxPlayers));
    if(invalid) return toast(`Lineup ${invalid[1].displayName||invalid[0]} harus minimal ${TEAM_MIN_PLAYERS} dan maksimal ${maxPlayers} player. Saat ini terbaca ${normalizePlayers(invalid[1].selectedPlayers).length}.`, 'danger');
  }
  const ids=approved.map(([key])=>key);
  const bracket=createSingleEliminationBracket(ids, t.mode||'team', Number(t.format||1));
  await database.ref(`tournaments/${activeTournamentId}`).update({ bracket, status:'ongoing', lockedAt: serverTimestamp, seedCount: ids.length });
  toast('Bracket valid, terkunci, dan tournament dimulai.', 'success');
};
function renderAdminBracket(t){ const c=$('#admin-bracket-view'); if(!t.bracket) return c.innerHTML='<div class="empty-state">Bracket not created.</div>'; c.innerHTML=`<div class="bracket-scroll">${getRoundKeys(t.bracket).map(key=>renderRound(t,key)).join('')}</div>`; }
function renderRound(t,roundKey){ const title=roundKey==='bronze'?'Bronze Match':(t.bracket[roundKey].length===1&&roundKey!=='r1'?'Grand Final':roundKey.toUpperCase()); return `<section class="round-column"><h3>${title}</h3>${t.bracket[roundKey].map((m,i)=>renderMatch(t,roundKey,i,m)).join('')}</section>`; }
function participantName(t,id){ return t.participants?.[id]?.displayName || t.participants?.[id]?.teamName || id || 'TBD'; }
function renderMatch(t,roundKey,index,m){ return `<article class="match-card admin-match ${m.completed?'done':''}" onclick="openScoreModal('${roundKey}', ${index})"><div class="match-meta"><span>${escapeHtml(m.id)}</span><b>BO${m.format||1}</b></div><div class="match-team ${m.winner===m.teamA?'winner':m.winner?'loser':''}"><span>${escapeHtml(participantName(t,m.teamA))}</span><strong>${m.scoreA||0}</strong></div><div class="match-team ${m.winner===m.teamB?'winner':m.winner?'loser':''}"><span>${escapeHtml(participantName(t,m.teamB))}</span><strong>${m.scoreB||0}</strong></div>${m.note?`<small>${escapeHtml(m.note)}</small>`:''}</article>`; }
window.openScoreModal=function(roundKey,index){ const m=activeTournament.bracket?.[roundKey]?.[index]; if(!m?.teamA||!m?.teamB) return toast('Match belum siap.', 'danger'); if(m.completed&&!confirm('Match sudah DONE. Edit lagi?')) return; editingMatch={roundKey,index}; $('#score-modal-match-info').textContent=`${roundKey.toUpperCase()} • ${m.id}`; $('#score-team-a-name').textContent=participantName(activeTournament,m.teamA); $('#score-team-b-name').textContent=participantName(activeTournament,m.teamB); $('#input-score-a').value=m.scoreA||0; $('#input-score-b').value=m.scoreB||0; $('#modalMatchFormat').value=m.format||1; $('#score-modal').classList.remove('hidden'); };
window.closeScoreModal=function(){ $('#score-modal').classList.add('hidden'); editingMatch=null; };
window.saveMatchScore=async function(markDone){ if(!editingMatch) return; const {roundKey,index}=editingMatch; const match=activeTournament.bracket[roundKey][index]; if(match.completed && markDone) return toast('Match sudah selesai. Reset bracket jika perlu koreksi besar.', 'danger'); const sA=Number($('#input-score-a').value||0), sB=Number($('#input-score-b').value||0), fmt=Number($('#modalMatchFormat').value||1); let winner=null,loser=null; if(sA>sB) [winner,loser]=[match.teamA,match.teamB]; else if(sB>sA) [winner,loser]=[match.teamB,match.teamA]; else if(markDone) return toast('Score draw tidak bisa diselesaikan.', 'danger'); const base=`tournaments/${activeTournamentId}/bracket/${roundKey}/${index}`; const updates={ [`${base}/scoreA`]:sA,[`${base}/scoreB`]:sB,[`${base}/format`]:fmt }; if(markDone) Object.assign(updates,{[`${base}/completed`]:true,[`${base}/winner`]:winner,[`${base}/completedAt`]:serverTimestamp}); await database.ref().update(updates); if(markDone) await advanceWinner(roundKey,index,winner,loser); window.closeScoreModal(); };
async function advanceWinner(roundKey,index,winner,loser){ const snap=await database.ref(`tournaments/${activeTournamentId}/bracket`).once('value'); const bracket=snap.val(); const match=bracket[roundKey][index]; if(match.nextMatchId) await setTeamToMatch(bracket, match.nextMatchId, winner); else if(roundKey!=='bronze'){ await addLeaderboardPoint(winner,1); await addLeaderboardPoint(loser,2); toast(`Winner: ${participantName(activeTournament,winner)}`,'success'); } else { await addLeaderboardPoint(winner,3); toast(`3rd Place: ${participantName(activeTournament,winner)}`,'success'); } if(match.bronzeMatchId) await setTeamToMatch(bracket, match.bronzeMatchId, loser); }
async function setTeamToMatch(bracket,matchId,teamKey){ const loc=findMatchLocation(bracket,matchId); if(!loc) return; const target=bracket[loc.roundKey][loc.index]; if(target.teamA===teamKey||target.teamB===teamKey) return; const field=target.teamA?'teamB':'teamA'; await database.ref(`tournaments/${activeTournamentId}/bracket/${loc.roundKey}/${loc.index}/${field}`).set(teamKey); }
async function addLeaderboardPoint(teamKey,rank){ if(!teamKey) return; const participant=activeTournament.participants?.[teamKey]; const statKey=participant?.teamKey || teamKey; const mode=activeTournament.mode==='brawl'?'brawl':activeTournament.fee>0?'paid':'free'; const map={free:['ch1','ch2','ch3'],paid:['paidCh1','paidCh2','paidCh3'],brawl:['brawlCh1','brawlCh2','brawlCh3']}; const field=map[mode][rank-1]; if(!field) return; const root = participant?.type === 'user' ? 'users' : 'teams'; const snap=await database.ref(`${root}/${statKey}/stats/${field}`).once('value'); await database.ref(`${root}/${statKey}/stats/${field}`).set(Number(snap.val()||0)+1); }
window.resetBracket=async()=>{ if(confirm('Reset bracket?')) await database.ref(`tournaments/${activeTournamentId}`).update({ bracket:null, status:'registration' }); };
window.finishTournament=async()=>{ if(confirm('End Tournament?')) await database.ref(`tournaments/${activeTournamentId}`).update({ status:'completed' }); };



function safeKey(value=''){ return String(value).replace(/'/g, "\\'"); }
function makeToken(){
  const chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr=new Uint8Array(28); if(window.crypto?.getRandomValues) window.crypto.getRandomValues(arr);
  return Array.from(arr).map(n=>chars[n%chars.length]).join('');
}
function formShareUrl(id, token){
  const base = new URL('form.html', window.location.href);
  base.searchParams.set('id', id); base.searchParams.set('token', token || '');
  return base.toString();
}
function optionArray(){
  return $('#fieldOptions').value.split('\n').flatMap(x=>x.split(',')).map(x=>x.trim()).filter(Boolean);
}
function requiresOptions(type){ return ['select','radio','checkbox'].includes(type); }
function typeLabel(type){
  return ({text:'Short answer',textarea:'Paragraph',number:'Number',select:'Dropdown',radio:'Multiple choice',checkbox:'Checkboxes',date:'Date',email:'Email',phone:'Phone number'})[type] || type;
}
function renderFakeGformInput(f, idx){
  const help = f.helpText ? `<small class="field-help">${escapeHtml(f.helpText)}</small>` : '';
  if(f.type==='textarea') return `${help}<div class="fake-line long"></div><div class="fake-line mid"></div>`;
  if(f.type==='select') return `${help}<div class="fake-select">Choose <i class="ri-arrow-down-s-line"></i></div>`;
  if(f.type==='radio'||f.type==='checkbox') return `${help}<div class="fake-options">${(f.options||[]).map(o=>`<label><input disabled type="${f.type==='checkbox'?'checkbox':'radio'}" name="preview-${idx}"> ${escapeHtml(o)}</label>`).join('')}</div>`;
  return `${help}<div class="fake-line"></div>`;
}
function renderDraftFields(){
  const c=$('#form-fields-preview'); if(!c) return;
  if(!draftFormFields.length) return c.innerHTML='<div class="empty-state">Belum ada pertanyaan. Tambahkan pertanyaan seperti Google Form: short answer, paragraph, dropdown, multiple choice, checkbox, date, email, atau phone.</div>';
  c.innerHTML=draftFormFields.map((f,i)=>`
    <div class="gform-editor-question">
      <div class="gform-editor-toolbar">
        <div><b>${i+1}. ${escapeHtml(f.label)}</b><small>${typeLabel(f.type)} • ${f.required?'Required':'Optional'}</small></div>
        <div class="row-actions">
          <button type="button" class="btn small ghost" onclick="moveFormField(${i},-1)" title="Move up"><i class="ri-arrow-up-line"></i></button>
          <button type="button" class="btn small ghost" onclick="moveFormField(${i},1)" title="Move down"><i class="ri-arrow-down-line"></i></button>
          <button type="button" class="btn small danger" onclick="removeFormField(${i})" title="Delete"><i class="ri-delete-bin-line"></i></button>
        </div>
      </div>
      <div class="gform-editor-body">${renderFakeGformInput(f,i)}</div>
      ${f.options?.length?`<div class="gform-option-pills">${f.options.map(o=>`<span>${escapeHtml(o)}</span>`).join('')}</div>`:''}
    </div>`).join('');
}
window.addFormField=function(){
  const label=$('#fieldLabel').value.trim();
  const type=$('#fieldType').value;
  const required=$('#fieldRequired').value==='true';
  const helpText=$('#fieldDescription')?.value.trim() || '';
  const options=requiresOptions(type)?optionArray():[];
  if(!label) return toast('Isi pertanyaan dulu.', 'danger');
  if(requiresOptions(type) && options.length<2) return toast('Dropdown/multiple choice/checkbox butuh minimal 2 opsi. Pisahkan pakai koma atau baris baru.', 'danger');
  draftFormFields.push({ id: makeToken().slice(0,12), label, type, required, options, helpText });
  $('#fieldLabel').value=''; if($('#fieldDescription')) $('#fieldDescription').value=''; $('#fieldOptions').value=''; renderDraftFields();
};
window.removeFormField=function(index){ draftFormFields.splice(index,1); renderDraftFields(); };
window.moveFormField=function(index, dir){ const next=index+dir; if(next<0 || next>=draftFormFields.length) return; [draftFormFields[index],draftFormFields[next]]=[draftFormFields[next],draftFormFields[index]]; renderDraftFields(); };
$('#fieldType')?.addEventListener('change',()=>{
  const type=$('#fieldType').value;
  $('#fieldOptions').placeholder = requiresOptions(type) ? 'Option 1\nOption 2\nOption 3' : 'Options hanya dipakai untuk dropdown/radio/checkbox';
  $('#fieldOptions').disabled = !requiresOptions(type);
});
$('#fieldType')?.dispatchEvent(new Event('change'));
$('#admin-form-builder')?.addEventListener('submit', async event=>{
  event.preventDefault();
  const title=$('#formTitle').value.trim();
  if(!title) return toast('Judul form wajib diisi.', 'danger');
  if(!draftFormFields.length) return toast('Minimal tambah 1 pertanyaan.', 'danger');
  const ref=database.ref('publicForms').push();
  const shareToken=makeToken();
  const payload={
    title,
    description: $('#formDescription').value.trim(),
    status: $('#formStatus').value,
    theme: $('#formTheme')?.value || 'purple',
    collectEmail: !!$('#formCollectEmail')?.checked,
    limitOneResponse: !!$('#formLimitOne')?.checked,
    shareToken,
    isPublicForm:true,
    fields: draftFormFields,
    responseCount:0,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp
  };
  await ref.set(payload);
  await copyFormLink(ref.key, shareToken, false);
  event.target.reset(); draftFormFields=[]; renderDraftFields(); $('#fieldType')?.dispatchEvent(new Event('change'));
  toast('Public form berhasil dibuat. Link private sudah dicopy.', 'success');
});
function renderFormsList(forms){
  const c=$('#admin-forms-list'); if(!c) return;
  const rows=Object.entries(forms).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
  if(!rows.length) return c.innerHTML='<div class="empty-state">Belum ada public form.</div>';
  c.innerHTML=rows.slice(0,80).map(([id,f])=>`
    <article class="mini-tournament gform-list-card">
      <div>
        <h3>${escapeHtml(f.title||'Untitled Form')}</h3>
        <p>${escapeHtml(f.status||'open')} • public standalone • ${(f.fields||[]).length} pertanyaan • ${Number(f.responseCount||0)} response</p>
        <small class="muted-text">${escapeHtml(f.description||'Tanpa deskripsi')}</small>
      </div>
      <div class="row-actions">
        <button class="btn small" onclick="copyFormLink('${id}','${safeKey(f.shareToken||'')}')"><i class="ri-link"></i> Copy Link</button>
        <a class="btn small ghost" target="_blank" href="${formShareUrl(id,f.shareToken)}"><i class="ri-external-link-line"></i> Open</a>
        <button class="btn small ghost" onclick="previewForm('${id}')"><i class="ri-eye-line"></i> Preview</button>
        <button class="btn small ghost" onclick="viewFormResponses('${id}')"><i class="ri-table-line"></i> Responses</button>
        <button class="btn small ${f.status==='open'?'warning':'success'}" onclick="toggleFormStatus('${id}','${f.status==='open'?'closed':'open'}')">${f.status==='open'?'Close':'Open'}</button>
        <button class="btn small danger" onclick="deleteForm('${id}')">Del</button>
      </div>
    </article>`).join('');
}
window.copyFormLink=async function(id, token, notify=true){
  const url=formShareUrl(id, token || cachedForms[id]?.shareToken);
  try{ await navigator.clipboard.writeText(url); if(notify) toast('Public form link dicopy.', 'success'); }
  catch{ prompt('Copy public form link ini:', url); }
};
window.toggleFormStatus=async(id,status)=>{ await database.ref(`publicForms/${id}`).update({ status, updatedAt: serverTimestamp }); toast(`Form ${status}.`, 'success'); };
window.deleteForm=async id=>{ if(confirm('Delete form ini beserta response-nya?')) { await database.ref(`publicForms/${id}`).remove(); await database.ref(`publicFormResponses/${id}`).remove(); } };
function renderPreviewInput(f, idx){
  if(f.type==='textarea') return `<textarea rows="3" placeholder="Your answer"></textarea>`;
  if(f.type==='select') return `<select><option value="">Choose</option>${(f.options||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
  if(f.type==='radio'||f.type==='checkbox') return `<div class="gform-choice-list">${(f.options||[]).map(o=>`<label class="gform-choice"><input type="${f.type}" name="preview-${idx}" value="${escapeHtml(o)}"> <span>${escapeHtml(o)}</span></label>`).join('')}</div>`;
  const inputType = f.type==='phone' ? 'tel' : f.type;
  return `<input type="${escapeHtml(inputType||'text')}" placeholder="Your answer">`;
}
window.previewForm=function(id){
  const f=cachedForms[id]; if(!f) return;
  $('#form-preview-title').textContent=f.title||'Form Preview';
  $('#form-preview-body').innerHTML=`
    <div class="gform-public-preview theme-${escapeHtml(f.theme||'purple')}">
      <div class="gform-header-strip"></div>
      <div class="public-form-title-block"><h2>${escapeHtml(f.title||'Untitled Form')}</h2><p>${escapeHtml(f.description||'Tidak ada deskripsi.')}</p></div>
      <div class="form-grid">${(f.fields||[]).map((field,i)=>`<label class="gform-question"><span>${escapeHtml(field.label)} ${field.required?'<b class="danger-text">*</b>':''}</span>${field.helpText?`<small class="field-help">${escapeHtml(field.helpText)}</small>`:''}${renderPreviewInput(field,i)}</label>`).join('')}</div>
    </div>`;
  $('#form-preview-modal').classList.remove('hidden');
};
window.viewFormResponses=async function(id){
  const form=cachedForms[id]; if(!form) return;
  const snap=await database.ref(`publicFormResponses/${id}`).limitToLast(50).once('value');
  const rows=Object.entries(snap.val()||{}).reverse();
  $('#form-preview-title').textContent=`Responses - ${form.title||'Form'}`;
  if(!rows.length) $('#form-preview-body').innerHTML='<div class="empty-state">Belum ada response.</div>';
  else $('#form-preview-body').innerHTML=rows.map(([rid,r])=>`
    <article class="response-card">
      <div class="response-head"><b>${escapeHtml(r.email||'Anonymous')}</b><small>${new Date(r.submittedAt||Date.now()).toLocaleString('id-ID')}</small></div>
      <div class="response-answers">${Object.entries(r.answers||{}).map(([q,a])=>`<div><small>${escapeHtml(q)}</small><b>${escapeHtml(Array.isArray(a)?a.join(', '):a)}</b></div>`).join('')}</div>
    </article>`).join('');
  $('#form-preview-modal').classList.remove('hidden');
};
window.closeFormPreview=function(){ $('#form-preview-modal').classList.add('hidden'); };
window.openTeamDetail=function(username){
  const t=cachedTeams[username]; if(!t) return toast('Team tidak ditemukan.', 'danger');
  const players=Array.isArray(t.players)?t.players:[];
  const s=t.stats||{};
  $('#team-detail-title').textContent=t.teamName||username;
  $('#team-detail-body').innerHTML=`<div class="detail-grid"><article><small>Username</small><b>@${escapeHtml(t.username||username)}</b></article><article><small>WhatsApp</small><b>${escapeHtml(t.whatsapp||'-')}</b></article><article><small>Status</small><b>${t.isApproved?'Verified':'Pending'}${t.isBanned?' / Banned':''}</b></article><article><small>Roster Max</small><input class="mini-input" type="number" min="1" max="10" value="${Number(t.maxRoster||10)}" onchange="updateMaxRoster('${username}',this.value)"></article></div><div class="section-title" style="margin-top:18px"><i class="ri-bar-chart-box-line"></i> Statistik Team</div>${statGroup(username,'Free',[['ch1','1st'],['ch2','2nd'],['ch3','3rd']],s)}${statGroup(username,'Paid',[['paidCh1','1st'],['paidCh2','2nd'],['paidCh3','3rd']],s)}${statGroup(username,'1v1 Brawl',[['brawlCh1','1st'],['brawlCh2','2nd'],['brawlCh3','3rd']],s)}<div class="section-title" style="margin-top:18px"><i class="ri-team-line"></i> Player Roster & Account ID</div><div class="player-detail-list">${players.map((p,i)=>`<div class="player-detail-row"><span>#${i+1}</span><div><b>${escapeHtml(p.name||'Unnamed Player')}</b><small>Role: ${escapeHtml(p.role||'-')} • ID Akun/Game: ${escapeHtml(p.id||p.gameId||p.accountId||'-')}</small></div></div>`).join('') || '<div class="empty-state">Roster player belum diisi.</div>'}</div>`;
  $('#team-detail-modal').classList.remove('hidden');
};
window.closeTeamDetail=function(){ $('#team-detail-modal').classList.add('hidden'); };
renderDraftFields();

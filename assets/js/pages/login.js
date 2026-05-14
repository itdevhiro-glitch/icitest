import { auth, database } from '../core/firebase.js';
import { $, toast, setButtonLoading } from '../core/utils.js';
import { getTeamDataByUsername, makeDefaultStats } from '../core/team-service.js';
import { ADMIN_UID } from '../core/firebase.js';

const loginForm = $('#login-form');
const registerForm = $('#register-form');
const authStatus = $('#auth-status-message');

function showAuthMessage(message, type = 'danger') {
  authStatus.textContent = message || '';
  authStatus.className = `auth-message auth-${type}`;
}

auth.onAuthStateChanged(user => {
  if (!user) return;
  window.location.href = user.uid === ADMIN_UID ? 'admin.html' : 'dashboard.html';
});

$('#to-register-btn').addEventListener('click', event => {
  event.preventDefault();
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  showAuthMessage('');
});

$('#to-login-btn').addEventListener('click', event => {
  event.preventDefault();
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  showAuthMessage('');
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Authenticating...');
  showAuthMessage('Checking account...', 'info');

  try {
    const username = $('#loginUsername').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    if (username === 'admin') {
      await auth.signInWithEmailAndPassword('admin@icikiwir.digital', password);
      return;
    }
    const team = await getTeamDataByUsername(username);
    if (!team) throw new Error('Username tidak ditemukan.');
    if (team.data.isBanned) throw new Error('Team ini sedang dibanned.');
    await auth.signInWithEmailAndPassword(team.data.email, password);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setButtonLoading(button, false);
  }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = registerForm.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Creating team...');
  showAuthMessage('Registering...', 'info');

  try {
    const username = $('#regUsername').value.trim().toLowerCase().replace(/\s+/g, '');
    const teamName = $('#regTeamName').value.trim();
    const email = $('#regEmail').value.trim().toLowerCase();
    const password = $('#regPassword').value;

    if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new Error('Username hanya boleh huruf kecil, angka, titik, underscore, dash. Minimal 3 karakter.');
    if (!email.endsWith('@icikiwir.digital')) throw new Error('Email harus menggunakan domain @icikiwir.digital.');
    if (password.length < 6) throw new Error('Password minimal 6 karakter.');
    if (await getTeamDataByUsername(username)) throw new Error('Username sudah dipakai.');

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await database.ref(`teams/${username}`).set({
      uid: cred.user.uid,
      username,
      teamName,
      email,
      isApproved: false,
      isBanned: false,
      stats: makeDefaultStats(),
      players: [],
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    toast('Registrasi berhasil. Silakan login ulang.', 'success');
    await auth.signOut();
    registerForm.reset();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    showAuthMessage('Registration successful. Please login.', 'success');
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setButtonLoading(button, false);
  }
});

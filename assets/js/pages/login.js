import { auth, database } from '../core/firebase.js';
import { $, toast, setButtonLoading, normalizeWhatsApp } from '../core/utils.js';
import { getAccountByUsername, makeDefaultStats } from '../core/team-service.js';
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

function showRegisterPanel() {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  showAuthMessage('');
}
$('#to-register-btn').addEventListener('click', event => {
  event.preventDefault();
  showRegisterPanel();
});
if (location.hash === '#register' || sessionStorage.getItem('openRegister') === '1') {
  sessionStorage.removeItem('openRegister');
  showRegisterPanel();
}

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
    const account = await getAccountByUsername(username);
    if (!account) throw new Error('Username tidak ditemukan di akun team maupun user.');
    if (account.data.isBanned) throw new Error('Akun ini sedang dibanned.');
    await auth.signInWithEmailAndPassword(account.data.email, password);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setButtonLoading(button, false);
  }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = registerForm.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Creating account...');
  showAuthMessage('Registering...', 'info');
  try {
    const accountType = $('#regAccountType').value;
    const username = $('#regUsername').value.trim().toLowerCase().replace(/\s+/g, '');
    const displayName = $('#regTeamName').value.trim();
    const email = $('#regEmail').value.trim().toLowerCase();
    const password = $('#regPassword').value;
    const wa = normalizeWhatsApp($('#regWhatsapp').value.trim());

    if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new Error('Username hanya boleh huruf kecil, angka, titik, underscore, dash. Minimal 3 karakter.');
    if (!email.endsWith('@icikiwir.digital')) throw new Error('Email harus menggunakan domain @icikiwir.digital.');
    if (password.length < 6) throw new Error('Password minimal 6 karakter.');
    if (!/^62\d{8,15}$/.test(wa)) throw new Error('Nomor WhatsApp wajib benar. Contoh: 08123456789.');
    if (await getAccountByUsername(username)) throw new Error('Username sudah dipakai.');

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const common = { uid: cred.user.uid, username, email, whatsapp: wa, accountType, isApproved: accountType === 'user', isBanned: false, stats: makeDefaultStats(), createdAt: firebase.database.ServerValue.TIMESTAMP };
    if (accountType === 'team') {
      await database.ref(`teams/${username}`).set({ ...common, teamName: displayName, players: [] });
    } else {
      await database.ref(`users/${username}`).set({ ...common, displayName, gameId: '', role: 'Solo Player' });
    }
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

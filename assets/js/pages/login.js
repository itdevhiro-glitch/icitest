import { auth, database } from '../core/firebase.js';
import { $, toast, setButtonLoading, normalizeWhatsApp } from '../core/utils.js';
import { getAccountByUsername, makeDefaultStats } from '../core/team-service.js';
import { ADMIN_UID } from '../core/firebase.js';

const loginForm = $('#login-form');
const registerForm = $('#register-form');
const authStatus = $('#auth-status-message');
let suppressAutoRedirect = false;

function showAuthMessage(message, type = 'danger') {
  authStatus.textContent = message || '';
  authStatus.className = `auth-message auth-${type}`;
}

const regEmailInput = $('#regEmail');
if (regEmailInput) {
  regEmailInput.addEventListener('input', () => {
    const value = regEmailInput.value.trim().toLowerCase();
    regEmailInput.value = value;
    if (!value) {
      regEmailInput.setCustomValidity('');
      return;
    }
    if (value.includes('@') && !value.endsWith('@icikiwir.digital')) {
      regEmailInput.setCustomValidity('Gunakan email turnamen @icikiwir.digital, bukan Gmail/email pribadi.');
    } else {
      regEmailInput.setCustomValidity('');
    }
  });
}

auth.onAuthStateChanged(user => {
  if (!user || suppressAutoRedirect) return;
  window.smoothNavigate ? window.smoothNavigate(user.uid === ADMIN_UID ? 'admin.html' : 'dashboard.html') : (window.location.href = user.uid === ADMIN_UID ? 'admin.html' : 'dashboard.html');
});

function swapAuthPanel(fromForm, toForm) {
  if (!fromForm || !toForm || fromForm === toForm) return;

  const panel = fromForm.closest('.cinematic-auth-panel') || fromForm.parentElement;
  if (panel) panel.style.minHeight = `${panel.offsetHeight}px`;

  fromForm.classList.remove('auth-panel-ready', 'auth-panel-entering');
  fromForm.classList.add('auth-panel-leaving');

  window.setTimeout(() => {
    fromForm.classList.add('hidden');
    fromForm.classList.remove('auth-panel-leaving');

    toForm.classList.remove('hidden', 'auth-panel-ready');
    toForm.classList.add('auth-panel-entering');

    if (panel) {
      const nextHeight = panel.scrollHeight;
      panel.style.minHeight = `${nextHeight}px`;
    }

    requestAnimationFrame(() => {
      toForm.classList.remove('auth-panel-entering');
      toForm.classList.add('auth-panel-ready');
    });

    window.setTimeout(() => {
      toForm.classList.remove('auth-panel-ready');
      if (panel) panel.style.minHeight = '';
    }, 430);
  }, 220);
}

function showRegisterPanel() {
  swapAuthPanel(loginForm, registerForm);
  showAuthMessage('');
}
$('#to-register-btn').addEventListener('click', event => {
  event.preventDefault();
  const openGate = window.icwAgreementGate?.open;
  const verified = window.icwAgreementGate?.isVerified?.() === true;
  if (openGate && !verified) {
    openGate(event.currentTarget, showRegisterPanel);
    return;
  }
  showRegisterPanel();
});
if (location.hash === '#register' || sessionStorage.getItem('openRegister') === '1') {
  sessionStorage.removeItem('openRegister');
  showRegisterPanel();
}

$('#to-login-btn').addEventListener('click', event => {
  event.preventDefault();
  swapAuthPanel(registerForm, loginForm);
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
    suppressAutoRedirect = false;
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
    if (!email.endsWith('@icikiwir.digital')) throw new Error('Email pribadi seperti Gmail/Yahoo tidak diperbolehkan. Gunakan email turnamen dengan domain @icikiwir.digital, contoh: nickname@icikiwir.digital.');
    if (password.length < 6) throw new Error('Password minimal 6 karakter.');
    if (!/^62\d{8,15}$/.test(wa)) throw new Error('Nomor WhatsApp wajib benar karena dipakai untuk koordinasi room, jadwal match, dan konfirmasi hasil. Contoh: 08123456789.');
    if (await getAccountByUsername(username)) throw new Error('Username sudah dipakai.');

    suppressAutoRedirect = true;
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const common = { uid: cred.user.uid, username, email, whatsapp: wa, accountType, isApproved: accountType === 'user', isBanned: false, stats: makeDefaultStats(), createdAt: firebase.database.ServerValue.TIMESTAMP };
    if (accountType === 'team') {
      await database.ref(`teams/${username}`).set({ ...common, teamName: displayName, players: [] });
    } else {
      await database.ref(`users/${username}`).set({ ...common, displayName, gameId: '', role: 'Solo Player' });
    }
    toast('Registrasi berhasil. Silakan login ulang.', 'success');
    await auth.signOut();
    suppressAutoRedirect = false;
    registerForm.reset();
    window.icwAgreementGate?.reset?.();
    swapAuthPanel(registerForm, loginForm);
    showAuthMessage('Registration successful. Please login.', 'success');
  } catch (error) {
    suppressAutoRedirect = false;
    showAuthMessage(error.message);
  } finally {
    setButtonLoading(button, false);
  }
});

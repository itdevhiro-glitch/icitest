export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatRupiah(value = 0) {
  return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

export function toast(message, type = 'info') {
  let host = $('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  host.appendChild(item);
  setTimeout(() => item.remove(), 3300);
}

export function setButtonLoading(button, isLoading, label = 'Processing...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

export function getRoundKeys(bracket = {}) {
  return Object.keys(bracket).sort((a, b) => {
    if (a === 'bronze') return 1;
    if (b === 'bronze') return -1;
    return Number(a.replace('r', '')) - Number(b.replace('r', ''));
  });
}

export function modeLabel(mode = 'team') {
  if (mode === 'brawl') return '1 VS 1 BRAWL';
  return 'TEAM 5V5';
}

export function normalizeWhatsApp(value = '') {
  let v = String(value).replace(/\D/g, '');
  if (v.startsWith('0')) v = '62' + v.slice(1);
  if (v && !v.startsWith('62')) v = '62' + v;
  return v;
}

export function roleClass(role = '') {
  return String(role).toLowerCase().replace('lane', '').replace('cadangan', 'sub');
}

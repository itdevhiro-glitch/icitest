(function(){
  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true });
    else fn();
  }

  ready(function(){
    const EMAIL_INFO = 'Wajib pakai email turnamen @icikiwir.digital, bukan Gmail pribadi, agar tidak ada salah paham seolah website meminta/menyimpan email asli player.';
    const PHONE_INFO = 'Nomor HP/WhatsApp dipakai untuk koordinasi match: bikin room, atur jadwal, konfirmasi hasil, dan memudahkan admin input score dari info kedua team/player.';
    const modal = document.getElementById('fieldInfoModal');
    const title = document.getElementById('fieldInfoTitle');
    const text = document.getElementById('fieldInfoText');
    if(!modal || !title || !text) return;

    function looksLikeEmailInput(input){
      const hay = [input.type, input.name, input.id, input.placeholder, input.getAttribute('aria-label')].join(' ').toLowerCase();
      return hay.includes('email') || hay.includes('@icikiwir') || hay.includes('gmail');
    }

    function looksLikePhoneInput(input){
      const hay = [input.type, input.name, input.id, input.placeholder, input.getAttribute('aria-label')].join(' ').toLowerCase();
      return hay.includes('phone') || hay.includes('tel') || hay.includes('hp') || hay.includes('wa') || hay.includes('whatsapp') || hay.includes('nomor');
    }

    function addInfoButton(input, kind){
      if(input.dataset.icwInfoReady === 'true') return;
      input.dataset.icwInfoReady = 'true';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icw-field-info-btn';
      btn.textContent = '!';
      btn.setAttribute('aria-label', kind === 'email' ? 'Info email turnamen' : 'Info nomor WhatsApp');
      btn.dataset.infoKind = kind;
      const label = input.closest('label');
      const fieldWrap = input.closest('.cinematic-field, .form-group, .input-group, .field, .form-field, .auth-field, .input-wrapper');
      if(label && !label.querySelector(`.icw-field-info-btn[data-info-kind="${kind}"]`)) label.appendChild(btn);
      else if(fieldWrap) fieldWrap.appendChild(btn);
      else input.insertAdjacentElement('afterend', btn);
    }

    function scan(){
      document.querySelectorAll('#register-form input').forEach((input) => {
        if(looksLikeEmailInput(input)) addInfoButton(input, 'email');
        if(looksLikePhoneInput(input)) addInfoButton(input, 'phone');
      });
    }

    function openInfo(kind){
      title.textContent = kind === 'email' ? 'Kenapa wajib @icikiwir.digital?' : 'Kenapa butuh nomor WhatsApp?';
      text.textContent = kind === 'email' ? EMAIL_INFO : PHONE_INFO;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('register-agreement-lock');
    }

    function closeInfo(){
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('register-agreement-lock');
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.icw-field-info-btn');
      if(btn){
        e.preventDefault();
        e.stopPropagation();
        openInfo(btn.dataset.infoKind);
        return;
      }
      if(e.target.closest('[data-close-field-info]')) closeInfo();
    });

    document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && modal.classList.contains('is-open')) closeInfo(); });
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {childList:true, subtree:true});
  });
})();

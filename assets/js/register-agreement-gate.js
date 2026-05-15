(function(){
  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true });
    else fn();
  }

  ready(function(){
    const gate = document.getElementById('icwAgreementGate');

    function syncModalViewport(){
      const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      if(viewportHeight){
        document.documentElement.style.setProperty('--icw-modal-vh', viewportHeight + 'px');
        const gateEl = document.getElementById('icwAgreementGate');
        if(gateEl) gateEl.style.setProperty('--icw-modal-vh', viewportHeight + 'px');
      }
    }

    syncModalViewport();
    window.addEventListener('resize', syncModalViewport, { passive:true });
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize', syncModalViewport, { passive:true });
      window.visualViewport.addEventListener('scroll', syncModalViewport, { passive:true });
    }
    const checkbox = document.getElementById('icwAgreementCheckbox');
    const verifyBtn = document.getElementById('icwAgreementVerify');
    if(!gate || !checkbox || !verifyBtn) return;

    let pendingRegisterTrigger = null;
    let afterVerify = null;
    let verifiedThisPage = false;

    function isRegisterTrigger(el){
      if(!el) return false;
      const text = (el.textContent || '').trim().toLowerCase();
      const href = (el.getAttribute('href') || '').toLowerCase();
      const dataTarget = (el.getAttribute('data-target') || '').toLowerCase();
      const dataTab = (el.getAttribute('data-tab') || '').toLowerCase();
      const dataAuth = (el.getAttribute('data-auth-tab') || el.getAttribute('data-auth') || '').toLowerCase();
      const idClass = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
      return text.includes('daftar') || text.includes('register') || href.includes('register') || dataTarget.includes('register') || dataTab.includes('register') || dataAuth.includes('register') || idClass.includes('register');
    }

    function openGate(trigger, callback){
      pendingRegisterTrigger = trigger || null;
      afterVerify = typeof callback === 'function' ? callback : null;
      checkbox.checked = false;
      verifyBtn.disabled = true;
      syncModalViewport();
      gate.classList.add('is-open');
      gate.setAttribute('aria-hidden', 'false');
      document.body.classList.add('icw-modal-lock');

      const scrollArea = gate.querySelector('.icw-agreement-body');
      const panel = gate.querySelector('.icw-agreement-panel');
      if(scrollArea) scrollArea.scrollTop = 0;
      if(panel) panel.scrollTop = 0;

      setTimeout(() => checkbox.focus({ preventScroll:true }), 80);
    }

    function closeGate(){
      gate.classList.remove('is-open');
      gate.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('icw-modal-lock');
    }

    function activateRegisterClean(){
      verifiedThisPage = true;
      closeGate();
      const callback = afterVerify;
      const trigger = pendingRegisterTrigger;
      afterVerify = null;
      pendingRegisterTrigger = null;

      if(callback){
        callback();
        return;
      }

      setTimeout(() => {
        if(trigger) {
          try { trigger.click(); } catch(e) {}
        }
        const registerPanel = document.querySelector('#register-form, #register, #registerForm, .register-form, [data-panel="register"], [data-auth="register"]');
        if(registerPanel){
          registerPanel.classList.remove('hidden', 'd-none', 'is-hidden');
          registerPanel.style.removeProperty('display');
        }
        const email = document.querySelector('#regEmail, #register-form input[type="email"], input[placeholder*="@icikiwir"], input[name*="email" i]');
        if(email) email.focus({preventScroll:true});
      }, 40);
    }

    checkbox.addEventListener('change', () => { verifyBtn.disabled = !checkbox.checked; });
    verifyBtn.addEventListener('click', () => { if(checkbox.checked) activateRegisterClean(); });

    document.addEventListener('click', (e) => {
      const close = e.target.closest('[data-icw-agreement-close]');
      if(close){
        e.preventDefault();
        closeGate();
        return;
      }

      const trigger = e.target.closest('a, button, [role="button"], [data-target], [data-tab], [data-auth-tab]');
      if(trigger && isRegisterTrigger(trigger) && !verifiedThisPage && !trigger.closest('#icwAgreementGate')){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openGate(trigger);
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && gate.classList.contains('is-open')) closeGate();
    });

    window.icwAgreementGate = {
      isVerified: () => verifiedThisPage,
      reset: () => { verifiedThisPage = false; },
      open: openGate
    };
  });
})();

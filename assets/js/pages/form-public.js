import { database, serverTimestamp } from '../core/firebase.js';
import { $, escapeHtml, toast } from '../core/utils.js';

const params = new URLSearchParams(location.search);
const formId = params.get('f') || params.get('id');
const token = params.get('t') || '';
const card = $('#public-form-card');
let activeForm = null;

function fail(message){
  card.innerHTML = `<div class="gform-header-strip danger"></div><div class="form-status-box"><i class="ri-lock-2-line"></i><h1>Form tidak bisa dibuka</h1><p>${escapeHtml(message)}</p></div>`;
}
function fieldName(f, i){ return `field_${i}_${String(f.id || f.label || i).replace(/[^a-z0-9_-]/gi,'_')}`; }
function inputHtml(f, i){
  const name = fieldName(f, i);
  const req = f.required ? 'required' : '';
  if(f.type === 'textarea') return `<textarea name="${name}" rows="4" placeholder="Jawaban Anda" ${req}></textarea>`;
  if(f.type === 'select') return `<select name="${name}" ${req}><option value="">Pilih satu jawaban</option>${(f.options||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
  if(f.type === 'radio') return `<div class="gform-choice-list">${(f.options||[]).map((o,j)=>`<label class="gform-choice"><input type="radio" name="${name}" value="${escapeHtml(o)}" ${f.required&&j===0?'required':''}> <span>${escapeHtml(o)}</span></label>`).join('')}</div>`;
  if(f.type === 'checkbox') return `<div class="gform-choice-list">${(f.options||[]).map(o=>`<label class="gform-choice"><input type="checkbox" name="${name}" value="${escapeHtml(o)}" data-required-group="${f.required?'true':'false'}"> <span>${escapeHtml(o)}</span></label>`).join('')}</div>`;
  const type = f.type === 'phone' ? 'tel' : (f.type || 'text');
  return `<input type="${escapeHtml(type)}" name="${name}" placeholder="Jawaban Anda" ${req}>`;
}
function renderForm(form){
  activeForm = form;
  const fields = Array.isArray(form.fields) ? form.fields : [];
  card.innerHTML = `
    <div class="gform-header-strip"></div>
    <form id="public-form-submit" class="gform-public-preview">
      <div class="public-form-title-block">
        <h1>${escapeHtml(form.title || 'Untitled Form')}</h1>
        <p>${escapeHtml(form.description || '')}</p>
        <small>${fields.length} pertanyaan • Private form</small>
      </div>
      <label class="gform-question respondent-box"><span>Nama pengisi <b class="danger-text">*</b></span><input name="respondentName" placeholder="Nama Anda / nama team" required></label>
      ${fields.map((f,i)=>`<label class="gform-question"><span>${i+1}. ${escapeHtml(f.label)} ${f.required?'<b class="danger-text">*</b>':''}</span>${inputHtml(f,i)}</label>`).join('')}
      <div class="public-form-actions"><button class="btn" type="submit"><i class="ri-send-plane-line"></i> Submit</button><span class="muted-text">Response akan masuk ke admin dashboard.</span></div>
    </form>`;
  $('#public-form-submit').addEventListener('submit', submitForm);
}
function collectAnswers(formEl){
  const answers = {};
  for(const [i,f] of (activeForm.fields||[]).entries()){
    const name = fieldName(f,i);
    if(f.type === 'checkbox'){
      const checked = Array.from(formEl.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)).map(x=>x.value);
      if(f.required && checked.length === 0) throw new Error(`Pertanyaan "${f.label}" wajib dipilih minimal satu.`);
      answers[f.label] = checked;
    } else if(f.type === 'radio'){
      const checked = formEl.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
      if(f.required && !checked) throw new Error(`Pertanyaan "${f.label}" wajib dipilih.`);
      answers[f.label] = checked ? checked.value : '';
    } else {
      const input = formEl.elements[name];
      answers[f.label] = input ? input.value.trim() : '';
    }
  }
  return answers;
}
async function submitForm(event){
  event.preventDefault();
  const formEl = event.currentTarget;
  const btn = formEl.querySelector('button[type="submit"]');
  try{
    btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line"></i> Mengirim...';
    const respondentName = formEl.elements.respondentName.value.trim();
    const answers = collectAnswers(formEl);
    await database.ref(`formResponses/${formId}`).push().set({ respondentName, answers, submittedAt: serverTimestamp, userAgent: navigator.userAgent.slice(0,120) });
    await database.ref(`forms/${formId}/responseCount`).transaction(v => Number(v||0)+1);
    card.innerHTML = `<div class="gform-header-strip success"></div><div class="form-status-box"><i class="ri-checkbox-circle-line"></i><h1>Response terkirim</h1><p>Terima kasih, jawaban Anda sudah masuk.</p></div>`;
  } catch(err){
    toast(err.message || 'Gagal submit form.', 'danger');
    btn.disabled = false; btn.innerHTML = '<i class="ri-send-plane-line"></i> Submit';
  }
}
async function init(){
  if(!formId || !token) return fail('Link private tidak lengkap. Copy ulang link dari admin dashboard.');
  const snap = await database.ref(`forms/${formId}`).once('value');
  const form = snap.val();
  if(!form) return fail('Form tidak ditemukan atau sudah dihapus.');
  if(form.shareToken !== token) return fail('Token private link tidak valid.');
  if(form.status !== 'open') return fail('Form ini sedang ditutup oleh admin.');
  renderForm(form);
}
init().catch(()=>fail('Gagal memuat form. Cek koneksi atau rules Firebase.'));

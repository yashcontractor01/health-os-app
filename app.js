/* Health OS Coach — personal, private, provider-agnostic PWA.
   The "brain" is a markdown master file. The AI reads it as context and
   returns an updated copy after changes. Everything is stored on-device
   (localStorage) and optionally auto-backed-up to a private GitHub repo.
   No server. No company involvement. Your data, your keys. */

const LS = { settings:'healthos.settings', master:'healthos.master', chat:'healthos.chat' };
const DEFAULTS = {
  provider:'claude',                         // pick any in Settings: Claude / ChatGPT / Gemini
  claudeKey:'', claudeModel:'claude-sonnet-4-6',
  openaiKey:'', openaiModel:'gpt-4o',
  geminiKey:'', geminiModel:'gemini-2.0-flash',
  ghToken:'', ghOwner:'yashcontractor01', ghRepo:'health-os', ghPath:'Yash_Health_OS.md', ghBranch:'main',
  autoBackup:true
};

let settings = Object.assign({}, DEFAULTS, load(LS.settings, {}));
let master   = localStorage.getItem(LS.master) || '';
let messages = load(LS.chat, []);
let pending  = []; // images staged for next send: {mime,data}

const $ = s => document.querySelector(s);
const logEl=$('#log'), inputEl=$('#input'), bannerEl=$('#banner');

/* ---------- init ---------- */
init();
async function init(){
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('sw.js'); }catch(e){} }
  if(!master){ await trySeed(); }
  if(!master && settings.ghToken){ await pullFromGitHub(); }
  wire();
  renderAll();
  updateBadge();
  if(!master) showImportBanner();
  else if(!hasKey()) showKeyBanner();
}

async function trySeed(){
  // Convenience for running locally next to the file on the laptop.
  // (When deployed publicly the file is NOT shipped — you Import it once.)
  try{ const r=await fetch('../Yash_Health_OS.md'); if(r.ok){ master=await r.text(); localStorage.setItem(LS.master,master);} }catch(e){}
}

function hasKey(){
  if(settings.provider==='gemini') return !!settings.geminiKey;
  if(settings.provider==='openai') return !!settings.openaiKey;
  return !!settings.claudeKey;
}

/* ---------- system prompt ---------- */
function systemPrompt(){
  const today = new Date().toISOString().slice(0,10);
  return `You are Yash's personal health coach. The MASTER FILE below is your memory and the single source of truth — operate entirely from it.

RULES:
- Follow the operating rules written inside the file: never guess a Gujarati food name (ask first); apply oil accounting; supplements must be certified/kidney-safe/liver-safe; BP = take 3-4 readings and use the LAST; replies must be mobile-friendly (short paragraphs, no wide tables); friendly, direct, not preachy; understand Gujarati-English and reply in clean English.
- Continue from the CURRENT SNAPSHOT and the newest Daily Log entry. Never restart the journey.
- This system is OPEN-ENDED. If Yash raises a new topic (a lab report, skin/face routine, gym training, sleep, mood, any new problem), create and start tracking a new module for it. Never say you only do nutrition.

AUTO-UPDATE THE FILE (important):
- Whenever the day's data changes (weight, BP, meals, a new log entry, a lab value, a new module), output the COMPLETE updated master file at the very END of your reply, wrapped exactly like this:
<<<MASTERFILE>>>
(full updated markdown here)
<<<MASTERFILE_END>>>
- Prepend new daily entries to the top of the Daily Log, refresh the CURRENT SNAPSHOT, update metric journeys, and set the "last updated" date to ${today}. Keep everything faithful — never invent data; write "unknown" if unsure.
- If nothing changed this turn, omit the markers entirely.

Today's date is ${today}.

=== MASTER FILE START ===
${master || '(empty — ask Yash to import or start his profile)'}
=== MASTER FILE END ===`;
}

/* ---------- providers ---------- */
async function callClaude(){
  const res = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'content-type':'application/json','x-api-key':settings.claudeKey,
      'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({ model:settings.claudeModel, max_tokens:16000, system:systemPrompt(),
      messages: messages.map(toClaudeMsg) })
  });
  if(!res.ok) throw new Error('Claude '+res.status+': '+(await res.text()).slice(0,300));
  const d=await res.json();
  return (d.content||[]).map(b=>b.type==='text'?b.text:'').join('');
}
function toClaudeMsg(m){
  if(m.images && m.images.length){
    const blocks=m.images.map(i=>({type:'image',source:{type:'base64',media_type:i.mime,data:i.data}}));
    if(m.content) blocks.push({type:'text',text:m.content});
    return {role:m.role, content:blocks};
  }
  return {role:m.role, content:m.content};
}
async function callGemini(){
  const contents = messages.map(m=>{
    const parts=[];
    (m.images||[]).forEach(i=>parts.push({inline_data:{mime_type:i.mime,data:i.data}}));
    if(m.content) parts.push({text:m.content});
    return {role: m.role==='assistant'?'model':'user', parts};
  });
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiKey}`;
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({ systemInstruction:{parts:[{text:systemPrompt()}]}, contents,
      generationConfig:{maxOutputTokens:8192} })});
  if(!res.ok) throw new Error('Gemini '+res.status+': '+(await res.text()).slice(0,300));
  const d=await res.json();
  return (d.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
}
async function callOpenAI(){
  const msgs=[{role:'system', content:systemPrompt()}];
  messages.forEach(m=>{
    if(m.images && m.images.length){
      const content=[];
      if(m.content) content.push({type:'text', text:m.content});
      m.images.forEach(i=>content.push({type:'image_url', image_url:{url:`data:${i.mime};base64,${i.data}`}}));
      msgs.push({role:m.role, content});
    } else {
      msgs.push({role:m.role, content:m.content});
    }
  });
  const res=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+settings.openaiKey},
    body:JSON.stringify({ model:settings.openaiModel, messages:msgs, max_tokens:16000 })
  });
  if(!res.ok) throw new Error('ChatGPT '+res.status+': '+(await res.text()).slice(0,300));
  const d=await res.json();
  return d.choices?.[0]?.message?.content || '';
}

/* ---------- send ---------- */
async function send(){
  const text=inputEl.value.trim();
  if(!text && !pending.length) return;
  if(!hasKey()){ showKeyBanner(); openSettings(); return; }
  messages.push({role:'user', content:text, images:pending.slice()});
  pending=[]; inputEl.value=''; inputEl.style.height='auto'; renderPending();
  renderAll(); save();
  const t=addThinking();
  try{
    let reply = settings.provider==='gemini' ? await callGemini()
              : settings.provider==='openai' ? await callOpenAI()
              : await callClaude();
    let saved=false;
    const m=reply.match(/<<<MASTERFILE>>>([\s\S]*?)<<<MASTERFILE_END>>>/);
    if(m){ saveMaster(m[1].trim()); reply=reply.replace(m[0],'').trim(); saved=true; }
    messages.push({role:'assistant', content:reply||'(updated ✓)', saved});
  }catch(e){
    messages.push({role:'assistant', content:'⚠️ '+e.message});
  }
  t.remove(); renderAll(); save();
}

/* ---------- master + backup ---------- */
function saveMasterLocal(md){
  master=md; localStorage.setItem(LS.master,md);
  const ta=$('#masterText'); if(ta) ta.value=md;
  hideBanner();
}
function saveMaster(md){
  saveMasterLocal(md);
  if(settings.autoBackup && settings.ghToken && settings.ghRepo) backup(md);
}
function ghHeaders(){ return {'authorization':'token '+settings.ghToken,'accept':'application/vnd.github+json','content-type':'application/json'}; }
function b64(s){ return btoa(unescape(encodeURIComponent(s))); }
function b64decode(s){ return decodeURIComponent(escape(atob((s||'').replace(/\n/g,'')))); }
async function pullFromGitHub(){
  if(!settings.ghToken || !settings.ghRepo) return false;
  try{
    const base=`https://api.github.com/repos/${settings.ghOwner}/${settings.ghRepo}/contents/${encodeURIComponent(settings.ghPath)}`;
    const r=await fetch(base+'?ref='+encodeURIComponent(settings.ghBranch),{headers:ghHeaders()});
    if(!r.ok) return false;
    const j=await r.json();
    saveMasterLocal(b64decode(j.content));
    renderAll();
    return true;
  }catch(e){ return false; }
}
async function backup(md){
  setStatus('backing up…');
  try{
    const base=`https://api.github.com/repos/${settings.ghOwner}/${settings.ghRepo}/contents/${encodeURIComponent(settings.ghPath)}`;
    let sha;
    const g=await fetch(base+'?ref='+encodeURIComponent(settings.ghBranch),{headers:ghHeaders()});
    if(g.ok) sha=(await g.json()).sha;
    const p=await fetch(base,{method:'PUT',headers:ghHeaders(),
      body:JSON.stringify({message:'health update '+new Date().toISOString(), content:b64(md), sha, branch:settings.ghBranch})});
    setStatus(p.ok ? 'backed up to GitHub ✓' : 'backup failed ('+p.status+')');
  }catch(e){ setStatus('backup error'); }
}
function setStatus(s){ $('#backupStatus').textContent=s; if(s.includes('✓')) setTimeout(()=>{$('#backupStatus').textContent='';},4000); }

/* ---------- rendering ---------- */
function renderAll(){
  logEl.innerHTML='';
  if(!messages.length){
    const d=document.createElement('div'); d.className='msg bot';
    d.innerHTML=fmt("Hi Yash 👋 I'm your Health OS coach. I've got your whole journey loaded.\n\nSend me **today's morning weight** and a **BP reading** to start the day — or a photo of your plate / BP monitor / a new lab report.");
    logEl.appendChild(d);
  }
  messages.forEach(m=>{
    const d=document.createElement('div'); d.className='msg '+(m.role==='user'?'user':'bot');
    let html='';
    (m.images||[]).forEach(i=>html+=`<img src="data:${i.mime};base64,${i.data}">`);
    html+=fmt(m.content||'');
    d.innerHTML=html; logEl.appendChild(d);
    if(m.saved){ const s=document.createElement('div'); s.className='saved'; s.textContent='✓ file updated'; logEl.appendChild(s); }
  });
  logEl.scrollTop=logEl.scrollHeight;
}
function addThinking(){ const d=document.createElement('div'); d.className='thinking'; d.textContent='coach is thinking…'; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; return d; }
function fmt(t){ return esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>'); }
function esc(t){ return (t||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function renderPending(){ $('#pending').innerHTML=pending.map(i=>`<img src="data:${i.mime};base64,${i.data}">`).join(''); }
function updateBadge(){ $('#provBadge').textContent = '· ' + ({claude:'Claude', openai:'ChatGPT', gemini:'Gemini'}[settings.provider]||'Claude'); }

/* ---------- banners ---------- */
function showImportBanner(){ bannerEl.style.display='block'; bannerEl.innerHTML='No master file yet. <button class="ghost" onclick="document.getElementById(\'importInput\').click()">Import Yash_Health_OS.md</button>'; }
function showKeyBanner(){ bannerEl.style.display='block'; bannerEl.innerHTML='Add your AI key to start. <button class="ghost" onclick="openSettings()">Open settings</button>'; }
function hideBanner(){ bannerEl.style.display='none'; }

/* ---------- voice ---------- */
let rec=null;
function toggleMic(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ alert('Voice input not supported in this browser.'); return; }
  if(rec){ rec.stop(); rec=null; $('#micBtn').textContent='🎤'; return; }
  rec=new SR(); rec.lang='en-IN'; rec.interimResults=true; rec.continuous=true;
  $('#micBtn').textContent='⏹️';
  let base=inputEl.value;
  rec.onresult=e=>{ let s=''; for(let i=e.resultIndex;i<e.results.length;i++) s+=e.results[i][0].transcript; inputEl.value=(base+' '+s).trim(); autoGrow(); };
  rec.onend=()=>{ rec=null; $('#micBtn').textContent='🎤'; };
  rec.start();
}

/* ---------- settings UI ---------- */
function openSettings(){
  $('#claudeKey').value=settings.claudeKey; $('#claudeModel').value=settings.claudeModel;
  $('#openaiKey').value=settings.openaiKey; $('#openaiModel').value=settings.openaiModel;
  $('#geminiKey').value=settings.geminiKey; $('#geminiModel').value=settings.geminiModel;
  $('#ghOwner').value=settings.ghOwner; $('#ghRepo').value=settings.ghRepo;
  $('#ghPath').value=settings.ghPath; $('#ghBranch').value=settings.ghBranch; $('#ghToken').value=settings.ghToken;
  setSeg('#provSeg','data-p',settings.provider);
  setSeg('#backupSeg','data-b',settings.autoBackup?'on':'off');
  toggleProvCfg();
  $('#setModal').classList.add('open');
}
function saveSettings(){
  settings.claudeKey=$('#claudeKey').value.trim(); settings.claudeModel=$('#claudeModel').value.trim()||DEFAULTS.claudeModel;
  settings.openaiKey=$('#openaiKey').value.trim(); settings.openaiModel=$('#openaiModel').value.trim()||DEFAULTS.openaiModel;
  settings.geminiKey=$('#geminiKey').value.trim(); settings.geminiModel=$('#geminiModel').value.trim()||DEFAULTS.geminiModel;
  settings.ghOwner=$('#ghOwner').value.trim(); settings.ghRepo=$('#ghRepo').value.trim();
  settings.ghPath=$('#ghPath').value.trim()||DEFAULTS.ghPath; settings.ghBranch=$('#ghBranch').value.trim()||'main';
  settings.ghToken=$('#ghToken').value.trim();
  save(LS.settings,settings); updateBadge(); $('#setModal').classList.remove('open');
  if(hasKey()) hideBanner();
  if(!master && settings.ghToken){ pullFromGitHub(); }
}
function setSeg(sel,attr,val){ document.querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on', b.getAttribute(attr)===val)); }
function toggleProvCfg(){
  $('#claudeCfg').style.display=settings.provider==='claude'?'':'none';
  $('#openaiCfg').style.display=settings.provider==='openai'?'':'none';
  $('#geminiCfg').style.display=settings.provider==='gemini'?'':'none';
}

/* ---------- master file UI ---------- */
function openFile(){ $('#masterText').value=master; $('#fileModal').classList.add('open'); }
function downloadMaster(){
  const blob=new Blob([master],{type:'text/markdown'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Yash_Health_OS.md'; a.click();
}

/* ---------- helpers ---------- */
function load(k,def){ try{ return JSON.parse(localStorage.getItem(k))??def; }catch(e){ return def; } }
function save(k,v){ if(v===undefined){ localStorage.setItem(LS.chat,JSON.stringify(messages)); } else localStorage.setItem(k,JSON.stringify(v)); }
function autoGrow(){ inputEl.style.height='auto'; inputEl.style.height=Math.min(inputEl.scrollHeight,120)+'px'; }

/* ---------- wiring ---------- */
function wire(){
  $('#sendBtn').onclick=send;
  inputEl.addEventListener('input',autoGrow);
  inputEl.addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
  $('#micBtn').onclick=toggleMic;
  $('#photoBtn').onclick=()=>$('#photoInput').click();
  $('#photoInput').onchange=e=>{ [...e.target.files].forEach(addPhoto); e.target.value=''; };
  $('#setBtn').onclick=openSettings;
  $('#setCancel').onclick=()=>$('#setModal').classList.remove('open');
  $('#setSave').onclick=saveSettings;
  document.querySelectorAll('#provSeg button').forEach(b=>b.onclick=()=>{ settings.provider=b.getAttribute('data-p'); setSeg('#provSeg','data-p',settings.provider); toggleProvCfg(); });
  document.querySelectorAll('#backupSeg button').forEach(b=>b.onclick=()=>{ settings.autoBackup=b.getAttribute('data-b')==='on'; setSeg('#backupSeg','data-b',settings.autoBackup?'on':'off'); });
  $('#fileBtn').onclick=openFile;
  $('#fileClose').onclick=()=>$('#fileModal').classList.remove('open');
  $('#masterSave').onclick=()=>{ saveMaster($('#masterText').value); setStatus('saved ✓'); };
  $('#downloadBtn').onclick=downloadMaster;
  $('#pullBtn').onclick=()=>pullFromGitHub().then(ok=>setStatus(ok?'loaded from GitHub ✓':'load failed (check token/repo)'));
  $('#backupNow').onclick=()=>backup(master);
  $('#importBtn').onclick=()=>$('#importInput').click();
  $('#importInput').onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ saveMaster(r.result); $('#masterText').value=r.result; renderAll(); setStatus('imported ✓'); }; r.readAsText(f); e.target.value=''; };
}
function addPhoto(file){
  const r=new FileReader();
  r.onload=()=>{ const [meta,data]=r.result.split(','); const mime=(meta.match(/data:(.*?);/)||[])[1]||'image/jpeg'; pending.push({mime,data}); renderPending(); };
  r.readAsDataURL(file);
}
window.openSettings=openSettings; // for inline banner buttons

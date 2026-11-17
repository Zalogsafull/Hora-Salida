/* Hora Salida · Mis viáticos
   Registro mensual de viáticos en el Google Drive de cada persona (carpeta "Hora Salida"),
   con marcas de la intranet (recortadas) y comprobantes, y PDF de fin de mes.
   Permiso drive.file: la app solo ve los archivos que ella misma crea. */
(function(){
'use strict';
const GD = {
  cliente: '499878544628-pn1o30cvka3roletog6e2mio5atpo5io.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive.file',
  carpeta: 'Hora Salida',
  archivo: 'hora-salida-viaticos.json'
};
const K = {con:'hs_gd_con', tok:'hs_gd_tok', email:'hs_gd_email', carpeta:'hs_gd_carpeta', archivo:'hs_gd_arch', datos:'hs_reg'};
const R = {token:null, exp:0, sync:false, pend:false, timer:null, err:'', necesitaToque:false,
           datos: LS.get(K.datos, null) || {nombre:'', v:{}, del:{}}, mes: mesHoy(), ed:null};
try{ const t=LS.get(K.tok,null); if(t && t.e>Date.now()){ R.token=t.t; R.exp=t.e; } }catch(e){}

/* ---------------- utilidades ---------------- */
function mesHoy(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function isoHoy(off){ const d=new Date(); d.setDate(d.getDate()+(off||0)); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
const fDMY = f => f ? f.slice(8,10)+'/'+f.slice(5,7)+'/'+f.slice(0,4) : '';
const fDM  = f => f ? f.slice(8,10)+'/'+f.slice(5,7) : '';
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const mesNombre = m => MESES[+m.slice(5,7)-1]+' '+m.slice(0,4);
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const conectado = () => LS.get(K.con,'')==='1';
const tokenOk = () => !!R.token && Date.now() < R.exp-60000;
const corto = n => String(n||'').replace(/\s*C\.?\s*T\.?\s*$/i,'').trim();
const enWeb = () => location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1';
function guardarLocal(){ LS.set(K.datos, R.datos); }
function viaticos(){ return Object.values(R.datos.v||{}); }
function delMes(m){ return viaticos().filter(v=>(v.fIni||'').slice(0,7)===m).sort((a,b)=>(a.fIni+a.hIni).localeCompare(b.fIni+b.hIni)); }

/* ---------------- IndexedDB: copia local de los adjuntos ---------------- */
let _idb=null;
function idb(){ if(_idb) return _idb; _idb=new Promise((ok,mal)=>{ try{ const r=indexedDB.open('hora-salida',1); r.onupgradeneeded=()=>r.result.createObjectStore('blobs'); r.onsuccess=()=>ok(r.result); r.onerror=()=>mal(r.error);}catch(e){mal(e);} }); return _idb; }
async function blobPut(k,b){ try{ const db=await idb(); await new Promise((ok,mal)=>{ const t=db.transaction('blobs','readwrite'); t.objectStore('blobs').put(b,k); t.oncomplete=ok; t.onerror=()=>mal(t.error); }); }catch(e){} }
async function blobGet(k){ try{ const db=await idb(); return await new Promise((ok)=>{ const r=db.transaction('blobs').objectStore('blobs').get(k); r.onsuccess=()=>ok(r.result||null); r.onerror=()=>ok(null); }); }catch(e){ return null; } }

/* ---------------- Google: permiso y Drive ---------------- */
let _gis=null;
function cargarGIS(){
  if(window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if(_gis) return _gis;
  _gis=new Promise((ok,mal)=>{ const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true; s.onload=()=>ok(); s.onerror=()=>{ _gis=null; mal({code:'sin_google'}); }; document.head.appendChild(s); });
  return _gis;
}
async function pedirToken(prompt){
  await cargarGIS();
  return new Promise((ok,mal)=>{
    try{
      google.accounts.oauth2.initTokenClient({client_id:GD.cliente, scope:GD.scope, prompt, login_hint: LS.get(K.email,'')||undefined,
        callback: r=>{ if(!r||r.error){ mal(r||{}); return; } R.token=r.access_token; R.exp=Date.now()+(+r.expires_in||3600)*1000; LS.set(K.tok,{t:R.token,e:R.exp}); R.necesitaToque=false; ok(); },
        error_callback: e=>mal(e||{})
      }).requestAccessToken();
    }catch(e){ mal(e); }
  });
}
async function asegurarToken(){ if(tokenOk()) return; await pedirToken(''); }
async function gapi(url,opt={}){
  const r=await fetch(url,{...opt, headers:{...(opt.headers||{}), Authorization:'Bearer '+R.token}});
  if(r.status===401){ R.token=null; R.exp=0; LS.del(K.tok); R.necesitaToque=true; throw {code:'token'}; }
  if(!r.ok) throw {code:'http', status:r.status};
  return r;
}
const DAPI='https://www.googleapis.com/drive/v3/files';
async function existe(id){ try{ const j=await (await gapi(DAPI+'/'+id+'?fields=id,trashed')).json(); return !j.trashed; }catch(e){ if(e.code==='token') throw e; return false; } }
async function carpetaId(){
  let id=LS.get(K.carpeta,''); if(id && await existe(id)) return id;
  const q=encodeURIComponent("name='"+GD.carpeta+"' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const j=await (await gapi(DAPI+'?q='+q+'&spaces=drive&fields=files(id)')).json();
  id = j.files&&j.files[0] ? j.files[0].id : null;
  if(!id){
    const c=await (await gapi(DAPI+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:GD.carpeta,mimeType:'application/vnd.google-apps.folder'})})).json();
    id=c.id;
  }
  LS.set(K.carpeta,id); return id;
}
async function archivoId(){
  let id=LS.get(K.archivo,''); if(id && await existe(id)) return id;
  const q=encodeURIComponent("name='"+GD.archivo+"' and trashed=false");
  const j=await (await gapi(DAPI+'?q='+q+'&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id)')).json();
  id = j.files&&j.files[0] ? j.files[0].id : '';
  LS.set(K.archivo,id); return id;
}
async function subir(blob, nombre, mime, idExistente){
  if(idExistente){ await gapi('https://www.googleapis.com/upload/drive/v3/files/'+idExistente+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':mime},body:blob}); return idExistente; }
  const parent=await carpetaId();
  const b='hs'+Math.random().toString(36).slice(2);
  const meta={name:nombre, mimeType:mime, parents:[parent]};
  const body=new Blob(['--'+b+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+b+'\r\nContent-Type: '+mime+'\r\n\r\n', blob, '\r\n--'+b+'--']);
  const j=await (await gapi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body})).json();
  return j.id;
}
async function bajar(driveId){
  const c=await blobGet(driveId); if(c) return c;
  await asegurarToken();
  const b=await (await gapi(DAPI+'/'+driveId+'?alt=media')).blob();
  await blobPut(driveId,b); return b;
}
async function borrarDrive(id){ try{ await gapi(DAPI+'/'+id,{method:'DELETE'}); }catch(e){} }

/* ---------------- sincronización (gana el cambio más nuevo por viático) ---------------- */
function fusionar(a,b){
  const out={nombre:'', nombreT:0, v:{}, del:{...(a.del||{})}};
  for(const [id,t] of Object.entries(b.del||{})) out.del[id]=Math.max(out.del[id]||0,t);
  const ids=new Set([...Object.keys(a.v||{}),...Object.keys(b.v||{})]);
  for(const id of ids){
    const x=(a.v||{})[id], y=(b.v||{})[id];
    const g = !x ? y : !y ? x : (y.t>x.t ? y : x);
    if(g && !(out.del[id] && out.del[id]>=g.t)) out.v[id]=g;
  }
  const an=a.nombreT||0, bn=b.nombreT||0;
  out.nombre = bn>an ? b.nombre : a.nombre; out.nombreT=Math.max(an,bn);
  return out;
}
async function sincronizar(manual){
  if(!conectado() || R.sync) return;
  if(!tokenOk()){ R.necesitaToque=true; pintar(); return; }
  R.sync=true; R.err=''; clearTimeout(R.timer); pintarEstado();
  try{
    const id=await archivoId();
    let rem=null;
    if(id){ try{ rem=await (await gapi(DAPI+'/'+id+'?alt=media')).json(); }catch(e){ if(e.code==='token') throw e; } }
    const fus = rem && rem.app==='hora-salida' ? fusionar(R.datos, rem.datos||{}) : fusionar(R.datos,{});
    const cambio = JSON.stringify(fus)!==JSON.stringify(R.datos);
    R.datos=fus; guardarLocal();
    if(!id || !rem || JSON.stringify(fus)!==JSON.stringify(rem.datos)){
      const blob=new Blob([JSON.stringify({app:'hora-salida', formato:1, actualizado:new Date().toISOString(), datos:fus})],{type:'application/json'});
      const nid=await subir(blob, GD.archivo, 'application/json', id||null); LS.set(K.archivo,nid);
    }
    R.pend=false; LS.set('hs_gd_ultima',Date.now());
    if(manual) toast(cambio?'Sincronizado: trajo cambios de Drive':'Sincronizado con Drive');
  }catch(e){
    if(e && e.code==='token'){ R.necesitaToque=true; if(manual) toast('Tocá Sincronizar para renovar el permiso'); }
    else { R.err = navigator.onLine===false ? 'Sin internet: se sube cuando vuelva la conexión.' : 'No se pudo sincronizar con Drive.'; if(manual) toast(R.err); }
  }finally{ R.sync=false; pintar(); }
}
function cambio(){ guardarLocal(); R.pend=true; clearTimeout(R.timer); R.timer=setTimeout(()=>sincronizar(false),1500); pintar(); }

async function iniciarSesion(){
  $('regLoginErr').textContent='';
  if(!enWeb()){ $('regLoginErr').textContent='Google funciona cuando abrís la app desde su dirección web.'; return; }
  try{
    await pedirToken('');
    try{ const j=await (await gapi('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')).json();
         if(j.user){ LS.set(K.email,j.user.emailAddress||''); if(!R.datos.nombre && j.user.displayName){ R.datos.nombre=j.user.displayName; R.datos.nombreT=Date.now(); } } }catch(e){}
    LS.set(K.con,'1'); pintar(); await sincronizar(true);
  }catch(e){
    $('regLoginErr').textContent = e && e.code==='sin_google' ? 'No se pudo cargar Google. Revisá la conexión.'
      : e && /popup_closed|access_denied/.test(e.type||e.error||'') ? 'No se dio el permiso.' : 'No se pudo iniciar sesión con Google.';
  }
}
function cerrarSesion(){
  try{ if(R.token && window.google && google.accounts) google.accounts.oauth2.revoke(R.token,()=>{}); }catch(e){}
  R.token=null; R.exp=0; [K.con,K.tok,K.archivo,K.carpeta].forEach(k=>LS.del(k));
  R.datos={nombre:'',v:{},del:{}}; LS.del(K.datos);
  pintar(); toast('Sesión cerrada. Tus viáticos siguen en tu Drive.');
}
async function conToque(fn){ try{ await asegurarToken(); }catch(e){ toast('No se pudo renovar el permiso de Google'); throw e; } return fn(); }

/* ---------------- lista del mes ---------------- */
function pintarEstado(){
  if(!conectado()) return;
  $('regCuenta').textContent = LS.get(K.email,'') || 'Cuenta de Google';
  const u=LS.get('hs_gd_ultima',0);
  $('regEstado').textContent = R.sync ? 'Sincronizando…' : R.necesitaToque ? 'Tocá Sincronizar para renovar el permiso' : R.err ? R.err : R.pend ? 'Cambios sin subir…' : (u ? 'Guardado en Drive' : '');
}
function pintar(){
  const on=conectado();
  $('regOff').classList.toggle('hide',on); $('regOn').classList.toggle('hide',!on);
  if(!on) return;
  pintarEstado();
  if(document.activeElement!==$('regNombre')) $('regNombre').value=R.datos.nombre||'';
  $('mesTxt').textContent=mesNombre(R.mes);
  const lista=delMes(R.mes);
  const grupo=t=>{
    const l=lista.filter(v=>v.tipo===t); if(!l.length) return '';
    const loco=l.reduce((s,v)=>s+(+v.loco||0),0);
    return '<div class="vgrp"><span>'+t+' · '+l.length+'</span>'+(loco?'<span>Locomoción $'+loco.toLocaleString('es-UY')+'</span>':'')+'</div>'+l.map(v=>{
      const nm=(v.adj||[]).filter(a=>a.clase==='marca').length, nc=(v.adj||[]).filter(a=>a.clase==='comp').length;
      const fin = v.fFin&&v.hFin ? fDM(v.fFin)+' '+v.hFin : '<span class="open">sin terminar</span>';
      return '<div class="vit" data-id="'+esc(v.id)+'"><div class="t1">'+esc(v.localidad||'—')+'</div><div class="t2">'+fDM(v.fIni)+' '+esc(v.hIni||'--:--')+' → '+fin+
        (nm||nc?' · '+(nm?'🕒'+nm+' ':'')+(nc?'🧾'+nc:''):'')+(+v.loco?' · $'+(+v.loco).toLocaleString('es-UY'):'')+'</div></div>';
    }).join('');
  };
  $('regLista').innerHTML = grupo('C100')+grupo('C200') || '<p class="note" style="padding:6px 2px">No hay viáticos en '+mesNombre(R.mes)+'.</p>';
}

/* ---------------- editor ---------------- */
function opcionesLoc(sel, id){
  const deps=[...new Set(locs.map(l=>l.departamento))].sort(cmp);
  sel.innerHTML='<option value="">—</option>'+deps.map(d=>'<optgroup label="'+esc(d)+'">'+locs.filter(l=>l.departamento===d).sort((a,b)=>cmp(a.localidad,b.localidad)).map(l=>'<option value="'+esc(l.id)+'"'+(l.id===id?' selected':'')+'>'+esc(l.localidad)+'</option>').join('')+'</optgroup>').join('');
}
function pintarTipo(){
  document.querySelectorAll('#vTipo button').forEach(b=>b.classList.toggle('on',b.dataset.t===R.ed.tipo));
  $('vLocoHint').textContent = R.ed.tipo==='C200' ? 'En C200 la locomoción no se paga: queda en 0 (el pasaje igual va como comprobante).' : 'Importe de pasajes o boletos a cobrar.';
}
function pintarAdj(){
  const item=a=>'<div class="adj" data-a="'+esc(a.id)+'"><div class="th" id="th_'+esc(a.id)+'">'+(a.mime==='application/pdf'?'PDF':'…')+'</div><div class="nm">'+esc(a.nombre||'')+'</div><button type="button" class="x" data-x="'+esc(a.id)+'" aria-label="Quitar">×</button></div>';
  const adj=R.ed.adj||[];
  $('vMarcas').innerHTML = adj.filter(a=>a.clase==='marca').map(item).join('') || '<span class="note">Subí el PDF de la página de marcas y recortalo.</span>';
  $('vComps').innerHTML = adj.filter(a=>a.clase==='comp').map(item).join('') || '<span class="note">Sin comprobantes.</span>';
  adj.forEach(async a=>{
    if(a.mime==='application/pdf') return;
    try{ const b=a._blob || await bajar(a.drive); const el=document.getElementById('th_'+a.id); if(el){ el.style.backgroundImage='url('+URL.createObjectURL(b)+')'; el.textContent=''; } }catch(e){}
  });
}
function abrirEditor(v){
  const nuevo=!v || !R.datos.v[v.id];
  R.ed = JSON.parse(JSON.stringify(v || {id:uid(), tipo:'C200', localidad:'', fIni:isoHoy(), hIni:'', fFin:isoHoy(), hFin:'', loco:0, adj:[]}));
  R.ed._nuevo=nuevo; R.ed._subidos=[]; R.ed._quitados=[];
  $('vTitle').textContent = nuevo ? 'Nuevo viático' : 'Editar viático';
  $('dlLocNames').innerHTML=[...new Set(locs.map(l=>corto(l.localidad)))].sort(cmp).map(n=>'<option value="'+esc(n)+'">').join('');
  $('vLoc').value=R.ed.localidad||''; $('vFIni').value=R.ed.fIni||''; $('vHIni').value=R.ed.hIni||''; $('vFFin').value=R.ed.fFin||''; $('vHFin').value=R.ed.hFin||'';
  $('vLoco').value = R.ed.loco||0;
  opcionesLoc($('vCEntLoc'), R.ed.cEntLoc||''); opcionesLoc($('vCSalLoc'), R.ed.cSalLoc||'');
  $('vCEnt').value=R.ed.cEnt||''; $('vCSal').value=R.ed.cSal||'';
  $('vCalc').open = !!(R.ed.cEnt||R.ed.cSal);
  $('vErr').textContent=''; $('vDel').classList.toggle('hide',nuevo);
  pintarTipo(); pintarAdj();
  $('dlgV').showModal();
}
function leerEditor(){
  Object.assign(R.ed,{localidad:$('vLoc').value.trim(), fIni:$('vFIni').value, hIni:$('vHIni').value, fFin:$('vFFin').value, hFin:$('vHFin').value,
    loco: R.ed.tipo==='C200' ? 0 : Math.max(0, Math.round(+$('vLoco').value||0)),
    cEntLoc:$('vCEntLoc').value, cSalLoc:$('vCSalLoc').value, cEnt:$('vCEnt').value, cSal:$('vCSal').value});
}
function calcEditor(){
  const le=byId($('vCEntLoc').value), ls=byId($('vCSalLoc').value), me=toMin($('vCEnt').value), ms=toMin($('vCSal').value);
  const msg=[];
  if(le && me!=null){ $('vHIni').value=hhmm(me-toMin(le.horas)); msg.push('Comienzo '+$('vHIni').value+' ('+$('vCEnt').value+' − '+dur(toMin(le.horas))+')'); if(!$('vLoc').value) $('vLoc').value=corto(le.localidad); }
  if(ls && ms!=null){ $('vHFin').value=hhmm(ms+toMin(ls.horas)); msg.push('Finalización '+$('vHFin').value+' ('+$('vCSal').value+' + '+dur(toMin(ls.horas))+')'); }
  $('vCalcHint').textContent = msg.join(' · ') || 'Hora comienzo = marca − viaje · Hora finalización = marca + viaje';
}
['vCEntLoc','vCSalLoc','vCEnt','vCSal'].forEach(id=>$(id).addEventListener('input',calcEditor));
$('vTipo').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; R.ed.tipo=b.dataset.t; if(R.ed.tipo==='C200') $('vLoco').value=0; pintarTipo(); });
$('vMarcas').addEventListener('click',quitarAdj); $('vComps').addEventListener('click',quitarAdj);
function quitarAdj(e){
  const x=e.target.closest('[data-x]'); if(!x) return;
  const a=R.ed.adj.find(a=>a.id===x.dataset.x); if(!a) return;
  R.ed.adj=R.ed.adj.filter(z=>z!==a); R.ed._quitados.push(a); pintarAdj();
}
$('vCancel').addEventListener('click',()=>{
  // lo subido en esta edición y no guardado se borra de Drive
  (R.ed._subidos||[]).forEach(a=>borrarDrive(a.drive));
  $('dlgV').close();
});
$('vForm').addEventListener('submit',e=>{
  e.preventDefault(); leerEditor();
  const v=R.ed;
  if(!v.localidad || !v.fIni){ $('vErr').textContent='Completá la localidad y la fecha de comienzo.'; return; }
  if(v.fFin && v.fFin<v.fIni){ $('vErr').textContent='La fecha de finalización es anterior al comienzo.'; return; }
  (v._quitados||[]).filter(a=>!(v._subidos||[]).includes(a)).forEach(a=>borrarDrive(a.drive));
  (v._quitados||[]).filter(a=>(v._subidos||[]).includes(a)).forEach(a=>borrarDrive(a.drive));
  const limpio={...v, t:Date.now(), adj:(v.adj||[]).map(({_blob,...a})=>a)}; delete limpio._nuevo; delete limpio._subidos; delete limpio._quitados;
  R.datos.v[v.id]=limpio; R.mes=v.fIni.slice(0,7);
  $('dlgV').close(); cambio(); toast('Viático guardado');
});
$('vDel').addEventListener('click',()=>{
  const b=$('vDel');
  if(b.dataset.c!=='1'){ b.dataset.c='1'; b.textContent='Tocá de nuevo para eliminar'; setTimeout(()=>{ b.dataset.c=''; b.textContent='Eliminar viático'; },3000); return; }
  b.dataset.c=''; b.textContent='Eliminar viático';
  const v=R.datos.v[R.ed.id]; if(v){ (v.adj||[]).forEach(a=>borrarDrive(a.drive)); }
  (R.ed._subidos||[]).forEach(a=>borrarDrive(a.drive));
  delete R.datos.v[R.ed.id]; R.datos.del[R.ed.id]=Date.now();
  $('dlgV').close(); cambio(); toast('Viático eliminado');
});

/* ---------------- adjuntos ---------------- */
async function aJpeg(fileOrCanvas, max=2000, q=0.85){
  let cv;
  if(fileOrCanvas instanceof HTMLCanvasElement) cv=fileOrCanvas;
  else {
    const url=URL.createObjectURL(fileOrCanvas);
    const img=await new Promise((ok,mal)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=()=>mal(new Error('No se pudo leer la imagen')); i.src=url; });
    const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    cv=document.createElement('canvas'); cv.width=Math.round(img.naturalWidth*k); cv.height=Math.round(img.naturalHeight*k);
    const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height); c.drawImage(img,0,0,cv.width,cv.height);
    URL.revokeObjectURL(url);
  }
  return await new Promise(ok=>cv.toBlob(ok,'image/jpeg',q));
}
async function agregarAdj(blob, nombre, mime, clase, extra){
  await asegurarToken();
  const drive=await subir(blob, nombre, mime);
  await blobPut(drive, blob);
  const a={id:uid(), drive, nombre, mime, clase, ...(extra||{})};
  a._blob=blob; R.ed.adj.push(a); R.ed._subidos.push(a); pintarAdj();
  return a;
}
$('vCompIn').addEventListener('change', async e=>{
  const files=[...e.target.files]; e.target.value='';
  for(const f of files){
    $('vErr').textContent='Subiendo '+f.name+'…';
    try{
      if(f.type==='application/pdf') await agregarAdj(f, f.name, 'application/pdf', 'comp');
      else { const j=await aJpeg(f); await agregarAdj(j, (f.name||'comprobante').replace(/\.[^.]+$/,'')+'.jpg', 'image/jpeg', 'comp'); }
      $('vErr').textContent='';
    }catch(err){ $('vErr').textContent='No se pudo subir '+f.name+(err&&err.code==='token'?': renová el permiso de Google.':'.'); }
  }
});
$('vMarcaIn').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{ await abrirRecorte(f); }catch(err){ $('vErr').textContent='No se pudo abrir el archivo: '+(err.message||err); }
});

/* ---------------- recorte de la página de marcas ---------------- */
const C={pages:[], i:0, src:null, rect:null, drag:null, n:0, nombre:''};
let _pdfjs=null;
function cargarScript(src){ return new Promise((ok,mal)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>mal(new Error('No se pudo cargar '+src)); document.head.appendChild(s); }); }
async function pdfjs(){ if(!_pdfjs) _pdfjs=cargarScript('lib/pdf.min.js').then(()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc='lib/pdf.worker.min.js'; return pdfjsLib; }); return _pdfjs; }
async function abrirRecorte(file){
  C.pages=[]; C.i=0; C.n=0; C.nombre=(file.name||'marcas').replace(/\.[^.]+$/,'');
  $('cropMsg').textContent='Abriendo…'; $('dlgCrop').showModal();
  if(file.type==='application/pdf'){
    const lib=await pdfjs();
    const doc=await lib.getDocument({data:await file.arrayBuffer()}).promise;
    for(let p=1;p<=doc.numPages;p++) C.pages.push({doc,p});
  } else {
    const url=URL.createObjectURL(file);
    const img=await new Promise((ok,mal)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=()=>mal(new Error('imagen inválida')); i.src=url; });
    const cv=document.createElement('canvas'); const k=Math.min(1,2200/img.naturalWidth); cv.width=img.naturalWidth*k; cv.height=img.naturalHeight*k;
    const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height); c.drawImage(img,0,0,cv.width,cv.height);
    C.pages.push({cv});
  }
  await mostrarPagina(0);
}
async function mostrarPagina(i){
  C.i=i; const pg=C.pages[i];
  if(!pg.cv){
    const page=await pg.doc.getPage(pg.p); const vp0=page.getViewport({scale:1}); const scale=1700/vp0.width; const vp=page.getViewport({scale});
    const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
    const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height);
    await page.render({canvasContext:c, viewport:vp}).promise; pg.cv=cv;
  }
  C.src=pg.cv; C.rect={x:0.04*C.src.width, y:0.04*C.src.height, w:0.92*C.src.width, h:0.4*C.src.height};
  $('cropPages').classList.toggle('hide', C.pages.length<2);
  $('cropPg').textContent=(i+1)+' / '+C.pages.length;
  $('cropMsg').textContent = C.n ? C.n+' recorte(s) agregado(s). Podés agregar otro o tocar Listo.' : '';
  dibujarCrop();
}
function dibujarCrop(){
  const cv=$('cropCv'), s=C.src; cv.width=s.width; cv.height=s.height;
  const c=cv.getContext('2d'); c.drawImage(s,0,0);
  const r=C.rect; c.fillStyle='rgba(0,0,0,.45)';
  c.fillRect(0,0,s.width,r.y); c.fillRect(0,r.y+r.h,s.width,s.height-r.y-r.h); c.fillRect(0,r.y,r.x,r.h); c.fillRect(r.x+r.w,r.y,s.width-r.x-r.w,r.h);
  const lw=Math.max(3,s.width/300); c.strokeStyle='#1fa855'; c.lineWidth=lw; c.strokeRect(r.x,r.y,r.w,r.h);
  c.fillStyle='#1fa855'; const hs=lw*5;
  [[r.x+r.w/2,r.y],[r.x+r.w/2,r.y+r.h],[r.x,r.y+r.h/2],[r.x+r.w,r.y+r.h/2]].forEach(([x,y])=>{ c.beginPath(); c.arc(x,y,hs,0,7); c.fill(); });
}
function ptCrop(e){ const cv=$('cropCv'), b=cv.getBoundingClientRect(), k=cv.width/b.width; return {x:(e.clientX-b.left)*k, y:(e.clientY-b.top)*k, k}; }
$('cropCv').addEventListener('pointerdown',e=>{
  const p=ptCrop(e), r=C.rect, tol=28*p.k;
  const near=(a,b)=>Math.abs(a-b)<tol;
  const inX=p.x>r.x-tol && p.x<r.x+r.w+tol, inY=p.y>r.y-tol && p.y<r.y+r.h+tol;
  let m=null;
  if(inX && near(p.y,r.y)) m='t'; else if(inX && near(p.y,r.y+r.h)) m='b';
  else if(inY && near(p.x,r.x)) m='l'; else if(inY && near(p.x,r.x+r.w)) m='r';
  else if(p.x>r.x && p.x<r.x+r.w && p.y>r.y && p.y<r.y+r.h) m='m';
  else m='n';
  C.drag={m, p0:p, r0:{...r}}; $('cropCv').setPointerCapture(e.pointerId); e.preventDefault();
});
$('cropCv').addEventListener('pointermove',e=>{
  if(!C.drag) return; const p=ptCrop(e), d=C.drag, r0=d.r0, W=C.src.width, H=C.src.height, dx=p.x-d.p0.x, dy=p.y-d.p0.y, min=40;
  let {x,y,w,h}=r0;
  if(d.m==='t'){ y=Math.min(Math.max(0,r0.y+dy), r0.y+r0.h-min); h=r0.y+r0.h-y; }
  if(d.m==='b'){ h=Math.max(min, Math.min(H-r0.y, r0.h+dy)); }
  if(d.m==='l'){ x=Math.min(Math.max(0,r0.x+dx), r0.x+r0.w-min); w=r0.x+r0.w-x; }
  if(d.m==='r'){ w=Math.max(min, Math.min(W-r0.x, r0.w+dx)); }
  if(d.m==='m'){ x=Math.min(Math.max(0,r0.x+dx), W-r0.w); y=Math.min(Math.max(0,r0.y+dy), H-r0.h); }
  if(d.m==='n'){ x=Math.max(0,Math.min(d.p0.x,p.x)); y=Math.max(0,Math.min(d.p0.y,p.y)); w=Math.max(min,Math.abs(dx)); h=Math.max(min,Math.abs(dy)); w=Math.min(w,W-x); h=Math.min(h,H-y); }
  C.rect={x,y,w,h}; dibujarCrop();
});
['pointerup','pointercancel'].forEach(ev=>$('cropCv').addEventListener(ev,()=>{ C.drag=null; }));
$('cropPrev').addEventListener('click',()=>{ if(C.i>0) mostrarPagina(C.i-1); });
$('cropNext').addEventListener('click',()=>{ if(C.i<C.pages.length-1) mostrarPagina(C.i+1); });
async function agregarRecorte(entera){
  const r = entera ? {x:0,y:0,w:C.src.width,h:C.src.height} : C.rect;
  const cv=document.createElement('canvas'); cv.width=Math.round(r.w); cv.height=Math.round(r.h);
  const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height); c.drawImage(C.src, r.x,r.y,r.w,r.h, 0,0,cv.width,cv.height);
  $('cropMsg').textContent='Subiendo…';
  try{
    const j=await aJpeg(cv, 2400, 0.88);
    await agregarAdj(j, C.nombre+(C.n?'-'+(C.n+1):'')+'.jpg', 'image/jpeg', 'marca', {fw:+(r.w/C.src.width).toFixed(4)});
    C.n++; $('cropMsg').textContent=C.n+' recorte(s) agregado(s). Podés agregar otro o tocar Listo.';
  }catch(e){ $('cropMsg').textContent='No se pudo subir'+(e&&e.code==='token'?': renová el permiso de Google.':'.'); }
}
$('cropAdd').addEventListener('click',()=>agregarRecorte(false));
$('cropAll').addEventListener('click',()=>agregarRecorte(true));
$('cropDone').addEventListener('click',()=>$('dlgCrop').close());

/* ---------------- PDF de fin de mes ---------------- */
let _pdflib=null;
async function pdflib(){ if(!_pdflib) _pdflib=cargarScript('lib/pdf-lib.min.js').then(()=>PDFLib); return _pdflib; }
const A4=[595.28, 841.89];
// texto seguro para las fuentes estándar (WinAnsi)
const txt = s => String(s==null?'':s).replace(/[^\x20-\x7E -ÿ]/g,'');

async function bloque(pdf, tipo, lista, F){
  const {rgb}=PDFLib, negro=rgb(0,0,0);
  const nombre=R.datos.nombre||'';
  /* --- 1) planilla --- */
  const filasPorHoja=28;
  for(let ini=0; ini===0 || ini<lista.length; ini+=filasPorHoja){
    const pg=pdf.addPage(A4), H=A4[1];
    const Y=y=>H-y; // coordenadas desde arriba, como en la planilla original
    pg.drawText('planillas viáticos',{x:167,y:Y(57),size:9.5,font:F.bi});
    pg.drawText(txt('Viáticos '+tipo),{x:316,y:Y(57),size:8,font:F.r});
    pg.drawText('NOMBRE',{x:188,y:Y(78),size:9.5,font:F.bi});
    pg.drawText(txt(nombre),{x:250,y:Y(78),size:9,font:F.r});
    pg.drawLine({start:{x:247,y:Y(81)},end:{x:470,y:Y(81)},thickness:.6,color:negro});
    const cols=[57,173,246,313,393,468,527];
    const cab=[['a','localidad'],['fecha','comienzo'],['hora','comienzo'],['fecha','Finalizacion'],['hora','Finalizacion'],['locomoc','$']];
    const box=(x1,y1,x2,y2,w)=>pg.drawRectangle({x:x1,y:Y(y2),width:x2-x1,height:y2-y1,borderColor:negro,borderWidth:w||.7});
    const centro=(s,x1,x2,y,size,font)=>{ s=txt(s); const w=font.widthOfTextAtSize(s,size); pg.drawText(s,{x:(x1+x2)/2-w/2,y:Y(y),size,font}); };
    box(cols[0],95,cols[6],128,.9);
    for(let c=1;c<6;c++) pg.drawLine({start:{x:cols[c],y:Y(95)},end:{x:cols[c],y:Y(128)},thickness:.7,color:negro});
    cab.forEach((t,c)=>{ centro(t[0],cols[c],cols[c+1],107,9,F.b); centro(t[1],cols[c],cols[c+1],124,9,F.b); });
    const filas=lista.slice(ini,ini+filasPorHoja), nFilas=Math.max(10, filas.length);
    for(let i=0;i<nFilas;i++){
      const y1=168+i*25.6, y2=y1+14;
      box(cols[0],y1,cols[6],y2,.7);
      for(let c=1;c<6;c++) pg.drawLine({start:{x:cols[c],y:Y(y1)},end:{x:cols[c],y:Y(y2)},thickness:.7,color:negro});
      const v=filas[i]; if(!v) continue;
      const vals=[v.localidad, fDMY(v.fIni), v.hIni, fDMY(v.fFin), v.hFin, String(+v.loco||0)];
      vals.forEach((s,c)=>centro(s||'',cols[c],cols[c+1],y2-3.5,c===5?7.5:8.5,F.r));
    }
    if(lista.length<=filasPorHoja) break;
  }
  /* --- 2) marcas de la intranet --- */
  const M=36, ancho=A4[0]-2*M;
  let pg=null, y=0;
  const nuevaHoja=()=>{ pg=pdf.addPage(A4); pg.drawText(tipo,{x:12,y:A4[1]-16,size:7,font:F.r}); y=A4[1]-40; };
  const hayMarcas = lista.some(v=>(v.adj||[]).some(a=>a.clase==='marca'));
  if(lista.length){
    nuevaHoja();
    for(const v of lista){
      const marcas=(v.adj||[]).filter(a=>a.clase==='marca');
      for(const a of marcas){
        let img; try{ const b=await bajar(a.drive); const bytes=new Uint8Array(await b.arrayBuffer()); img = a.mime==='image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); }catch(e){ continue; }
        let w=Math.min(ancho, (a.fw||1)*A4[0]*0.97), h=img.height*w/img.width;
        if(h>A4[1]-80){ h=A4[1]-80; w=img.width*h/img.height; }
        if(y-h<50) nuevaHoja();
        pg.drawImage(img,{x:M,y:y-h,width:w,height:h}); y-=h+14;
      }
      if(y<90) nuevaHoja();
      pg.drawText(txt('Salida:    '+fDM(v.fIni)+' Hora '+(v.hIni||'--:--')),{x:M+4,y:y-6,size:9,font:F.r});
      pg.drawText(txt('Llegada: '+(v.fFin?fDM(v.fFin):'--/--')+' Hora '+(v.hFin||'--:--')),{x:M+4,y:y-26,size:9,font:F.r});
      y-= hayMarcas ? 70 : 46;
    }
  }
  /* --- 3) comprobantes --- */
  for(const v of lista){
    for(const a of (v.adj||[]).filter(a=>a.clase==='comp')){
      let b; try{ b=await bajar(a.drive); }catch(e){ continue; }
      const bytes=new Uint8Array(await b.arrayBuffer());
      const encajar=(w0,h0)=>{ const mw=A4[0]-48, mh=A4[1]-60, k=Math.min(mw/w0, mh/h0, 1.6); return {w:w0*k, h:h0*k}; };
      if(a.mime==='application/pdf'){
        let src; try{ src=await PDFLib.PDFDocument.load(bytes,{ignoreEncryption:true}); }catch(e){ continue; }
        const emb=await pdf.embedPages(src.getPages());
        for(const ep of emb){ const p=pdf.addPage(A4); p.drawText(tipo,{x:12,y:A4[1]-16,size:7,font:F.r}); const {w,h}=encajar(ep.width,ep.height); p.drawPage(ep,{x:(A4[0]-w)/2,y:A4[1]-30-h,width:w,height:h}); }
      } else {
        let img; try{ img = a.mime==='image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); }catch(e){ continue; }
        const p=pdf.addPage(A4); p.drawText(tipo,{x:12,y:A4[1]-16,size:7,font:F.r});
        const {w,h}=encajar(img.width*0.75,img.height*0.75); p.drawImage(img,{x:(A4[0]-w)/2,y:A4[1]-30-h,width:w,height:h});
      }
    }
  }
}
async function nuevoPDF(){
  const L=await pdflib(); const pdf=await L.PDFDocument.create();
  const F={r:await pdf.embedFont(L.StandardFonts.Helvetica), b:await pdf.embedFont(L.StandardFonts.HelveticaBold), bi:await pdf.embedFont(L.StandardFonts.HelveticaBoldOblique)};
  return {pdf,F};
}
async function generarPDF(){
  const out=$('regPdfOut'); out.innerHTML='<p class="note">Generando PDF…</p>';
  try{
    const lista=delMes(R.mes), c100=lista.filter(v=>v.tipo==='C100'), c200=lista.filter(v=>v.tipo==='C200');
    if(!lista.length){ out.innerHTML='<p class="note">No hay viáticos en '+mesNombre(R.mes)+'.</p>'; return; }
    const sinTerminar=lista.filter(v=>!v.fFin||!v.hFin).length;
    if(lista.some(v=>(v.adj||[]).length)) await asegurarToken().catch(()=>{});
    const mm=R.mes.slice(5,7)+'-'+R.mes.slice(2,4), res=[];
    if(c100.length){
      const {pdf,F}=await nuevoPDF(); await bloque(pdf,'C100',c100,F);
      res.push({nombre:'Planilla_VIÁTICOS_C100_'+mm+'.pdf', bytes:await pdf.save(), desc: c200.length?'Solo C100':'C100'});
    }
    if(c200.length){
      const {pdf,F}=await nuevoPDF();
      if(c100.length) await bloque(pdf,'C100',c100,F);
      await bloque(pdf,'C200',c200,F);
      res.push({nombre:'Planilla_VIÁTICOS_'+mm+'.pdf', bytes:await pdf.save(), desc: c100.length?'C100 + C200':'C200'});
    }
    out.innerHTML='<div class="pdfout">'+(sinTerminar?'<p class="hint bad" style="margin:0">Ojo: '+sinTerminar+' viático(s) sin fecha u hora de finalización.</p>':'')+res.map((r,i)=>{
      const url=URL.createObjectURL(new Blob([r.bytes],{type:'application/pdf'}));
      return '<div><div class="note" style="margin-bottom:4px"><b>'+esc(r.desc)+'</b> · '+esc(r.nombre)+'</div><div class="row">'+
        '<a class="btn pri" href="'+url+'" download="'+esc(r.nombre)+'">Descargar</a>'+
        '<button class="btn ghost" type="button" data-share="'+i+'">Compartir</button></div></div>';
    }).join('')+'</div>';
    out.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',async()=>{
      const r=res[+b.dataset.share]; const file=new File([r.bytes],r.nombre,{type:'application/pdf'});
      try{
        if(navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file], title:r.nombre});
        else toast('Este navegador no permite compartir archivos: usá Descargar');
      }catch(e){}
    }));
  }catch(e){ out.innerHTML='<p class="hint bad">No se pudo generar el PDF: '+esc(e.message||e.code||e)+'</p>'; }
}

/* ---------------- desde la calculadora ---------------- */
function desdeCalculadora(){
  const r=compute();
  document.querySelector('nav button[data-tab="reg"]').click();
  if(!conectado()){ toast('Iniciá sesión con Google para guardar tus viáticos'); return; }
  const t = tipo==='C100' ? 'C100' : 'C200';
  // si hay un viático sin terminar, se completa ese
  const abierto = r.salFic!=null ? viaticos().filter(v=>!v.hFin && v.tipo===t).sort((a,b)=>(b.fIni+b.hIni).localeCompare(a.fIni+a.hIni))[0] : null;
  if(abierto){
    abrirEditor(abierto);
    $('vFFin').value=isoHoy(); $('vHFin').value=hhmm(r.salFic);
    if(r.ls){ opcionesLoc($('vCSalLoc'), r.ls.id); } $('vCSal').value=P.marcaSal;
    toast('Completando el viático del '+fDM(abierto.fIni));
    return;
  }
  const dosDias = tipo==='C200_2';
  const v={id:uid(), tipo:t, localidad: r.le?corto(r.le.localidad):'', loco:0, adj:[],
    fIni: dosDias && r.salFic!=null ? isoHoy(-1) : isoHoy(),
    hIni: r.entFic!=null ? hhmm(r.entFic) : '',
    fFin: dosDias && r.salFic==null ? isoHoy(1) : isoHoy(),
    hFin: r.salFic!=null ? hhmm(r.salFic) : '',
    cEntLoc: r.le?r.le.id:'', cEnt:P.marcaEnt, cSalLoc: r.ls?r.ls.id:'', cSal:P.marcaSal};
  abrirEditor(v);
}

/* ---------------- eventos ---------------- */
$('regLogin').addEventListener('click',iniciarSesion);
$('regLogout').addEventListener('click',cerrarSesion);
$('regSync').addEventListener('click',()=>{ if(tokenOk()) sincronizar(true); else pedirToken('').then(()=>sincronizar(true)).catch(()=>toast('No se pudo renovar el permiso de Google')); });
$('regNombre').addEventListener('change',()=>{ R.datos.nombre=$('regNombre').value.trim(); R.datos.nombreT=Date.now(); cambio(); });
$('mesPrev').addEventListener('click',()=>{ const [y,m]=R.mes.split('-').map(Number); const d=new Date(y,m-2,1); R.mes=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); $('regPdfOut').innerHTML=''; pintar(); });
$('mesNext').addEventListener('click',()=>{ const [y,m]=R.mes.split('-').map(Number); const d=new Date(y,m,1); R.mes=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); $('regPdfOut').innerHTML=''; pintar(); });
$('regLista').addEventListener('click',e=>{ const it=e.target.closest('.vit'); if(it) abrirEditor(R.datos.v[it.dataset.id]); });
$('regNuevo').addEventListener('click',()=>abrirEditor(null));
$('regPdf').addEventListener('click',generarPDF);
$('btnGuardarReg').addEventListener('click',desdeCalculadora);
document.addEventListener('tab',e=>{ if(e.detail==='reg'){ pintar(); if(conectado() && tokenOk()) sincronizar(false); } });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && conectado() && tokenOk()) sincronizar(false); });
window.addEventListener('online',()=>{ if(conectado() && R.pend) sincronizar(false); });
pintar();
// para pruebas
window.__viaticos={R, generarPDF, bloque, nuevoPDF, fusionar};
})();

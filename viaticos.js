/* Hora Salida · Mis viáticos
   Registro mensual de viáticos en el Google Drive de cada persona (carpeta "Hora Salida"),
   con marcas de la intranet (recortadas) y comprobantes, y PDF de fin de mes.
   Permiso drive.file: la app solo ve los archivos que ella misma crea. */
(function(){
'use strict';
try{
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
// locomoción: cuenta en C100 y C200 · alojamiento: solo en C100 (en C200 queda guardado pero no va al PDF)
const claseDe = a => a.clase==='comp' ? 'loco' : a.clase;
const tieneLoco = v => v.tLoco!=null ? !!v.tLoco : (+v.loco>0 || (v.adj||[]).some(a=>a.clase==='comp'));
const alojCuenta = v => v.tipo==='C100' && !!v.tAloj;
// locomociones: lista de {id, tramo:'ida'|'vuelta', f, monto}; las viejas (un solo monto) cuentan como ida
const locosDe = v => Array.isArray(v.locos) ? v.locos : ((+v.loco>0 || (v.adj||[]).some(a=>claseDe(a)==='loco')) ? [{id:'l0', tramo:'ida', f:v.fIni, monto:+v.loco||0}] : []);
const sumaLoco = (v,tr) => tieneLoco(v) ? locosDe(v).filter(l=>!tr || (tr==='vuelta') === (l.tramo==='vuelta')).reduce((s,l)=>s+(+l.monto||0),0) : 0;
const montoLoco = v => sumaLoco(v);
const alojsDe = v => Array.isArray(v.alojs) ? v.alojs : ((+v.aloj>0 || (v.adj||[]).some(a=>a.clase==='aloj')) ? [{id:'a0', f:v.fIni, monto:+v.aloj||0}] : []);
const montoAloj = v => alojCuenta(v) ? alojsDe(v).reduce((s,a)=>s+(+a.monto||0),0) : 0;
const ordenAdj = (v,a) => { if(claseDe(a)!=='loco'){ const i=alojsDe(v).findIndex(x=>x.id===a.item); return 1000+(i<0?0:i); } const ls=locosDe(v); const i=ls.findIndex(l=>l.id===a.item); const l=ls[i]; return (l&&l.tramo==='vuelta'?500:0)+(i<0?0:i); };
const compsPDF = v => (v.adj||[]).filter(a => (claseDe(a)==='loco' && tieneLoco(v)) || (a.clase==='aloj' && alojCuenta(v)))
  .sort((a,b)=>ordenAdj(v,a)-ordenAdj(v,b));
const pesos = n => '$'+(+n).toLocaleString('es-UY');
// marcas intermedias: solo C100 (en C200 quedan guardadas pero no van a la planilla)
const interCuenta = v => v.tipo==='C100' && !!v.tInter && (v.inter||[]).some(p=>p.h);
// nombre corto de la localidad de la marca de salida
function locSalida(v){ const l=v.cSalLoc&&!String(v.cSalLoc).startsWith('otra:')?byId(v.cSalLoc):null; return l?corto(l.localidad):''; }
function interOrdenadas(v){ return (v.inter||[]).filter(p=>p.h).sort((a,b)=>((a.f||'')+a.h).localeCompare((b.f||'')+b.h)); }
// Renglones de la planilla.
// C100 en varias ciudades: un renglón por ciudad (termina en la última marca hecha ahí; el siguiente la repite).
// C100 en una sola ciudad con marcas intermedias: comienzo → marcas → finalización, todas en algún renglón:
//   · Cada renglón va de un nodo al siguiente y lleva la localidad de la marca donde termina.
//   · Dos marcas del mismo día y la misma localidad van juntas en un renglón (no se repiten).
//   · Si cambia la localidad, o una marca queda sola, se repite: cierra un renglón y abre el siguiente.
//   · Sin marcas intermedias y en una sola localidad: un solo renglón.
function renglones(v){
  const ini={loc:v.localidad,f:v.fIni,h:v.hIni}, fin={loc:locSalida(v)||v.localidad,f:v.fFin,h:v.hFin};
  const inter = interCuenta(v) ? interOrdenadas(v).map(p=>({loc:p.loc||v.localidad, f:p.f||v.fIni, h:p.h})) : [];
  const lugares=new Set([ini.loc, fin.loc, ...inter.map(p=>p.loc)].map(x=>norm(x||'')));
  const varias = v.tipo==='C100' && !!v.cEnt && lugares.size>1;
  if(!varias && !inter.length) return formatear(v, [[ini,fin]]);
  const marcas=[...(varias?[{loc:v.localidad,f:v.fIni,h:v.cEnt}]:[]), ...inter].sort((a,b)=>((a.f||'')+a.h).localeCompare((b.f||'')+b.h));
  if(varias){
    // Varias ciudades: un renglón por ciudad, en el orden del recorrido. Cada renglón termina en la última marca
    // hecha en esa ciudad (aunque sea al otro día, donde se pasó la noche) y el siguiente empieza repitiendo esa marca.
    const tramos=[]; const add=(loc,fin2)=>{ const u=tramos[tramos.length-1]; if(u && norm(u.loc||'')===norm(loc||'')) u.fin=fin2; else tramos.push({loc,fin:fin2}); };
    for(const m of marcas) add(m.loc, {f:m.f,h:m.h});
    add(fin.loc, {f:fin.f,h:fin.h});
    let desde={f:ini.f,h:ini.h};
    return formatear(v, tramos.map(t=>{ const par=[{loc:t.loc,...desde}, t.fin]; desde=t.fin; return par; }));
  }
  const n=[ini, ...marcas, fin], N=n.length;
  const mismoDia=(x,y)=>x&&y&&(x.f||'')===(y.f||''), mismoLugar=(x,y)=>x&&y&&norm(x.loc||'')===norm(y.loc||'');
  const restanDia=k=>{ let c=0; for(let t=k;t<N && mismoDia(n[t],n[k]);t++) c++; return c; };
  const pares=[]; let i=0;
  while(i<N-1){
    const a=n[i], b=n[i+1]; pares.push([{loc:b.loc,f:a.f,h:a.h}, b]);
    const c=n[i+2];
    i = (c && mismoLugar(b,c) && restanDia(i+2)>=2 && (mismoDia(b,c) || mismoDia(a,b))) ? i+2 : i+1;
  }
  return formatear(v, pares);
}
function formatear(v, pares){
  const alo=alojEnRenglones(v,pares);
  return pares.map(([a,b],k)=>{
    const lc = pares.length===1 ? montoLoco(v) : k===0 ? sumaLoco(v,'ida') : (k===pares.length-1 ? sumaLoco(v,'vuelta') : 0);
    return [a.loc, fDMY(a.f), a.h, fDMY(b.f), b.h, String(lc), String(alo[k])];
  });
}
function alojEnRenglones(v, pares){
  const n=pares.length, out=new Array(n).fill(0);
  if(!alojCuenta(v)) return out;
  const al=alojsDe(v).filter(a=>+a.monto>0); if(!al.length) return out;
  if(n===1){ out[0]=al.reduce((s,a)=>s+(+a.monto),0); return out; }
  const medio=Math.floor((n-1)/2);
  const porDia=f=>{ let k=pares.findIndex(([a])=>a.f===f); if(k<0) k=pares.findIndex(([,b])=>b.f===f); return k; };
  for(const a of al){
    let k = (al.length===1 && n%2===1) ? medio : porDia(a.f);
    if(k<0) k=medio;
    out[k]+=(+a.monto);
  }
  return out;
}
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
  out.marcasMes={...(a.marcasMes||{})};
  for(const [m,x] of Object.entries(b.marcasMes||{})) if(!out.marcasMes[m] || (x.t||0)>(out.marcasMes[m].t||0)) out.marcasMes[m]=x;
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
  const err=$('regLoginErr'), btn=$('regLogin');
  err.textContent='';
  if(!enWeb()){ err.textContent='Google funciona cuando abrís la app desde su dirección web.'; return; }
  if(!(window.google && google.accounts && google.accounts.oauth2)){
    // Google todavía no cargó: se carga y se pide tocar de nuevo (el navegador solo abre la ventana de Google con un toque)
    btn.textContent='Cargando Google…'; btn.disabled=true;
    try{ await cargarGIS(); btn.textContent='Tocá de nuevo para iniciar sesión'; }
    catch(e){ btn.textContent='Iniciar sesión con Google'; err.textContent='No se pudo cargar Google. Revisá la conexión.'; }
    btn.disabled=false; return;
  }
  btn.textContent='Abriendo Google…';
  try{
    await pedirToken('');
    try{ const j=await (await gapi('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')).json();
         if(j.user){ LS.set(K.email,j.user.emailAddress||''); if(!R.datos.nombre && j.user.displayName){ R.datos.nombre=j.user.displayName; R.datos.nombreT=Date.now(); } } }catch(e){}
    LS.set(K.con,'1'); pintar(); await sincronizar(true);
  }catch(e){
    const t=(e&&(e.type||e.error))||'';
    err.textContent = e && e.code==='sin_google' ? 'No se pudo cargar Google. Revisá la conexión.'
      : /popup_failed_to_open/.test(t) ? 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio y probá de nuevo.'
      : /popup_closed/.test(t) ? 'Se cerró la ventana de Google antes de terminar.'
      : /access_denied/.test(t) ? 'No se dio el permiso de Drive.'
      : 'No se pudo iniciar sesión con Google'+(t?' ('+t+')':'')+'.';
  }finally{ btn.textContent='Iniciar sesión con Google'; }
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
/* ---------------- control de reglas ---------------- */
function horasCumplidas(v){
  const a=toMin(v.hIni), b=toMin(v.hFin); if(a==null||b==null) return null;
  let t=b-a; if(t<0) t+=1440; return t; // en varios días: horas del día de la vuelta desde la hora de comienzo
}
function horasRequeridas(v){ return toMin(v.tipo==='C100' ? req.C100 : (v.fFin && v.fFin!==v.fIni ? req.C200_2 : req.C200_1)); }
function problemas(v, todos){
  const p=[];
  if(!v.localidad) p.push('Falta la localidad');
  if(!v.hIni) p.push('Falta la marca de entrada');
  if(!v.fFin || !v.hFin) p.push('Sin terminar: falta la marca de salida');
  if(v.fFin && v.fFin<v.fIni) p.push('La finalización es anterior al comienzo');
  const t=horasCumplidas(v), need=horasRequeridas(v);
  if(t!=null && v.fFin && need!=null && t<need) p.push('Horas: '+dur(t)+' de '+dur(need)+' (faltan '+dur(need-t)+')');
  if(v.tipo==='C100' && v.tInter && (v.inter||[]).some(x=>!x.h)) p.push('Marca intermedia sin hora');
  const sinComp = it => !(v.adj||[]).some(a=>a.item===it.id);
  if(tieneLoco(v)){
    const ls=locosDe(v);
    if(!ls.length) p.push('Locomoción tildada sin cargar');
    if(ls.some(l=>!(+l.monto>0))) p.push('Locomoción sin monto');
    if(Array.isArray(v.locos) && ls.some(sinComp)) p.push('Locomoción sin comprobante');
  }
  if(alojCuenta(v)){
    const al=alojsDe(v);
    if(!al.length) p.push('Alojamiento tildado sin cargar');
    if(al.some(a=>!(+a.monto>0))) p.push('Alojamiento sin monto');
    if(Array.isArray(v.alojs) && al.some(sinComp)) p.push('Alojamiento sin comprobante');
  }
  const fin=v.fFin||v.fIni;
  const choca=(todos||[]).find(o=>o.id!==v.id && o.fIni && o.fIni<=fin && (o.fFin||o.fIni)>=v.fIni);
  if(choca) p.push('Se superpone con '+(choca.localidad||'otro viático')+' del '+fDM(choca.fIni));
  for(const x of (R.chk||{})[v.id]||[]) p.push('Intranet: '+x);
  return p;
}

function pintar(){
  const on=conectado();
  $('regOff').classList.toggle('hide',on); $('regOn').classList.toggle('hide',!on);
  if(!on) return;
  pintarEstado();
  if(document.activeElement!==$('regNombre')) $('regNombre').value=R.datos.nombre||'';
  $('mesTxt').textContent=mesNombre(R.mes);
  const lista=delMes(R.mes), todos=viaticos();
  const probs={}; lista.forEach(v=>probs[v.id]=problemas(v,todos));
  const mal=lista.filter(v=>probs[v.id].length).length;
  const grupo=t=>{
    const l=lista.filter(v=>v.tipo===t); if(!l.length) return '';
    const loco=l.reduce((s,v)=>s+montoLoco(v),0), aloj=l.reduce((s,v)=>s+montoAloj(v),0);
    const tot=[loco?'Locom. '+pesos(loco):'', aloj?'Aloj. '+pesos(aloj):''].filter(Boolean).join(' · ');
    return '<div class="vgrp"><span>'+t+' · '+l.length+'</span>'+(tot?'<span>'+tot+'</span>':'')+'</div>'+l.map(v=>{
      const nm=0, nc=compsPDF(v).length;
      const fin = v.fFin&&v.hFin ? fDM(v.fFin)+' '+v.hFin : '<span class="open">sin terminar</span>';
      const pr=probs[v.id];
      return '<div class="vit'+(pr.length?' rev':'')+'" data-id="'+esc(v.id)+'"><div class="t1">'+(pr.length?'<span class="est mal">!</span>':'<span class="est ok">✓</span>')+esc(v.localidad||'—')+'</div><div class="t2">'+fDM(v.fIni)+' '+esc(v.hIni||'--:--')+' → '+fin+
        (nm||nc?' · '+(nm?'🕒'+nm+' ':'')+(nc?'🧾'+nc:''):'')+(v.auto&&v.auto.length?' · 🔄 intranet':'')+(interCuenta(v)?' · +'+(v.inter||[]).filter(p=>p.h).length+' marcas':'')+(montoLoco(v)?' · 🚌'+pesos(montoLoco(v)):'')+(montoAloj(v)?' · 🛏'+pesos(montoAloj(v)):'')+'</div>'+
        (pr.length?'<ul class="probs">'+pr.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+'</div>';
    }).join('');
  };
  pintarMarcasMes();
  const resumen = lista.length ? '<div class="resumen '+(mal?'mal':'ok')+'">'+(mal ? '⚠️ '+mal+' de '+lista.length+' viático(s) para revisar' : '✓ Los '+lista.length+' viáticos del mes están completos')+'</div>' : '';
  $('regLista').innerHTML = (resumen+grupo('C100')+grupo('C200')) || '<p class="note" style="padding:6px 2px">No hay viáticos en '+mesNombre(R.mes)+'.</p>';
}

/* ---------------- editor ---------------- */
// pares Departamento → Localidad (salida e intermedias), igual que la entrada
function depDe(sel){ return sel.id==='vCSalLoc' ? $('vSalDep') : sel.closest('.irow').querySelector('.idep'); }
function llenarLocs(sel, dep, id){
  const lista=locs.filter(l=>l.departamento===dep).sort((a,b)=>cmp(a.localidad,b.localidad));
  sel.innerHTML = dep ? (lista.length>1?'<option value="">Elegí…</option>':'')+lista.map(l=>'<option value="'+esc(l.id)+'"'+(l.id===id?' selected':'')+'>'+esc(l.localidad)+'</option>').join('') : '<option value="">—</option>';
  sel.disabled=!dep;
}
function opcionesLoc(sel, id){
  const l=id?byId(id):null, dep=l?l.departamento:'', ds=depDe(sel);
  const deps=[...new Set(locs.map(x=>x.departamento))].sort(cmp);
  ds.innerHTML='<option value="">Elegí…</option>'+deps.map(d=>'<option'+(d===dep?' selected':'')+'>'+esc(d)+'</option>').join('');
  llenarLocs(sel, dep, l?l.id:'');
}
function pintarInter(){
  R.ed._ip=true;
  const c100=R.ed.tipo==='C100', on=$('vTInter').checked;
  $('vInterChk').classList.toggle('hide',!c100);
  $('vInterBox').classList.toggle('hide',!(c100&&on));
  $('vInterC200').classList.toggle('hide', c100 || !(R.ed.inter||[]).length);
  $('vInter').innerHTML = (R.ed.inter||[]).map((p,i)=>'<div class="irow" data-i="'+i+'"><label>'+(i+1)+'ª marca intermedia</label><div class="g2"><select class="idep" aria-label="Departamento"></select><select class="iloc" aria-label="Localidad"></select></div>'+
    '<div class="g">'+selDia('if',p.f)+'<input class="ih" type="time" value="'+esc(p.h||'')+'"><button type="button" class="x" aria-label="Quitar">×</button></div></div>').join('')
    || '<p class="note" style="margin:0 0 8px">Todavía no hay marcas intermedias.</p>';
  $('vInter').querySelectorAll('.irow').forEach(row=>{
    const p=R.ed.inter[+row.dataset.i]; const sel=row.querySelector('.iloc');
    const l=locs.find(x=>norm(corto(x.localidad))===norm(p.loc||'')); opcionesLoc(sel, l?l.id:'');
    if(p.loc && !l){ sel.innerHTML='<option value="otra:'+esc(p.loc)+'" selected>'+esc(p.loc)+'</option>'; sel.disabled=false; }
  });
}
function leerInter(){
  if(!R.ed._ip) return;
  R.ed.inter=[...$('vInter').querySelectorAll('.irow')].map(row=>{
    const v=row.querySelector('.iloc').value; const l=v&&!v.startsWith('otra:')?byId(v):null;
    return {loc: l?corto(l.localidad):(v.startsWith('otra:')?v.slice(5):''), f:row.querySelector('.if').value, h:row.querySelector('.ih').value};
  });
}
$('vTInter').addEventListener('change',()=>{ leerInter(); if($('vTInter').checked && !(R.ed.inter||[]).length) R.ed.inter=[{loc:locDeSel(), f:$('vFIni').value, h:''}]; pintarInter(); });
$('vInterAdd').addEventListener('click',()=>{ leerInter(); const u=R.ed.inter[R.ed.inter.length-1]; R.ed.inter.push({loc:u?u.loc:locDeSel(), f:u?u.f:$('vFIni').value, h:''}); pintarInter(); });
$('vInter').addEventListener('change',e=>{ if(e.target.classList.contains('idep')) llenarLocs(e.target.closest('.irow').querySelector('.iloc'), e.target.value, ''); });
$('vSalDep').addEventListener('change',e=>{ llenarLocs($('vCSalLoc'), e.target.value, ''); calcEditor(); });
$('vInter').addEventListener('click',e=>{ const x=e.target.closest('.x'); if(!x) return; leerInter(); R.ed.inter.splice(+x.closest('.irow').dataset.i,1); pintarInter(); });
function pintarTipo(){
  document.querySelectorAll('#vTipo button').forEach(b=>b.classList.toggle('on',b.dataset.t===R.ed.tipo));
  $('vAlojC200').classList.toggle('hide', R.ed.tipo!=='C200');
  if($('vInter')) { leerInter(); pintarInter(); }
}
function pintarAdj(){
  const item=a=>'<div class="adj" data-a="'+esc(a.id)+'"><div class="th" id="th_'+esc(a.id)+'">'+(a.mime==='application/pdf'?'PDF':'…')+'</div><div class="nm">'+esc(a.nombre||'')+'</div><button type="button" class="x" data-x="'+esc(a.id)+'" aria-label="Quitar">×</button></div>';
  const adj=R.ed.adj||[];
  // el recuadro "Subir comprobante" se ve solo mientras no haya ninguno cargado
  const porItem=(sel, attr, filtro)=>document.querySelectorAll(sel).forEach(el=>{
    const id=el.dataset[attr], l=adj.filter(a=>filtro(a) && a.item===id);
    el.innerHTML=l.map(item).join(''); el.classList.toggle('hide',!l.length);
    const d=el.parentNode.querySelector('.drop'); if(d) d.classList.toggle('hide',!!l.length);
  });
  porItem('#vLocos [data-lc]','lc',a=>claseDe(a)==='loco');
  porItem('#vAlojs [data-ac]','ac',a=>a.clase==='aloj');
  adj.forEach(async a=>{
    if(a.mime==='application/pdf') return;
    try{ const b=a._blob || await bajar(a.drive); const el=document.getElementById('th_'+a.id); if(el){ el.style.backgroundImage='url('+URL.createObjectURL(b)+')'; el.textContent=''; } }catch(e){}
  });
}
function abrirEditor(v){
  const nuevo=!v || !R.datos.v[v.id];
  R.ed = JSON.parse(JSON.stringify(v || {id:uid(), tipo:'C200', localidad:'', fIni:isoHoy(), hIni:'', fFin:isoHoy(), hFin:'', loco:0, aloj:0, tLoco:false, tAloj:false, adj:[]}));
  R.ed._nuevo=nuevo; R.ed._subidos=[]; R.ed._quitados=[];
  $('vTitle').textContent = nuevo ? 'Nuevo viático' : 'Editar viático';
  ponerLocalidad(R.ed.localidad||'');
  $('vFIni').value=R.ed.fIni||''; $('vHIni').value=R.ed.hIni||''; $('vFFin').value=R.ed.fFin||''; $('vHFin').value=R.ed.hFin||'';
  R.ed.alojs = JSON.parse(JSON.stringify(alojsDe(R.ed))); R.ed._ap=false;
  (R.ed.adj||[]).forEach(a=>{ if(a.clase==='aloj' && !R.ed.alojs.some(x=>x.id===a.item)){ if(!R.ed.alojs.length) R.ed.alojs.push({id:uid(),f:R.ed.fIni,monto:0}); a.item=R.ed.alojs[0].id; } });
  R.ed.locos = JSON.parse(JSON.stringify(locosDe(R.ed))); R.ed._lp=false;
  (R.ed.adj||[]).forEach(a=>{ if(claseDe(a)==='loco' && !R.ed.locos.some(l=>l.id===a.item)){ if(!R.ed.locos.length) R.ed.locos.push({id:uid(),tramo:'ida',f:R.ed.fIni,monto:0}); a.item=R.ed.locos[0].id; a.clase='loco'; } });
  R.ed.inter=R.ed.inter||[]; $('vTInter').checked=!!R.ed.tInter; $('vInter').innerHTML='';
  $('vTLoco').checked = tieneLoco(R.ed); $('vTAloj').checked = !!R.ed.tAloj; checks(); pintarLocos(); pintarAlojs();
  opcionesLoc($('vCSalLoc'), R.ed.cSalLoc || ($('vLocSel').value.startsWith('otra:')?'':$('vLocSel').value));
  $('vCEnt').value=R.ed.cEnt||''; $('vCSal').value=R.ed.cSal||''; _entAnt=$('vLocSel').value;
  // horas cargadas antes sin marca: se conservan hasta que se cargue la marca
  R.ed._legIni = R.ed.cEnt ? '' : (R.ed.hIni||''); R.ed._legFin = R.ed.cSal ? '' : (R.ed.hFin||'');
  calcEditor();
  $('vErr').textContent=''; $('vDel').classList.toggle('hide',nuevo);
  const pr = nuevo ? [] : problemas(R.datos.v[R.ed.id], viaticos());
  $('vRevisar').innerHTML = pr.length ? '<b>Para revisar:</b><ul class="probs">'+pr.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>' : '';
  $('vRevisar').classList.toggle('hide',!pr.length);
  $('vAuto').textContent = (!nuevo && R.ed.auto && R.ed.auto.length) ? '🔄 Completado con el PDF de la intranet: '+R.ed.auto.join(', ')+'. Revisalo y corregí si hace falta.' : '';
  $('vAuto').classList.toggle('hide', !$('vAuto').textContent);
  pintarTipo(); pintarAdj();
  $('dlgV').showModal();
}
function locDeSel(){ const v=$('vLocSel').value; if(!v) return ''; if(v.startsWith('otra:')) return v.slice(5); const l=byId(v); return l?corto(l.localidad):''; }
function pintarLocSel(dep, val){
  const lista=locs.filter(l=>l.departamento===dep).sort((a,b)=>cmp(a.localidad,b.localidad));
  $('vLocSel').innerHTML = dep ? (lista.length>1?'<option value="">Elegí…</option>':'')+lista.map(l=>'<option value="'+esc(l.id)+'"'+(l.id===val?' selected':'')+'>'+esc(l.localidad)+'</option>').join('') : '<option value="">—</option>';
  $('vLocSel').disabled=!dep;
}
function ponerLocalidad(nombre){
  const deps=[...new Set(locs.map(l=>l.departamento))].sort(cmp);
  const l = nombre ? locs.find(x=>norm(corto(x.localidad))===norm(nombre) || norm(x.localidad)===norm(nombre)) : null;
  const dep = l ? l.departamento : '';
  $('vLocDep').innerHTML='<option value="">Elegí…</option>'+deps.map(d=>'<option'+(d===dep?' selected':'')+'>'+esc(d)+'</option>').join('');
  pintarLocSel(dep, l?l.id:'');
  if(nombre && !l){ // localidad que ya no está en la lista: se mantiene
    $('vLocSel').innerHTML='<option value="otra:'+esc(nombre)+'" selected>'+esc(nombre)+'</option>'; $('vLocSel').disabled=false;
  }
}
$('vLocDep').addEventListener('change',e=>{ pintarLocSel(e.target.value,''); seguirSalida(); calcEditor(); });
let _entAnt='';
function seguirSalida(){ const v=$('vLocSel').value; if(!$('vCSalLoc').value || $('vCSalLoc').value===_entAnt) opcionesLoc($('vCSalLoc'), v&&!v.startsWith('otra:')?v:''); _entAnt=v; calcEditor(); }
$('vLocSel').addEventListener('focus',()=>{ _entAnt=$('vLocSel').value; });
$('vLocSel').addEventListener('change',seguirSalida);
function leerEditor(){
  Object.assign(R.ed,{localidad:locDeSel(), fIni:$('vFIni').value, hIni:$('vHIni').value, fFin:$('vFFin').value, hFin:$('vHFin').value,
    tInter:$('vTInter').checked, inter:(leerInter(), R.ed.inter.filter(p=>p.h||p.loc)),
    tLoco:$('vTLoco').checked, tAloj:$('vTAloj').checked,
    locos:(leerLocos(), R.ed.locos.map(l=>({id:l.id, tramo:l.tramo, f:l.f, monto:Math.max(0,Math.round(+l.monto||0))}))),
    alojs:(leerAlojs(), R.ed.alojs.map(a=>({id:a.id, f:a.f, monto:Math.max(0,Math.round(+a.monto||0))}))),
    cEntLoc:$('vLocSel').value, cSalLoc:$('vCSalLoc').value, cEnt:$('vCEnt').value, cSal:$('vCSal').value});
}
function calcEditor(){
  const v=$('vLocSel').value, le=v&&!v.startsWith('otra:')?byId(v):null, ls=byId($('vCSalLoc').value)||le;
  const me=toMin($('vCEnt').value), ms=toMin($('vCSal').value), msg=[];
  let hi='', hf='';
  if(me!=null){ if(le){ hi=hhmm(me-toMin(le.horas)); msg.push('Comienzo = '+$('vCEnt').value+' − '+dur(toMin(le.horas))+' de viaje'); } else msg.push('Elegí la localidad de entrada'); }
  else hi=R.ed._legIni||'';
  if(ms!=null){ if(ls){ hf=hhmm(ms+toMin(ls.horas)); msg.push('Finalización = '+$('vCSal').value+' + '+dur(toMin(ls.horas))+' de viaje'); } else msg.push('Elegí la ciudad de salida'); }
  else hf=R.ed._legFin||'';
  $('vHIni').value=hi; $('vHFin').value=hf;
  $('vHIniTxt').textContent=hi||'--:--'; $('vHFinTxt').textContent=hf||'--:--';
  $('vCalcHint').textContent=msg.join(' · ');
}
['vLocSel','vCSalLoc','vCEnt','vCSal'].forEach(id=>{ $(id).addEventListener('input',calcEditor); $(id).addEventListener('change',calcEditor); });

$('vTipo').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; R.ed.tipo=b.dataset.t; pintarTipo(); });
// días del viático (fecha comienzo → finalización) para elegir el día de locomoción y alojamiento
function diasRango(){
  const a=$('vFIni').value, b=$('vFFin').value||a; if(!a) return [];
  const out=[]; const d=new Date(a+'T12:00'), fin=new Date((b<a?a:b)+'T12:00');
  while(d<=fin && out.length<62){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
  return out;
}
function ajustarDia(f, dias){ if(!dias.length) return f||''; if(dias.includes(f)) return f; return (f && f>dias[dias.length-1]) ? dias[dias.length-1] : dias[0]; }
function selDia(cls, f){
  const dias=diasRango(), val=ajustarDia(f,dias);
  return '<select class="'+cls+'" aria-label="Día">'+dias.map((d,i)=>'<option value="'+d+'"'+(d===val?' selected':'')+'>'+fDM(d)+' · día '+(i+1)+'</option>').join('')+'</select>';
}
function refrescarDias(){ leerLocos(); leerAlojs(); leerInter(); if(R.ed._lp) pintarLocos(); if(R.ed._ap) pintarAlojs(); if(R.ed._ip) pintarInter(); }
['vFIni','vFFin'].forEach(id=>$(id).addEventListener('change',refrescarDias));
function pintarLocos(){
  R.ed._lp=true;
  $('vLocos').innerHTML = R.ed.locos.map((l,i)=>'<div class="lrow" data-l="'+esc(l.id)+'"><label>Locomoción '+(i+1)+'</label>'+
    '<div class="seg"><button type="button" data-tr="ida"'+(l.tramo!=='vuelta'?' class="on"':'')+'>Ida</button><button type="button" data-tr="vuelta"'+(l.tramo==='vuelta'?' class="on"':'')+'>Vuelta</button></div>'+
    '<div class="g">'+selDia('lf',l.f)+'<input class="lm" type="number" inputmode="decimal" min="0" step="1" placeholder="Monto $" value="'+(+l.monto||'')+'" aria-label="Monto"><button type="button" class="lx" aria-label="Quitar">×</button></div>'+
    '<label class="drop"><span>＋ Subir comprobante</span><small>Foto o PDF del pasaje o boleto</small><input class="lin" type="file" accept="application/pdf,image/*" multiple hidden></label>'+
    '<div class="adjlist" data-lc="'+esc(l.id)+'"></div></div>').join('') || '<p class="note" style="margin:0 0 8px">Sin locomociones.</p>';
  pintarAdj();
}
function leerLocos(){
  if(!R.ed._lp) return;
  R.ed.locos=[...$('vLocos').querySelectorAll('.lrow')].map(r=>({id:r.dataset.l, tramo:r.querySelector('[data-tr].on')?.dataset.tr||'ida', f:r.querySelector('.lf').value, monto:r.querySelector('.lm').value}));
}
function nuevaLoco(){ leerLocos(); const n=R.ed.locos.length; R.ed.locos.push({id:uid(), tramo:n?'vuelta':'ida', f:n?($('vFFin').value||$('vFIni').value):$('vFIni').value, monto:''}); pintarLocos(); }
$('vLocoAdd').addEventListener('click',nuevaLoco);
$('vLocos').addEventListener('click',e=>{
  const tr=e.target.closest('[data-tr]');
  if(tr){
    tr.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===tr));
    // ida → primer día del viático · vuelta → último día (después se puede cambiar)
    const sel=tr.closest('.lrow').querySelector('.lf'), dias=diasRango();
    if(sel && dias.length) sel.value = tr.dataset.tr==='vuelta' ? dias[dias.length-1] : dias[0];
    return;
  }
  const lx=e.target.closest('.lx');
  if(lx){ leerLocos(); const id=lx.closest('.lrow').dataset.l; R.ed.adj.filter(a=>a.item===id).forEach(a=>R.ed._quitados.push(a)); R.ed.adj=R.ed.adj.filter(a=>a.item!==id); R.ed.locos=R.ed.locos.filter(l=>l.id!==id); pintarLocos(); return; }
  quitarAdj(e);
});
$('vLocos').addEventListener('change',e=>{ if(e.target.classList.contains('lin')){ const f=[...e.target.files]; e.target.value=''; leerLocos(); subirComps(f,'loco',e.target.closest('.lrow').dataset.l); } });
function pintarAlojs(){
  R.ed._ap=true;
  $('vAlojs').innerHTML = R.ed.alojs.map((a,i)=>'<div class="arow" data-al="'+esc(a.id)+'"><label>Alojamiento '+(i+1)+'</label>'+
    '<div class="g">'+selDia('af',a.f)+'<input class="am" type="number" inputmode="decimal" min="0" step="1" placeholder="Monto $" value="'+(+a.monto||'')+'" aria-label="Monto"><button type="button" class="ax" aria-label="Quitar">×</button></div>'+
    '<label class="drop"><span>＋ Subir comprobante</span><small>Foto o PDF de la factura del hotel</small><input class="ain" type="file" accept="application/pdf,image/*" multiple hidden></label>'+
    '<div class="adjlist" data-ac="'+esc(a.id)+'"></div></div>').join('') || '<p class="note" style="margin:0 0 8px">Sin alojamientos.</p>';
  pintarAdj();
}
function leerAlojs(){
  if(!R.ed._ap) return;
  R.ed.alojs=[...$('vAlojs').querySelectorAll('.arow')].map(r=>({id:r.dataset.al, f:r.querySelector('.af').value, monto:r.querySelector('.am').value}));
}
function nuevoAloj(){ leerAlojs(); const n=R.ed.alojs.length, u=R.ed.alojs[n-1]; let f=$('vFIni').value;
  if(u && u.f){ const d=new Date(u.f+'T12:00'); d.setDate(d.getDate()+1); f=d.toISOString().slice(0,10); }
  R.ed.alojs.push({id:uid(), f, monto:''}); pintarAlojs(); }
$('vAlojAdd').addEventListener('click',nuevoAloj);
$('vAlojs').addEventListener('click',e=>{
  const ax=e.target.closest('.ax');
  if(ax){ leerAlojs(); const id=ax.closest('.arow').dataset.al; R.ed.adj.filter(a=>a.item===id).forEach(a=>R.ed._quitados.push(a)); R.ed.adj=R.ed.adj.filter(a=>a.item!==id); R.ed.alojs=R.ed.alojs.filter(a=>a.id!==id); pintarAlojs(); return; }
  quitarAdj(e);
});
$('vAlojs').addEventListener('change',e=>{ if(e.target.classList.contains('ain')){ const f=[...e.target.files]; e.target.value=''; leerAlojs(); subirComps(f,'aloj',e.target.closest('.arow').dataset.al); } });
function checks(){ $('vLocoBox').classList.toggle('hide',!$('vTLoco').checked); $('vAlojBox').classList.toggle('hide',!$('vTAloj').checked); }
$('vTLoco').addEventListener('change',()=>{ checks(); if($('vTLoco').checked && !R.ed.locos.length) nuevaLoco(); }); $('vTAloj').addEventListener('change',()=>{ checks(); if($('vTAloj').checked && !R.ed.alojs.length) nuevoAloj(); });
function quitarAdj(e){
  const x=e.target.closest('[data-x]'); if(!x) return;
  const a=R.ed.adj.find(a=>a.id===x.dataset.x); if(!a) return;
  R.ed.adj=R.ed.adj.filter(z=>z!==a); R.ed._quitados.push(a); pintarAdj();
}
$('vCerrar').addEventListener('click',()=>$('vCancel').click());
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
  const fueraRango=f=>f && (f<v.fIni || f>(v.fFin||v.fIni));
  if(v.tLoco && (v.locos||[]).some(l=>fueraRango(l.f)) || v.tAloj && (v.alojs||[]).some(a=>fueraRango(a.f))){ $('vErr').textContent='Hay locomoción o alojamiento con un día fuera del viático.'; return; }
  (v._quitados||[]).filter(a=>!(v._subidos||[]).includes(a)).forEach(a=>borrarDrive(a.drive));
  (v._quitados||[]).filter(a=>(v._subidos||[]).includes(a)).forEach(a=>borrarDrive(a.drive));
  const limpio={...v, t:Date.now(), adj:(v.adj||[]).map(({_blob,...a})=>a)}; delete limpio._nuevo; delete limpio._ip;  delete limpio._lp; delete limpio.loco; delete limpio._ap; delete limpio.aloj; delete limpio._legIni; delete limpio._legFin; delete limpio._subidos; delete limpio._quitados;
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
async function subirComps(files, clase, item){
  for(const f of files){
    $('vErr').textContent='Subiendo '+f.name+'…';
    try{
      const ex=item?{item}:null;
      if(f.type==='application/pdf') await agregarAdj(f, f.name, 'application/pdf', clase, ex);
      else { const j=await aJpeg(f); await agregarAdj(j, (f.name||'comprobante').replace(/\.[^.]+$/,'')+'.jpg', 'image/jpeg', clase, ex); }
      $('vErr').textContent='';
    }catch(err){ $('vErr').textContent='No se pudo subir '+f.name+(err&&err.code==='token'?': renová el permiso de Google.':'.'); }
  }
}
/* ---------------- PDF de marcas del mes ---------------- */
let _pdfjs=null;
function cargarScript(src){ return new Promise((ok,mal)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>mal(new Error('No se pudo cargar '+src)); document.head.appendChild(s); }); }
async function pdfjs(){ if(!_pdfjs) _pdfjs=cargarScript('lib/pdf.min.js').then(()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc='lib/pdf.worker.min.js'; return pdfjsLib; }); return _pdfjs; }

/* ---------------- lectura del PDF de marcas del mes (OCR) ----------------
   El PDF de la intranet viene como imagen: se lee con Tesseract dentro del teléfono,
   se ubican las filas de la tabla "Marcas SAP" por su fecha y se recortan las del viático. */
const OCR={worker:null, cache:{}};
const absUrl = p => new URL(p, location.href).href;
async function ocrWorker(){
  if(OCR.worker) return OCR.worker;
  OCR.worker=(async()=>{
    await cargarScript('lib/tesseract/tesseract.min.js');
    return await Tesseract.createWorker('eng',1,{workerPath:absUrl('lib/tesseract/worker.min.js'), corePath:absUrl('lib/tesseract/'), langPath:absUrl('lib/tesseract'), gzip:true});
  })();
  OCR.worker.catch(()=>{ OCR.worker=null; });
  return OCR.worker;
}
// el OCR a veces pierde los dos puntos ("1430") o los lee como punto ("00.01")
function normHora(t){
  let x=String(t||'').trim().replace(/[.,;]/,':');
  if(/^\d{3,4}$/.test(x)){ x=x.padStart(4,'0'); x=x.slice(0,2)+':'+x.slice(2); }
  const m=/^(\d{1,3}):(\d{2})$/.exec(x); if(!m || +m[2]>59) return null;
  return m[1].padStart(2,'0')+':'+m[2];
}
const isoDe = t => { const m=/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/.exec(t||''); return m ? m[3]+'-'+m[2]+'-'+m[1] : null; };
async function palabrasOCR(cv){
  const w=await ocrWorker(); const {data}=await w.recognize(cv,{},{blocks:true});
  const ws=[]; for(const b of data.blocks||[]) for(const p of b.paragraphs) for(const l of p.lines) for(const x of l.words) ws.push({t:x.text, x0:x.bbox.x0, y0:x.bbox.y0, x1:x.bbox.x1, y1:x.bbox.y1});
  return ws;
}
// PDF impreso desde el navegador: trae texto, se lee directo (sin OCR)
async function palabrasTexto(pg, vp){
  const tc=await pg.getTextContent(), ws=[];
  for(const it of tc.items){
    const str=(it.str||''); if(!str.trim()) continue;
    const tx=pdfjsLib.Util.transform(vp.transform, it.transform);
    const h=Math.hypot(tx[2],tx[3]), x0=tx[4], yb=tx[5], wTot=(it.width||0)*vp.scale || h*0.5*str.length;
    let pos=0; const n=str.length;
    for(const m of str.matchAll(/\S+/g)){
      const a=x0+wTot*(m.index/n), b=x0+wTot*((m.index+m[0].length)/n);
      ws.push({t:m[0], x0:a, x1:b, y0:yb-h*0.85, y1:yb+h*0.15});
    }
  }
  ws.sort((a,b)=>(a.y0-b.y0)||(a.x0-b.x0));
  return ws;
}
async function analizarPagina(cv, ws){
  const sap=ws.find((x,i)=>/^SAP$/i.test(x.t) && ws[i-1] && /^Marcas$/i.test(ws[i-1].t));
  const titulo = sap ? ws[ws.indexOf(sap)-1] : null;
  const desdeY = titulo ? titulo.y1 : 0;
  // tabla "Marcas del día": si se imprime el mismo día, las marcas de hoy salen ahí y no en "Marcas SAP"
  const del_=ws.find((x,i)=>/^del$/i.test(x.t) && ws[i-1] && /^Marcas$/i.test(ws[i-1].t) && ws[i+1] && /^d[ií]a$/i.test(ws[i+1].t));
  const dia=[];
  if(del_){
    const hasta = titulo ? titulo.y0 : Infinity;
    for(const d of ws.filter(x=>x.y0>del_.y1 && x.y1<hasta && isoDe(x.t))){
      const yc=(d.y0+d.y1)/2, hh=(d.y1-d.y0);
      const fila=ws.filter(z=>z!==d && Math.abs((z.y0+z.y1)/2-yc)<hh && z.x0>d.x1).sort((a,b)=>a.x0-b.x0);
      // columnas por el encabezado: Hora Entrada · Origen Entrada · Hora Salida · Origen Salida
      const cabD=ws.filter(z=>z.y0>del_.y1 && z.y1<d.y0);
      const hs=cabD.filter(z=>/^Hora$/i.test(z.t)).sort((a,b)=>a.x0-b.x0), os=cabD.filter(z=>/^Origen$/i.test(z.t)).sort((a,b)=>a.x0-b.x0);
      const centro=(w)=>{ if(!w) return null; const sig=cabD.find(z=>Math.abs(z.y0-w.y0)<6 && z.x0>w.x1 && z.x0<w.x1+40); return (w.x0+(sig?sig.x1:w.x1))/2; };
      const cerca=(c, esHora)=>{ if(c==null) return null; const cand=fila.filter(z=>Math.abs((z.x0+z.x1)/2-c)<70 && (!esHora || /:/.test(z.t) || /^\d{4}$/.test(z.t))); cand.sort((a,b)=>Math.abs((a.x0+a.x1)/2-c)-Math.abs((b.x0+b.x1)/2-c)); return cand[0]||null; };
      const tE=cerca(centro(hs[0]),true), tS=cerca(centro(hs[1]),true), oE=cerca(centro(os[0])), oS=cerca(centro(os[1]));
      dia.push({f:isoDe(d.t), ent:tE?normHora(tE.t):null, sal:tS?normHora(tS.t):null, oEnt:oE?oE.t:'', oSal:oS?oS.t:'', sint:true});
    }
  }
  const enDia=new Set(del_ ? ws.filter(x=>x.y0>del_.y1 && (!titulo || x.y1<titulo.y0)) : []);
  let fechas=ws.filter(x=>x.y0>desdeY && isoDe(x.t) && !enDia.has(x));
  if(!fechas.length) return {filas:[], titulo:null, dia};
  const xmin=Math.min(...fechas.map(x=>x.x0)); fechas=fechas.filter(x=>x.x0<xmin+40).sort((a,b)=>a.y0-b.y0);
  const cab = titulo ? ws.find(x=>/^Fecha$/i.test(x.t) && x.y0>titulo.y1 && x.y1<fechas[0].y0) : null;
  const colHoras = titulo ? ws.find(x=>/^Horas$/i.test(x.t) && x.y0>titulo.y1 && x.y1<fechas[0].y0) : null;
  const enCab = re => titulo ? ws.filter(x=>re.test(x.t) && x.y0>titulo.y1 && x.y1<fechas[0].y0).sort((a,b)=>a.x0-b.x0)[0] : null;
  const colEnt=enCab(/^Entrada$/i), colSal=enCab(/^Salida$/i), colEfec=enCab(/^Efectivas$/i);
  const origs = titulo ? ws.filter(x=>/^Origen$/i.test(x.t) && x.y0>titulo.y1 && x.y1<fechas[0].y0).sort((a,b)=>a.x0-b.x0) : [];
  const cx = w => w ? (w.x0+w.x1)/2 : null;
  // centros de columna (el de origen se toma de "Origen Entrada" / "Origen Salida" completos)
  const centroOrigen = o => { if(!o) return null; const sig=ws.find(z=>Math.abs(z.y0-o.y0)<6 && z.x0>o.x1 && z.x0<o.x1+40); return (o.x0+(sig?sig.x1:o.x1))/2; };
  const cols={fecha:cx(cab), ent:cx(colEnt), sal:cx(colSal), horas:cx(colHoras), efec:cx(colEfec), oEnt:centroOrigen(origs[0]), oSal:centroOrigen(origs[1])};
  const cs=fechas.map(x=>(x.y0+x.y1)/2), dif=[]; for(let i=1;i<cs.length;i++) dif.push(cs[i]-cs[i-1]);
  dif.sort((a,b)=>a-b);
  const paso = dif.length ? dif[Math.floor(dif.length/2)] : (cab ? (cs[0]-(cab.y0+cab.y1)/2) : 60);
  const filas=fechas.map((x,i)=>{
    const yc=cs[i], y0=yc-paso/2, y1=yc+paso/2;
    let horas=null;
    if(colHoras){ const hc=(colHoras.x0+colHoras.x1)/2; const h=ws.find(z=>z.y0>y0 && z.y1<y1 && Math.abs((z.x0+z.x1)/2-hc)<45 && normHora(z.t)); if(h) horas=normHora(h.t); }
    const hora = col => { if(!col) return null; const c=(col.x0+col.x1)/2; const h=ws.find(z=>z.y0>y0 && z.y1<y1 && Math.abs((z.x0+z.x1)/2-c)<45 && normHora(z.t) && toMin(normHora(z.t))!=null && +normHora(z.t).slice(0,2)<24); return h?normHora(h.t):null; };
    // orígenes completos de la fila (para completar los de "Marcas del día", que solo traen el código)
    let oEnt='', oSal='';
    if(cols.oEnt!=null && cols.oSal!=null && colEfec){ const mid=(cols.oEnt+cols.oSal)/2;
      const tk=ws.filter(z=>z.y0>y0 && z.y1<y1 && z.x0>colEfec.x1+8).sort((a,b)=>a.x0-b.x0);
      oEnt=tk.filter(z=>cx(z)<mid).map(z=>z.t).join(' '); oSal=tk.filter(z=>cx(z)>=mid).map(z=>z.t).join(' '); }
    return {f:isoDe(x.t), y0:Math.max(0,y0), y1:Math.min(cv.height,y1), horas, ent:hora(colEnt), sal:hora(colSal), oEnt, oSal};
  });
  const enTabla=ws.filter(z=>z.y0>=(titulo?titulo.y0:filas[0].y0) && z.y1<=filas[filas.length-1].y1);
  const x0=Math.max(0, Math.min(...enTabla.map(z=>z.x0))-28), x1=Math.min(cv.width, Math.max(...enTabla.map(z=>z.x1))+28);
  return {filas, x0, x1, titulo: titulo ? {y0:Math.max(0,titulo.y0-22), y1: filas[0].y0} : null, dia, cols, paso, fs:(fechas[0].y1-fechas[0].y0)};
}
// marcas del día que no están en "Marcas SAP" (impresión hecha el mismo día)
function filasDia(paginas){
  const sap=new Set(paginas.flatMap(p=>p.filas.map(f=>f.f)));
  const out=[]; for(const p of paginas) for(const d of p.dia||[]) if(!sap.has(d.f) && !out.some(o=>o.f===d.f && o.ent===d.ent)) out.push(d);
  return out;
}
function nombreOrigen(paginas, cod){
  if(!cod) return '';
  const n=(/^\d+/.exec(cod)||[])[0]; if(!n) return cod;
  for(const p of paginas) for(const f of p.filas) for(const o of [f.oEnt,f.oSal]) if(o && o.startsWith(n+' ')) return o;
  return cod;
}
function restarHoras(a,b){ const x=toMin(a), y=toMin(b); if(x==null||y==null) return null; let d=y-x; if(d<0) d+=1440; return String(Math.floor(d/60)).padStart(2,'0')+':'+String(d%60).padStart(2,'0'); }
function analizarMarcas(driveId){
  if(OCR.cache[driveId]) return OCR.cache[driveId];
  const pr=(async()=>{
    const blob=await bajar(driveId), lib=await pdfjs();
    const doc=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
    const paginas=[];
    for(let n=1;n<=doc.numPages;n++){
      const pg=await doc.getPage(n), vp=pg.getViewport({scale:200/72});
      const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
      const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height);
      await pg.render({canvasContext:c, viewport:vp}).promise;
      let ws=await palabrasTexto(pg,vp);
      if(!ws.some(x=>isoDe(x.t))) ws=await palabrasOCR(cv);
      const r=await analizarPagina(cv,ws); r.cv=cv; paginas.push(r);
    }
    return paginas;
  })();
  OCR.cache[driveId]=pr; pr.catch(()=>{ delete OCR.cache[driveId]; });
  return pr;
}
function mesesDe(v){ const out=[]; const a=(v.fIni||'').slice(0,7), b=(v.fFin||v.fIni||'').slice(0,7); if(a) out.push(a); if(b && b!==a) out.push(b); return out; }
const sumaHoras = hs => { let m=0; for(const h of hs){ const x=/^(\d+):(\d{2})$/.exec(h||''); if(x) m+=(+x[1])*60+(+x[2]); } return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };
// imagen como la consulta de la intranet filtrada por las fechas del viático: encabezado + "Marcas SAP" + filas de esos días
async function imagenMarcasViatico(v){
  const paginas=[];
  for(const m of mesesDe(v)){ const x=(R.datos.marcasMes||{})[m]; if(x && x.drive) paginas.push(...await analizarMarcas(x.drive)); }
  if(!paginas.length) return null;
  const fin=v.fFin||v.fIni, filas=[];
  for(const p of paginas) for(const f of p.filas) if(f.f>=v.fIni && f.f<=fin) filas.push({p,f});
  const base=paginas.find(p=>p.titulo && p.cols) || paginas.find(p=>p.titulo) || paginas[0];
  // las del día se dibujan como una fila más de "Marcas SAP"
  if(base.cols && base.cols.fecha!=null) for(const d of filasDia(paginas)) if(d.f>=v.fIni && d.f<=fin){
    const h=restarHoras(d.ent,d.sal);
    filas.push({p:base, f:{...d, horas:h, oEnt:nombreOrigen(paginas,d.oEnt), oSal:nombreOrigen(paginas,d.oSal), y0:0, y1:base.paso}});
  }
  filas.sort((a,b)=>(a.f.f+(a.f.ent||'')).localeCompare(b.f.f+(b.f.ent||'')));
  const W=Math.max(...[base, ...filas.map(x=>x.p)].map(p=>p.x1-p.x0));
  const k=base.cv.width/1700, cabH=Math.round(330*k);
  const tit = base.titulo ? base.titulo.y1-base.titulo.y0 : 0;
  const H=cabH+tit+filas.reduce((s,x)=>s+(x.f.y1-x.f.y0),0)+Math.round(20*k);
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const c=cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,W,H);
  // encabezado de la consulta
  const fuente=(px,bold)=>(bold?'600 ':'')+Math.round(px*k)+'px "Segoe UI", Arial, sans-serif';
  const px=Math.round(28*k), bw=Math.min(W-2*px, Math.round(760*k)), bh=Math.round(46*k);
  c.fillStyle='#222'; c.font=fuente(22); c.textBaseline='middle';
  const caja=(y,txt)=>{ c.strokeStyle='#ced4da'; c.lineWidth=Math.max(1,2*k); c.beginPath(); c.roundRect? c.roundRect(px,y,bw,bh,6*k) : c.rect(px,y,bw,bh); c.stroke(); c.fillStyle='#495057'; c.font=fuente(19); c.fillText(txt,px+Math.round(14*k),y+bh/2); };
  c.fillText('Fecha Desde:',px,Math.round(30*k)); caja(Math.round(52*k), fDMY(v.fIni));
  c.fillStyle='#222'; c.font=fuente(22); c.fillText('Fecha Hasta:',px,Math.round(128*k)); caja(Math.round(150*k), fDMY(fin));
  c.strokeStyle='#4a6fa5'; c.lineWidth=Math.max(1,2*k); c.strokeRect(px,Math.round(208*k),Math.round(98*k),Math.round(38*k));
  c.fillStyle='#8a94a6'; c.font=fuente(17); c.fillText('Consultar',px+Math.round(12*k),Math.round(227*k));
  c.fillStyle='#222'; c.font=fuente(18); c.fillText('🕓 Total Horas Realizadas: '+sumaHoras(filas.map(x=>x.f.horas)),px-Math.round(10*k),Math.round(296*k));
  let y=cabH;
  if(base.titulo){ c.drawImage(base.cv, base.x0, base.titulo.y0, W, tit, 0, y, W, tit); y+=tit; }
  for(const {p,f} of filas){
    const h=f.y1-f.y0;
    if(!f.sint){ c.drawImage(p.cv, p.x0, f.y0, W, h, 0, y, W, h); y+=h; continue; }
    // fila armada con los datos de "Marcas del día", con el mismo formato que las de "Marcas SAP"
    const C=base.cols, X=xx=>xx-base.x0, fs=Math.round(base.fs*0.92), yc=y+h/2;
    // mismo fondo que las filas recortadas
    let fondo='#fff'; try{ const r0=base.filas[base.filas.length-1]; const px2=base.cv.getContext('2d').getImageData(base.x0+6, Math.round((r0.y0+r0.y1)/2), 1, 1).data; fondo='rgb('+px2[0]+','+px2[1]+','+px2[2]+')'; }catch(e){}
    c.fillStyle=fondo; c.fillRect(0,y,W,h);
    c.strokeStyle='#dee2e6'; c.lineWidth=Math.max(1,1.5*k); c.beginPath(); c.moveTo(X(base.x0+28),y+0.5); c.lineTo(W-28,y+0.5); c.stroke();
    c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#212529';
    c.font='700 '+fs+'px "Segoe UI", Arial, sans-serif'; c.fillText(fDMY(f.f), X(C.fecha), yc);
    c.font='400 '+fs+'px "Segoe UI", Arial, sans-serif';
    const put=(t,col)=>{ if(t && col!=null) c.fillText(t, X(col), yc); };
    put(f.ent,C.ent); put(f.sal,C.sal); put(f.horas,C.horas); put(f.horas,C.efec); put(f.oEnt,C.oEnt); put(f.oSal,C.oSal);
    c.textAlign='left'; y+=h;
  }
  return {cv, fw: W/base.cv.width, n:filas.length};
}
/* --- control: marcas cargadas en los viáticos vs. marcas de la intranet --- */
const TOL_MIN = 10; // diferencia tolerada (redondeos de pocos minutos)
async function marcasIntranet(v){
  const out=[];
  for(const m of mesesDe(v)){ const x=(R.datos.marcasMes||{})[m]; if(x && x.drive){ const ps=await analizarMarcas(x.drive); for(const p of ps) out.push(...p.filas); out.push(...filasDia(ps)); } }
  return out;
}
function difMin(a,b){ const x=toMin(a), y=toMin(b); return x==null||y==null ? null : Math.abs(x-y); }
async function chequearViatico(v){
  const meses=mesesDe(v).filter(m=>((R.datos.marcasMes||{})[m]||{}).drive);
  if(!meses.length) return null;           // sin PDF de marcas: no se controla
  const filas=await marcasIntranet(v), del=f=>filas.filter(r=>r.f===f).sort((a,b)=>(a.ent||'').localeCompare(b.ent||''));
  const w=[];
  if(v.cEnt && v.fIni){
    const d=del(v.fIni);
    if(!d.length) w.push('no hay marcas el '+fDM(v.fIni)+' (cargaste entrada '+v.cEnt+')');
    else if(d[0].ent){ const x=difMin(v.cEnt,d[0].ent); if(x>TOL_MIN) w.push('entrada del '+fDM(v.fIni)+': cargaste '+v.cEnt+', la intranet dice '+d[0].ent+' ('+x+' min)'); }
  }
  if(v.cSal && v.fFin){
    const d=del(v.fFin), ult=d.filter(r=>r.sal).pop();
    if(!d.length) w.push('no hay marcas el '+fDM(v.fFin)+' (cargaste salida '+v.cSal+')');
    else if(ult){ const x=difMin(v.cSal,ult.sal); if(x>TOL_MIN) w.push('salida del '+fDM(v.fFin)+': cargaste '+v.cSal+', la intranet dice '+ult.sal+' ('+x+' min)'); }
  }
  if(v.tipo==='C100' && v.tInter) for(const p of (v.inter||[]).filter(p=>p.h)){
    const d=del(p.f||v.fIni), hs=d.flatMap(r=>[r.ent,r.sal]).filter(Boolean);
    if(!d.length){ w.push('no hay marcas el '+fDM(p.f||v.fIni)+' (marca intermedia '+p.h+')'); continue; }
    const x=Math.min(...hs.map(h=>difMin(p.h,h)));
    if(hs.length && x>TOL_MIN) w.push('marca intermedia '+p.h+' del '+fDM(p.f||v.fIni)+' no coincide con la intranet ('+hs.join(', ')+')');
  }
  return w;
}
/* --- completar con la intranet lo que no cargaste (nunca pisa lo que pusiste vos) --- */
const DEPTO_ABREV={mvd:'Montevideo',can:'Canelones',mal:'Maldonado',mdo:'Maldonado',roc:'Rocha',rch:'Rocha',lav:'Lavalleja',tyt:'Treinta y Tres',
  cla:'Cerro Largo',riv:'Rivera',tbo:'Tacuarembó',tac:'Tacuarembó',art:'Artigas',sal:'Salto',slt:'Salto',pay:'Paysandú',pys:'Paysandú',
  rne:'Río Negro',rng:'Río Negro',sor:'Soriano',col:'Colonia',sjo:'San José',sjs:'San José',flo:'Flores',fda:'Florida',fla:'Florida',dur:'Durazno',dzo:'Durazno'};
// "614 - Lav Minas" → Minas · "607 - Cla Melo02_PE" → Melo · "580 - Tyt Ciudad …" → Treinta y Tres C.T.
function locDeOrigen(o){
  if(!o) return null;
  const t=norm(String(o).replace(/^\s*\d+\s*-\s*/,''));
  const cands=locs.map(l=>({l,n:norm(corto(l.localidad))})).filter(x=>x.n.length>=4).sort((a,b)=>b.n.length-a.n.length);
  for(const c of cands){ const k=t.indexOf(c.n); if(k>=0 && (k===0 || !/[a-z]/.test(t[k-1])) && !/[a-z]/.test(t[k+c.n.length]||'')) return c.l; }
  const dep=DEPTO_ABREV[t.slice(0,3)];
  if(dep){ const en=locs.filter(l=>norm(l.departamento)===norm(dep));
    return en.find(l=>/c\.?\s*t\.?\s*$/i.test(l.localidad.trim())) || en.find(l=>norm(corto(l.localidad))===norm(dep)) || (en.length===1?en[0]:null); }
  return null;
}
function locEntrada(v){ return (v.cEntLoc && byId(v.cEntLoc)) || locs.find(l=>norm(corto(l.localidad))===norm(v.localidad||'')) || null; }
async function completarDesdeIntranet(){
  let n=0;
  for(const v of delMes(R.mes)){
    // lo que cargaste vos no se toca; en un C100 sin marcas intermedias se agregan las de otras ciudades
    const faltaC100 = v.tipo==='C100' && !(v.inter||[]).length;
    if(v.cSal && !faltaC100) continue;
    if(!mesesDe(v).some(m=>((R.datos.marcasMes||{})[m]||{}).drive)) continue;
    const fin=v.fFin||v.fIni;
    const filas=(await marcasIntranet(v)).filter(r=>r.f>=v.fIni && r.f<=fin).sort((a,b)=>(a.f+(a.ent||'')).localeCompare(b.f+(b.ent||'')));
    if(!filas.length) continue;
    const marcas=[]; for(const r of filas){ if(r.ent) marcas.push({f:r.f,h:r.ent,o:r.oEnt,tipo:'e'}); if(r.sal) marcas.push({f:r.f,h:r.sal,o:r.oSal,tipo:'s'}); }
    if(!marcas.length) continue;
    const x={...v}, auto=[];
    const primera=marcas[0], ultima=marcas[marcas.length-1];
    if(!x.cEnt && primera.f===x.fIni){ x.cEnt=primera.h; auto.push('entrada'); if(!x.cEntLoc){ const l=locDeOrigen(primera.o); if(l){ x.cEntLoc=l.id; if(!x.localidad) x.localidad=corto(l.localidad); } } }
    if(!x.cSal && ultima.tipo==='s' && ultima.f===fin && marcas.length>1){
      x.cSal=ultima.h; auto.push('salida');
      const l=locDeOrigen(ultima.o); if(l) x.cSalLoc=l.id;
    }
    // C100: si en el medio hay marcas en otra ciudad (distinta de la de entrada y la de salida), se agregan
    // como marcas intermedias para que la planilla tenga un renglón por cada ciudad
    if(x.tipo==='C100' && !(x.inter||[]).length && marcas.length>2){
      const medio=marcas.slice(1,-1).map(m=>{ const lm=locDeOrigen(m.o); return {loc: lm?corto(lm.localidad):x.localidad, f:m.f, h:m.h}; });
      const le0=locEntrada(x), ls0=(x.cSalLoc&&byId(x.cSalLoc))||le0;
      const yaEstan=[le0?corto(le0.localidad):x.localidad, ls0?corto(ls0.localidad):''].map(z=>norm(z||''));
      if(medio.some(m=>!yaEstan.includes(norm(m.loc)))){ x.tInter=true; x.inter=medio; auto.push('marcas intermedias'); }
    }
    if(!auto.length) continue;
    const le=locEntrada(x), ls=(x.cSalLoc&&byId(x.cSalLoc))||le;
    if(x.cEnt && le) x.hIni=hhmm(toMin(x.cEnt)-toMin(le.horas));
    if(x.cSal && ls) x.hFin=hhmm(toMin(x.cSal)+toMin(ls.horas));
    x.auto=[...new Set([...(v.auto||[]),...auto])]; x.t=Date.now();
    R.datos.v[v.id]=x; n++;
  }
  if(n){ cambio(); toast(n+' viático(s) completado(s) con las marcas de la intranet'); }
  return n;
}
let _chkFirma='';
async function chequearMes(){
  try{ await completarDesdeIntranet(); }catch(e){ console.error(e); }
  const lista=delMes(R.mes); const nuevo={};
  for(const v of lista){ try{ const w=await chequearViatico(v); if(w&&w.length) nuevo[v.id]=w; }catch(e){} }
  const firma=JSON.stringify(nuevo);
  if(firma!==_chkFirma){ _chkFirma=firma; R.chk={...(R.chk||{}), ...nuevo}; lista.forEach(v=>{ if(!nuevo[v.id]) delete R.chk[v.id]; }); pintar(); }
}
async function estadoMarcasMes(){
  const m=(R.datos.marcasMes||{})[R.mes], el=$('mesMarcasInfo'); if(!el) return;
  if(!m || !m.drive){ el.textContent=''; return; }
  el.textContent='Leyendo las marcas del PDF…';
  try{
    const pags=await analizarMarcas(m.drive), dias=[...new Set([...pags.flatMap(p=>p.filas.map(f=>f.f)), ...filasDia(pags).map(d=>d.f).filter(f=>f.slice(0,7)===R.mes)])].sort();
    if((R.datos.marcasMes||{})[R.mes]!==m) return;
    el.textContent = dias.length ? dias.length+' día(s) con marcas: '+dias.map(d=>d.slice(8,10)).join(', ') : 'No se encontraron marcas en el PDF. ¿Es la impresión de "Marcas SAP"?';
    if(dias.length) chequearMes();
  }catch(e){ el.textContent='No se pudo leer el PDF de marcas.'; }
}

function pintarMarcasMes(){
  const m=(R.datos.marcasMes||{})[R.mes];
  $('mesMarcas').innerHTML = m && m.drive
    ? '📄 '+esc(m.nombre||'marcas.pdf')+' <button class="lnk" type="button" id="mesMarcasDel" style="width:auto;display:inline;padding:0 0 0 8px">Quitar</button>'
    : 'Subí el PDF con todas las marcas del mes (impreso desde la intranet).';
  estadoMarcasMes();
  const d=$('mesMarcasDel'); if(d) d.onclick=()=>{ const x=R.datos.marcasMes[R.mes]; if(x&&x.drive) borrarDrive(x.drive); R.datos.marcasMes[R.mes]={t:Date.now()}; cambio(); };
}
$('mesMarcasIn').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  if(f.type!=='application/pdf'){ toast('Tiene que ser un PDF'); return; }
  $('mesMarcas').textContent='Subiendo '+f.name+'…';
  try{
    await asegurarToken();
    const ant=(R.datos.marcasMes||{})[R.mes];
    const drive=await subir(f, f.name, 'application/pdf'); await blobPut(drive, f);
    if(ant && ant.drive) borrarDrive(ant.drive);
    R.datos.marcasMes=R.datos.marcasMes||{}; R.datos.marcasMes[R.mes]={drive, nombre:f.name, t:Date.now()};
    cambio(); toast('PDF de marcas guardado');
  }catch(err){ toast('No se pudo subir el PDF'+(err&&err.code==='token'?': renová el permiso de Google':'')); pintarMarcasMes(); }
});

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
  const todas=lista.flatMap(renglones);
  for(let ini=0; ini===0 || ini<todas.length; ini+=filasPorHoja){
    const pg=pdf.addPage(A4), H=A4[1];
    const Y=y=>H-y; // coordenadas desde arriba, como en la planilla original
    pg.drawText('planillas viáticos',{x:167,y:Y(57),size:9.5,font:F.bi});
    pg.drawText(txt('Viáticos '+tipo),{x:316,y:Y(57),size:8,font:F.r});
    pg.drawText('NOMBRE',{x:188,y:Y(78),size:9.5,font:F.bi});
    pg.drawText(txt(nombre),{x:250,y:Y(78),size:9,font:F.r});
    pg.drawLine({start:{x:247,y:Y(81)},end:{x:470,y:Y(81)},thickness:.6,color:negro});
    const cols=[57,158,224,282,354,418,473,527];
    const cab=[['a','localidad'],['fecha','comienzo'],['hora','comienzo'],['fecha','Finalizacion'],['hora','Finalizacion'],['locomoc','$'],['alojam.','$']];
    const box=(x1,y1,x2,y2,w)=>pg.drawRectangle({x:x1,y:Y(y2),width:x2-x1,height:y2-y1,borderColor:negro,borderWidth:w||.7});
    const centro=(s,x1,x2,y,size,font)=>{ s=txt(s); const w=font.widthOfTextAtSize(s,size); pg.drawText(s,{x:(x1+x2)/2-w/2,y:Y(y),size,font}); };
    box(cols[0],95,cols[7],128,.9);
    for(let c=1;c<7;c++) pg.drawLine({start:{x:cols[c],y:Y(95)},end:{x:cols[c],y:Y(128)},thickness:.7,color:negro});
    cab.forEach((t,c)=>{ centro(t[0],cols[c],cols[c+1],107,9,F.b); centro(t[1],cols[c],cols[c+1],124,9,F.b); });
    const filas=todas.slice(ini,ini+filasPorHoja), nFilas=Math.max(10, filas.length);
    for(let i=0;i<nFilas;i++){
      const y1=168+i*25.6, y2=y1+14;
      box(cols[0],y1,cols[7],y2,.7);
      for(let c=1;c<7;c++) pg.drawLine({start:{x:cols[c],y:Y(y1)},end:{x:cols[c],y:Y(y2)},thickness:.7,color:negro});
      const vals=filas[i]; if(!vals) continue;
      vals.forEach((s,c)=>centro(s||'',cols[c],cols[c+1],y2-3.5,c>=5?7.5:8.5,F.r));
    }
    if(todas.length<=filasPorHoja) break;
  }
  /* --- 2) marcas de la intranet --- */
  const M=36, ancho=A4[0]-2*M;
  let pg=null, y=0;
  const nuevaHoja=()=>{ pg=pdf.addPage(A4); pg.drawText(tipo,{x:12,y:A4[1]-16,size:7,font:F.r}); y=A4[1]-40; };
  const hayMarcas = lista.some(v=>(v.adj||[]).some(a=>a.clase==='marca') || mesesDe(v).some(m=>((R.datos.marcasMes||{})[m]||{}).drive));
  if(lista.length){
    nuevaHoja();
    for(const v of lista){
      try{
        const im=await imagenMarcasViatico(v);
        if(im){
          const b=await new Promise(ok=>im.cv.toBlob(ok,'image/jpeg',0.9)); const img=await pdf.embedJpg(new Uint8Array(await b.arrayBuffer()));
          let w=Math.min(ancho, im.fw*A4[0]*0.97), h=img.height*w/img.width;
          if(h>A4[1]-80){ h=A4[1]-80; w=img.width*h/img.height; }
          if(y-h<50) nuevaHoja();
          pg.drawImage(img,{x:M,y:y-h,width:w,height:h}); y-=h+14;
        }
      }catch(e){ console.error(e); }
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
    for(const a of compsPDF(v)){
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
    await chequearMes().catch(()=>{});
    const difs=lista.filter(v=>(R.chk||{})[v.id]).map(v=>'<li><b>'+esc(v.localidad||'')+' '+fDM(v.fIni)+'</b>: '+R.chk[v.id].map(esc).join('; ')+'</li>').join('');
    const sinTerminar=lista.filter(v=>problemas(v,viaticos()).length).length;
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
    out.innerHTML='<div class="pdfout">'+(sinTerminar?'<p class="hint bad" style="margin:0">Ojo: '+sinTerminar+' viático(s) marcados para revisar en la lista.</p>'+(difs?'<div class="revbox" style="margin:0"><b>Diferencias con las marcas de la intranet (más de '+TOL_MIN+' min):</b><ul class="probs">'+difs+'</ul></div>':''):'')+res.map((r,i)=>{
      const url=URL.createObjectURL(new Blob([r.bytes],{type:'application/pdf'}));
      return '<div><div class="note" style="margin-bottom:4px"><b>'+esc(r.desc)+'</b> · '+esc(r.nombre)+'</div><div class="row">'+
        '<button class="btn pri" type="button" data-ver="'+i+'">Ver</button>'+
        '<a class="btn ghost" href="'+url+'" download="'+esc(r.nombre)+'">Descargar</a>'+
        '<button class="btn ghost" type="button" data-share="'+i+'">Compartir</button></div></div>';
    }).join('')+'</div>';
    out.querySelectorAll('[data-ver]').forEach(b=>b.addEventListener('click',()=>verPDF(res[+b.dataset.ver])));
    out.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',async()=>{
      const r=res[+b.dataset.share]; const file=new File([r.bytes],r.nombre,{type:'application/pdf'});
      try{
        if(navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file], title:r.nombre});
        else toast('Este navegador no permite compartir archivos: usá Descargar');
      }catch(e){}
    }));
  }catch(e){ out.innerHTML='<p class="hint bad">No se pudo generar el PDF: '+esc(e.message||e.code||e)+'</p>'; }
}

async function verPDF(r){
  $('pdfTitulo').textContent=r.nombre; const cont=$('pdfPaginas'); cont.innerHTML='<p class="note" style="color:#fff">Abriendo…</p>';
  $('dlgPdf').showModal();
  try{
    const lib=await pdfjs(); const doc=await lib.getDocument({data:r.bytes.slice(0)}).promise; cont.innerHTML='';
    const w=Math.min(1400, Math.max(600, cont.clientWidth*(window.devicePixelRatio||1)));
    for(let n=1;n<=doc.numPages;n++){
      const pg=await doc.getPage(n), vp0=pg.getViewport({scale:1}), vp=pg.getViewport({scale:w/vp0.width});
      const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; cont.appendChild(cv);
      await pg.render({canvasContext:cv.getContext('2d'), viewport:vp}).promise;
    }
  }catch(e){ cont.innerHTML='<p class="note" style="color:#fff">No se pudo mostrar el PDF: usá Descargar.</p>'; }
}
$('pdfCerrar').addEventListener('click',()=>$('dlgPdf').close());

/* ---------------- desde la calculadora ---------------- */
function desdeCalculadora(){
  const r=compute();
  document.querySelector('nav button[data-tab="reg"]').click();
  if(!conectado()){ toast('Iniciá sesión con Google para guardar tus viáticos'); return; }
  // tipo y días de la calculadora; la marca de salida se completa después (a mano o con el PDF de la intranet)
  const v={id:uid(), tipo:clase, localidad: r.le?corto(r.le.localidad):'', loco:0, aloj:0, tLoco:false, tAloj:false, adj:[],
    fIni: isoHoy(), fFin: isoHoy(dias-1),
    hIni: r.entFic!=null ? hhmm(r.entFic) : '', hFin:'',
    cEntLoc: r.le?r.le.id:'', cEnt:P.marcaEnt, cSalLoc: r.ls?r.ls.id:'', cSal:''};
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
if(enWeb()) setTimeout(()=>cargarGIS().catch(()=>{}), 800);
// para pruebas
window.__viaticos={R, generarPDF, bloque, nuevoPDF, fusionar};
}catch(e){
  const m=document.getElementById('regLoginErr'); if(m) m.textContent='La app no terminó de actualizarse. Cerrala y abrila de nuevo (o recargá la página). ['+(e&&e.message||e)+']';
  console.error(e);
}
})();

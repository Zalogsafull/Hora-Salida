/**
 * Hora Salida · edición de localidades desde la app
 * Trabaja sobre la hoja "HORARIOS LOCALIDADES" de la planilla HORA SALIDA,
 * respetando su formato: departamento solo en la primera fila de cada bloque,
 * fila vacía entre departamentos. Columnas: A Departamento · B Localidad ·
 * C Horas de traslado · D Lat · E Lng (D y E opcionales, para la ubicación).
 *
 * Instalar: en la planilla → Extensiones → Apps Script → pegar este código →
 * Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * Copiar la URL /exec y pasársela a la app.
 */
const HOJA = 'HORARIOS LOCALIDADES';
const PRIMERA_FILA = 3; // fila 2 = encabezados

function hoja_() {
  const s = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!s) throw new Error('No existe la hoja ' + HOJA);
  if (!s.getRange(2, 4).getValue()) s.getRange(2, 4, 1, 2).setValues([['Lat', 'Lng']]);
  return s;
}

const norm_ = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function horas_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function num_(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : ''; }

/** Filas con datos: {row, dep, depEnFila, loc, horas, lat, lng} */
function filas_(s) {
  const n = Math.max(s.getLastRow() - PRIMERA_FILA + 1, 0);
  if (!n) return [];
  const v = s.getRange(PRIMERA_FILA, 1, n, 5).getValues();
  const d = s.getRange(PRIMERA_FILA, 3, n, 1).getDisplayValues();
  const out = []; let dep = '';
  v.forEach((r, i) => {
    const a = String(r[0]).trim(), b = String(r[1]).trim();
    if (!a && !b) { dep = ''; return; }
    if (a) dep = a;
    if (!b) return;
    out.push({ row: PRIMERA_FILA + i, dep, depEnFila: !!a, loc: b, horas: horas_(d[i][0]), lat: num_(r[3]), lng: num_(r[4]) });
  });
  return out;
}

function lista_(s) {
  return filas_(s).map(f => ({ id: norm_(f.loc), departamento: f.dep, localidad: f.loc, horas: f.horas, lat: f.lat, lng: f.lng }));
}

function borrarFila_(s, f, filas) {
  const bloque = filas.filter(x => norm_(x.dep) === norm_(f.dep));
  if (bloque.length === 1) {
    // único del departamento: borrar también la fila vacía que lo separa
    const sig = s.getRange(f.row + 1, 1, 1, 2).getValues()[0];
    if (!sig[0] && !sig[1] && f.row + 1 <= s.getLastRow()) s.deleteRow(f.row + 1);
    s.deleteRow(f.row);
    return;
  }
  if (f.depEnFila) s.getRange(f.row + 1, 1).setValue(f.dep); // el nombre del depto pasa a la fila siguiente
  s.deleteRow(f.row);
}

function insertar_(s, dep, loc, hrs, lat, lng) {
  const bloque = filas_(s).filter(x => norm_(x.dep) === norm_(dep));
  let row;
  if (bloque.length) {
    row = bloque[bloque.length - 1].row + 1;
    s.insertRowBefore(row);
    s.getRange(row, 1, 1, 5).setValues([['', loc, '', lat, lng]]);
  } else {
    row = s.getLastRow() + 2; // fila vacía antes del departamento nuevo
    s.getRange(row, 1, 1, 5).setValues([[dep, loc, '', lat, lng]]);
  }
  s.getRange(row, 3).setNumberFormat('@').setValue(hrs);
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() {
  try { return out_({ ok: true, items: lista_(hoja_()) }); }
  catch (e) { return out_({ ok: false, error: String(e.message || e) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const body = JSON.parse(e.postData.contents || '{}');
    const it = body.item || {};
    const s = hoja_();
    const filas = filas_(s);
    const actual = it.id ? filas.find(f => norm_(f.loc) === norm_(it.id)) : null;

    if (body.action === 'delete') {
      if (!actual) throw new Error('No existe');
      borrarFila_(s, actual, filas);
    } else if (body.action === 'upsert') {
      const dep = String(it.departamento || '').trim().slice(0, 40);
      const loc = String(it.localidad || '').trim().slice(0, 60);
      const hrs = horas_(it.horas);
      if (!dep || !loc || !hrs) throw new Error('Datos incompletos');
      const dup = filas.find(f => norm_(f.loc) === norm_(loc));
      if (dup && dup !== actual) throw new Error('Ya existe ' + dup.loc);
      const lat = num_(it.lat), lng = num_(it.lng);
      if (actual && norm_(actual.dep) === norm_(dep)) {
        s.getRange(actual.row, 2).setValue(loc);
        s.getRange(actual.row, 3).setNumberFormat('@').setValue(hrs);
        s.getRange(actual.row, 4, 1, 2).setValues([[lat, lng]]);
      } else {
        if (actual) borrarFila_(s, actual, filas);
        insertar_(s, dep, loc, hrs, lat, lng);
      }
    } else {
      throw new Error('Acción desconocida');
    }
    return out_({ ok: true, items: lista_(s) });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hora Salida · base pública de localidades
 * Pegar en Extensiones > Apps Script de una Google Sheet nueva.
 * 1) Ejecutar setup() una vez (carga la lista inicial).
 * 2) Implementar > Nueva implementación > Aplicación web
 *    Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * 3) Copiar la URL /exec y pegarla en la app (Ajustes) o en API_URL_DEFAULT.
 */
const SHEET = 'Localidades';
const HEAD = ['id', 'departamento', 'localidad', 'horas', 'lat', 'lng', 'actualizado'];

const SEED = [
 ['Maldonado','Maldonado C.T.','02:45',-34.905,-54.958],['Maldonado','Parada 5','03:00',-34.930,-54.925],['Maldonado','Piriápolis','02:30',-34.866,-55.274],['Maldonado','Pan de Azúcar','02:30',-34.778,-55.236],['Maldonado','San Carlos','03:00',-34.791,-54.918],
 ['Rocha','Rocha C.T.','04:00',-34.483,-54.333],['Rocha','La Paloma','04:30',-34.662,-54.164],['Rocha','Castillos','04:30',-34.198,-53.858],['Rocha','Chuy','05:30',-33.697,-53.456],['Rocha','Lascano','04:30',-33.672,-54.207],
 ['Lavalleja','Minas','02:45',-34.376,-55.237],['Lavalleja','Mariscala','03:30',-34.042,-54.778],['Lavalleja','José P. Varela','04:30',-33.454,-54.537],
 ['Treinta y Tres','Treinta y Tres C.T.','05:00',-33.233,-54.383],
 ['Tacuarembó','Tacuarembó C.T.','06:00',-31.711,-55.982],['Tacuarembó','Paso de los Toros','04:30',-32.817,-56.511],['Tacuarembó','Pampa','05:00',-32.270,-56.380],
 ['Cerro Largo','Río Branco','06:30',-32.597,-53.384],['Cerro Largo','Melo','06:45',-32.370,-54.168],['Cerro Largo','Fraile Muerto','06:00',-32.515,-54.523],
 ['Rivera','Rivera','07:30',-30.905,-55.551],['Rivera','Tranqueras','07:00',-31.200,-55.758],['Rivera','Vichadero','07:30',-31.776,-54.693],
 ['Durazno','Durazno','03:30',-33.381,-56.523],['Durazno','Sarandí del Yí','04:00',-33.344,-55.632],['Durazno','Cerro Chato','04:30',-33.098,-55.135],
 ['Florida','Florida','02:15',-34.099,-56.214],['Florida','José Batlle y Ordóñez','04:00',-33.468,-55.124],
 ['Colonia','Colonia','03:00',-34.463,-57.840],['Colonia','Carmelo','04:00',-34.000,-58.283],['Colonia','Colonia Valdense','02:30',-34.339,-57.240],['Colonia','Tararira','03:00',-34.268,-57.616],['Colonia','Conchillas','03:45',-34.168,-58.033],
 ['San José','San José','02:00',-34.338,-56.713],
 ['Salto','Salto','07:30',-31.383,-57.967],
 ['Paysandú','Paysandú','06:00',-32.317,-58.083],['Paysandú','Young','04:30',-32.698,-57.627],
 ['Artigas','Artigas','08:30',-30.400,-56.467],
 ['Flores','Trinidad','03:30',-33.517,-56.900],
 ['Río Negro','Fray Bentos','05:30',-33.117,-58.300],
 ['Soriano','Mercedes','05:00',-33.250,-58.033],['Soriano','Dolores','05:00',-33.533,-58.217],['Soriano','Palmitas','04:30',-33.506,-57.799],['Soriano','José E. Rodó','04:00',-33.693,-57.534],
 ['Canelones','San Ramón','02:00',-34.291,-55.956]
];

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(SHEET);
  if (!s) {
    s = ss.insertSheet(SHEET);
    s.appendRow(HEAD);
    s.setFrozenRows(1);
  }
  s.getRange('A:D').setNumberFormat('@'); // texto: evita que "02:45" se convierta en fecha/hora
  return s;
}

function setup() {
  const s = sheet_();
  if (s.getLastRow() > 1) return 'La hoja ya tiene datos';
  const now = new Date();
  const rows = SEED.map(r => [Utilities.getUuid(), r[0], r[1], r[2], r[3], r[4], now]);
  s.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
  return 'Cargadas ' + rows.length + ' localidades';
}

function list_() {
  const s = sheet_();
  const n = s.getLastRow() - 1;
  if (n < 1) return [];
  return s.getRange(2, 1, n, 6).getValues()
    .filter(r => r[0] && r[2])
    .map(r => ({ id: String(r[0]), departamento: String(r[1]), localidad: String(r[2]), horas: normHoras_(r[3]),
                 lat: num_(r[4]), lng: num_(r[5]) }));
}

function num_(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : '';
}

function normHoras_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try { return out_({ ok: true, items: list_() }); }
  catch (e) { return out_({ ok: false, error: String(e) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const body = JSON.parse(e.postData.contents || '{}');
    const it = body.item || {};
    const s = sheet_();
    const ids = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const idx = it.id ? ids.indexOf(String(it.id)) : -1;

    if (body.action === 'delete') {
      if (idx < 0) throw new Error('No existe');
      s.deleteRow(idx + 2);
    } else if (body.action === 'upsert') {
      const dep = String(it.departamento || '').trim().slice(0, 40);
      const loc = String(it.localidad || '').trim().slice(0, 60);
      const hrs = normHoras_(it.horas);
      if (!dep || !loc || !hrs) throw new Error('Datos incompletos');
      if (+hrs.slice(0, 2) > 23) throw new Error('Horas inválidas');
      const lat = num_(it.lat), lng = num_(it.lng);
      const row = [idx >= 0 ? ids[idx] : Utilities.getUuid(), dep, loc, hrs, lat, lng, new Date()];
      if (idx >= 0) s.getRange(idx + 2, 1, 1, HEAD.length).setValues([row]);
      else s.appendRow(row);
    } else {
      throw new Error('Acción desconocida');
    }
    return out_({ ok: true, items: list_() });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

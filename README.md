# Hora Salida · puesta en marcha

## 1. Base pública de localidades (Google Sheet)
1. Creá una Google Sheet nueva (ej. "Hora Salida - Localidades").
2. Extensiones → Apps Script → borrá lo que haya y pegá `Code.gs`. Guardá.
3. Elegí la función `setup` y tocá **Ejecutar** (autorizá la primera vez). Carga las 45 localidades.
4. Implementar → Nueva implementación → tipo **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copiá la URL que termina en `/exec`.

> Si después cambiás `Code.gs`, usá Implementar → Gestionar implementaciones → editar → Nueva versión (así la URL no cambia).

## 2. La app (GitHub Pages)
1. En `index.html`, pegá la URL en `const API_URL_DEFAULT = '...';` (así todos los que la abran usan la misma base).
2. Repo `Hora-Salida` → Settings → Pages → Deploy from a branch → `main` / root.
3. Queda en https://zalogsafull.github.io/Hora-Salida/ → en el celular, menú de Chrome → **Agregar a pantalla principal**.

## Ubicación
- Al abrir, la app pide permiso de ubicación y elige la localidad de la lista más cercana (hasta 30 km). Se puede cambiar a mano o desactivar en Ajustes.
- Cada localidad tiene coordenadas (columnas `lat` y `lng` de la hoja). Al agregar una nueva, tocá "📍 Estoy acá" estando en el lugar, o completá lat/lng en la hoja.
- La ubicación no se guarda ni se envía a ningún lado.

## Privacidad
- Localidades: públicas, cualquiera con el link puede leer y editar (la hoja guarda fecha de cada cambio; podés ver el historial de versiones de la Sheet).
- Marcas: solo en memoria; se borran al cerrar o con "Borrar datos". No se envían a ningún servidor.
- En el dispositivo solo se guarda (si lo elegís): el número de WhatsApp, las horas requeridas y una copia de la lista de localidades para usar sin conexión.

## Cálculos (iguales a HORA SALIDA.xlsx)
- Hora de entrada = marca de entrada − horas de viaje de la localidad de entrada
- Hora de salida = marca de salida + horas de viaje de la localidad de salida
- Marca de salida desde = hora de entrada + horas a cumplir − viaje de vuelta
  (C100 7:15 · C200 1 día 12:00 · C200 2 días 10:00 el día de la vuelta; editables en Ajustes)
- Horas cumplidas = hora de salida − hora de entrada

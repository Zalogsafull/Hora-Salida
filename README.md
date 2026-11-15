# Hora Salida

App para calcular la marca de salida de los viáticos C100 / C200 y enviar el registro por WhatsApp.

**App:** https://zalogsafull.github.io/Hora-Salida/
**Localidades:** hoja `HORARIOS LOCALIDADES` de la planilla [HORA SALIDA](https://docs.google.com/spreadsheets/d/19arxGs2vqUwVSjruWBdQs78JGFwxgkoO3oPcZgGYGp0/edit) (cualquiera con el link puede verla y editarla).

## Cómo se usa
1. Elegís el tipo de viático.
2. La app detecta la localidad donde estás (si está a menos de 30 km de una de la lista); si no, la elegís: departamento → ciudad.
3. Cargás la marca de entrada → te dice desde qué hora podés hacer la marca de salida.
4. Cargás la marca de salida → te da la hora de salida y si cumplís las horas.
5. "Enviar registro por WhatsApp".

## Cálculos (iguales a la planilla)
- Hora de entrada = marca de entrada − horas de viaje de la localidad de entrada
- Hora de salida = marca de salida + horas de viaje de la localidad de salida
- Marca de salida desde = hora de entrada + horas a cumplir − viaje de vuelta
  (C100 7:15 · C200 1 día 12:00 · C200 2 días 10:00 el día de la vuelta; editables en Ajustes)
- Horas cumplidas = hora de salida − hora de entrada

## Localidades
- La app lee la hoja directamente. Para cambiar algo alcanza con editar la planilla: Departamento (solo en la primera fila de cada bloque), Localidad, Horas de traslado.
- Columnas opcionales **D = Lat** y **E = Lng**: coordenadas para que la app reconozca la localidad por ubicación. Las 45 originales ya tienen coordenadas dentro de la app.

### Editar desde la app (opcional)
1. En la planilla: Extensiones → Apps Script → pegar `Code.gs` → Guardar.
2. Implementar → Nueva implementación → Aplicación web · Ejecutar como: **Yo** · Acceso: **Cualquier usuario**.
3. Copiar la URL `/exec` y ponerla en `API_URL_DEFAULT` de `index.html` (o en Ajustes de la app).

## Privacidad
- Las marcas no se guardan: viven en la pantalla hasta que la cerrás o tocás "Borrar".
- La ubicación se usa solo para elegir la localidad; no se guarda ni se envía.
- En el teléfono quedan solo (si lo elegís) el número de WhatsApp, las horas requeridas y una copia de la lista de localidades.

## Instalar en el celular
- **Android (Chrome):** abrir la app → menú ⋮ → **Instalar app** (o "Agregar a pantalla principal").
- **iPhone (Safari):** abrir la app → botón Compartir → **Agregar a inicio**.
Queda con ícono propio, se abre a pantalla completa y funciona sin internet con la última copia de las localidades.

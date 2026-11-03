---
name: VIGÍA
description: Consola nocturna para reconstruir recorridos vehiculares a partir de observaciones dispersas.
colors:
  canvas: "#090119"
  surface: "#1a1429"
  surface-2: "#2e263b"
  surface-3: "#3b3249"
  ink: "#f4f1fa"
  muted: "#aba3be"
  on-violet-muted: "#dccff7"
  violet: "#9d76f8"
  violet-soft: "#c4a8ff"
  violet-deep: "#5a12a8"
  light: "#e4e0ec"
  muted-pill: "#bfb9cd"
  on-light: "#120a22"
  blue: "#2e86f9"
  grey: "#6b6a73"
  ok: "#6fe0a8"
  warn: "#f5b451"
  danger: "#ff8f8f"
typography:
  display:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 5.2vw, 4.75rem)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  page-title:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 4rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  section:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3.25rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  pill: "999px"
  panel: "40px"
  card: "28px"
  inner: "32px"
  field: "16px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "22px"
  lg: "40px"
  xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.light}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.pill}"
    padding: "0 26px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.muted-pill}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.pill}"
    height: "42px"
  button-round:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "62px"
  search-pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    height: "60px"
    padding: "0 28px"
  count-pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "60px"
  stage-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px"
  card:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "30px 28px"
  route-option-selected:
    backgroundColor: "{colors.light}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.pill}"
    height: "56px"
  nav-item-active:
    backgroundColor: "{colors.violet-deep}"
    textColor: "{colors.ink}"
    size: "44px"
---

# Design System: VIGÍA

## Overview

Fuente: el archivo Figma «VIGÍA-DESIGN» (páginas WEB y MOBILE), llevado a código en `src/app/globals.css`. Es un mundo nocturno: lienzo casi negro con matiz violeta, superficies violeta-gris elevadas por luminosidad, un solo acento violeta y pastillas claras para la acción principal. Sirve a operadores en sala de monitoreo con luz baja y a visitantes que conocen el producto en la landing.

La consola es modo *Operate*: escanear, comparar y actuar. La expresión vive en los detalles: el degradado violeta marca lo seleccionado, los títulos en Poppins ligera dan calma y el mapa oscuro se funde con el lienzo.

## Colors

### Primary
- **Violeta** `#9d76f8`: acento único. Texto destacado de titulares, marca, nodos físicos del mapa y números de la línea de tiempo.
- **Violeta profundo** `#5a12a8`: icono de navegación activo y fondo de los conteos secundarios.
- **Degradado de selección** `linear-gradient(100deg, #a57bf7, #7a3ade 48%, #5a0fa8)`: solo para el elemento elegido (cámara seleccionada, consulta abierta).

### Neutral
- **Lienzo** `#090119`, **superficie** `#1a1429` (panel grande), **superficie 2** `#2e263b` (tarjetas, pastillas, campos), **superficie 3** `#3b3249` (hover y elevación extra).
- **Tinta** `#f4f1fa` y **texto secundario** `#aba3be`, con contraste AA sobre superficie 2. Sobre fondos violeta, el texto secundario es `#dccff7` y nunca gris.
- **Claro** `#e4e0ec` y **gris de pastilla** `#bfb9cd` con tinta `#120a22` para las pastillas de acción.

### Estado
- Simulado `#2e86f9`, sin conexión `#6b6a73`, en línea `#6fe0a8`, advertencia `#f5b451`, peligro `#ff8f8f`. Cada estado lleva además su texto o icono: el color nunca va solo.

### Named Rules
- **Un violeta por pantalla:** el acento marca una sola cosa a la vez (lo activo o lo elegido); el resto se jerarquiza con luminosidad.
- **Estado honesto:** la pastilla «Red Barranquilla» siempre dice si la fuente es el servicio central, la demo o está desconectada.

## Typography

- **Display y títulos:** Poppins 300/400/500 (vía `next/font`), tracking -0.02 a -0.03em. El título de página termina en punto («Dispositivos de la red.»).
- **Cuerpo, etiquetas y datos:** DM Sans. Cifras con `font-variant-numeric: tabular-nums` (horas, puntajes, coordenadas, conteos).
- Escala: display de landing `clamp(2.4rem, 5.2vw, 4.75rem)`; título de consola `clamp(2rem, 3.6vw, 4rem)`; título de sección `clamp(2rem, 3.6vw, 3.25rem)`; encabezado de tarjeta 18–24px en DM Sans 500; cuerpo 15px; etiquetas 13px.
- Sin eyebrows ni kickers sobre los títulos.

## Layout

- **Consola:** riel izquierdo (marca + navegación con iconos en círculo) y espacio de trabajo con cabecera de cuenta, fila de título (volver · título · estado de red) y un **escenario**: panel redondeado de dos columnas (`1fr` + 280–350px) con el mapa a todo el ancho abajo.
- La columna derecha apila conteos en pastilla, la tarjeta de fuente de datos y el contexto de la vista (leyenda, seleccionada o resultados).
- Flujo: Resumen (mapa + «Nueva consulta» plegada) → formulario desplegado → Trayectorias estimadas (fondo del escenario en degradado violeta) → Registros de búsqueda → Dispositivos.
- **Landing:** columna centrada, secciones separadas por 110–240px, cuadrícula de tres tarjetas y un bloque de pasos con pestañas.
- **Breakpoints:** 1280px (lista de cámaras en una columna), 1020px (escenario en una columna), 860px (el riel pasa a barra inferior fija, se oculta la navegación de la landing), 420px (campos en una columna).

## Elevation & Depth

La profundidad viene de la luminosidad de las superficies (lienzo → superficie → superficie 2 → superficie 3), no de sombras. Las sombras solo aparecen con desplazamiento y desenfoque en lo que flota de verdad: menú de cuenta y popups del mapa (`0 24px 48px -16px rgba(0,0,0,.8)`), tarjeta destacada de «Nosotros» y el marco del hero (`0 40px 140px -30px rgba(157,118,248,.55)`).

## Shapes

- Pastillas (`999px`) para botones, búsqueda, conteos, rutas y cámaras.
- Panel del escenario `40px`; tarjetas internas `28–32px`; campos de administración `16px`.
- Campos del formulario de consulta: sin caja, solo línea inferior (`1px` blanco al 22%) con etiqueta visible encima.

## Components

- **Pastilla clara** (acción principal): «Buscar coincidencias», «Explorar demo», «Entrar».
- **Pastilla gris**: acción secundaria dentro de tarjetas («Actualizar red», «Conectar servicio»).
- **Botón redondo** 62px (46px pequeño): volver, cuenta, exportar, centrar mapa.
- **Pastilla de búsqueda**: filtro de cámaras o consultas; en Resumen funciona como lanzador de «Nueva consulta» y se tiñe con el degradado al abrirse.
- **Pastilla de conteo**: círculo con el número (degradado `#5c3d99 → #8f74da`) y etiqueta.
- **Tarjeta de fuente**: icono, título, texto y acción; centrada en la columna derecha, horizontal cuando ocupa la columna principal.
- **Cámara en lista**: pastilla con borde; seleccionada, en degradado.
- **Opción de ruta**: pastilla con borde; seleccionada, clara con tinta oscura.
- **Línea de tiempo**: círculos violeta numerados, nombre de la cámara y hora tabular.
- **Mapa**: OSM en raster invertido y desaturado sobre lienzo violeta; radio punteado violeta, ruta `#c4a8ff` y lugar «Barranquilla, Atlántico» abajo a la izquierda.

## Do's and Don'ts

- **Sí:** mostrar siempre el puntaje con «/ 100» y la frase de estimación, no de identificación.
- **Sí:** etiquetas visibles en todos los campos, foco visible `#c4a8ff`, `prefers-reduced-motion` respetado.
- **Sí:** un único momento de movimiento por superficie (entrada del hero, despliegue del formulario, cambio de etapa).
- **No:** texto con degradado, glass decorativo, kickers sobre títulos, bordes laterales de color en tarjetas.
- **No:** inventar datos o funciones sin respaldo del backend (filtro por placa o confirmación «¿Es este el vehículo?»: están en el Figma, pero pendientes de API).

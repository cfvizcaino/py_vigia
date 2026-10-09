# Cómo se ordenan las rutas candidatas

Implementación: `apps/backend/vigia_backend/routing.py`, modelo `weighted-evidence-v2`.
El campo histórico `confidence` conserva el nombre por compatibilidad, pero es un **puntaje heurístico 0–1**, no una probabilidad calibrada ni una identificación.

## Antes y ahora

Antes se puntuaban secuencias con 45% confianza del detector, 35% cercanía a 30 km/h y 20% dirección de imagen, con penalizaciones por distancia. Los enlaces provenían del seed y OSRM dibujaba después una única geometría. No se comparaban los caminos viales alternativos.

Ahora se sincronizan alternativas dirigidas de OSRM por par de cámaras. Se almacenan distancia, duración, costo del perfil, geometría y coordenadas utilizadas. El correlador evalúa observaciones **y** alternativas; conserva varias candidatas, incluso para la misma secuencia de cámaras. La consola dibuja exactamente la geometría elegida por el correlador cuando está disponible. Si no hay enlaces sincronizados, una geometría consultada aparte se etiqueta como **solo referencia visual**.

La dirección `izquierda-a-derecha` de una imagen no equivale a un rumbo geográfico. Dos cámaras orientadas de forma opuesta pueden ver un mismo vehículo con direcciones de imagen contrarias. Por eso se desactiva esa señal hasta tener una calibración cámara→vía; no se inventa una orientación.

## Puntaje de cada tramo

| Señal | Peso inicial | Cálculo / interpretación |
|---|---:|---|
| Calidad de detección | 35% | Promedio de las confianzas del detector en ambos extremos; no es confianza de identidad |
| Compatibilidad temporal | 40% | Cercanía entre tiempo observado y referencia de la alternativa vial |
| Apariencia disponible | 15% | Color conocido coincidente: 1; falta de color: 0,4, nunca una coincidencia fuerte |
| Costo vial | 10% | Menor costo OSRM disponible / costo de esta alternativa; no distancia mínima |

Los pesos son configurables y **no aprendidos todavía**. Deben sumar 1, ser finitos y no negativos. La versión, parámetros y contribuciones se devuelven en `explanation` y se guardan junto a la consulta para reproducir su cálculo.

Para una alternativa con duración OSRM `t`, referencia `μ = 1,35 × t`, tiempo observado `Δ` y tolerancia `σ = 0,65`:

```text
T = exp(-0,5 × (ln(Δ / μ) / σ)²)
S = (0,35 D + 0,40 T + 0,15 A + 0,10 V) × G × F
```

El factor 1,35 permite cierta demora urbana, pero **no es tráfico medido**. Si falta duración vial, se usa una velocidad supuesta de 30 km/h y se penaliza la fuente (`F=0,85`; con OSRM validado `F=1`). Si el tramo es de 500 m o más, `G=0,85`; en otro caso `G=1`. Esta penalización representa incertidumbre entre observaciones, no que una calle larga sea intrínsecamente improbable.

Filtros duros actuales: tiempo creciente, cámaras diferentes, mismo tipo de vehículo, colores conocidos sin contradicción, enlace dirigido existente, distancia positiva hasta 2 km y velocidad implícita de 8–70 km/h. Estos umbrales son del prototipo: pueden rechazar trayectos reales con paradas prolongadas o huecos mayores. No hay aún un modelo de estacionamiento. Un enlace A→B **no** autoriza el sentido B→A.

Para una secuencia, se calcula la media geométrica de los puntajes de sus tramos y se añaden 0,04 por observación adicional después de las primeras dos, hasta 0,08. El resultado se limita a 0,99. Se evita que un tramo débil quede completamente oculto tras una suma grande. Una secuencia más larga no elimina automáticamente una corta con mejor evidencia.

## Ejemplo verificable: la ruta corta no siempre gana

En `test_longer_alternative_wins_when_elapsed_time_supports_it`:

- Las mismas dos detecciones están separadas 81 segundos.
- Alternativa A: 600 m, duración OSRM 25 s; referencia 33,75 s.
- Alternativa B: 900 m, duración OSRM 60 s; referencia 81 s.
- B obtiene mejor compatibilidad temporal y gana a pesar de su mayor costo vial.
- Si se configura solo peso vial, A gana. La prueba comprueba así que los pesos cambian la decisión y que la geometría devuelta pertenece a B.

No significa que B sea el recorrido real: A con una parada también podría explicar 81 segundos. El modelo actual no observa esa parada.

## Búsqueda, límites y configuración

La búsqueda beam conserva hasta 200 estados por profundidad, seis observaciones por ruta y diez resultados. Se limita a 500 detecciones por consulta; excederlas produce un error para reducir ventana/radio. Si hay poda, `search_pruned=true`: el ranking no es una enumeración exhaustiva ni garantiza encontrar el óptimo global.

En el `.env` del backend, opcionalmente:

```dotenv
ROUTING_CONFIG_JSON='{"detection_weight":0.35,"time_weight":0.40,"appearance_weight":0.15,"road_weight":0.10,"time_factor":1.35,"time_sigma":0.65}'
```

No se permite que el navegador cambie pesos arbitrariamente. Reiniciar backend al cambiar configuración. La sincronización usa `Route` con alternativas, no `Table`, porque necesita conservar cada geometría. `Table` se prueba como matriz de referencia; no ofrece por sí solo todas las opciones viales. OSRM puede devolver menos alternativas que las solicitadas y no enumera todas las calles posibles. [API oficial](https://project-osrm.org/docs/v5.24.0/api/).

## Pendientes antes de afirmar “la más probable”

1. Recorridos etiquetados independientes, con distractores del mismo tipo/color; medir top-k y falsos enlaces.
2. Aprender/calibrar pesos, demoras por franja horaria, paradas y tolerancia de reloj sin usar la misma muestra para entrenar y evaluar.
3. Calibrar orientación y carriles de cada cámara; incorporar señales visuales validadas. Un track local no identifica el vehículo entre cámaras.
4. Ampliar y versionar el grafo metropolitano; el extracto pequeño de validación puede recortar desvíos.
5. Medir concurrencia y búsquedas densas. Un servicio funcional no demuestra escalabilidad ilimitada.

El seed antiguo tiene tiempos generados con distancias supuestas. Al importar calles reales algunos recorridos dejan de ser físicamente compatibles: esto es un hallazgo de validación, no motivo para aflojar filtros hasta recuperar todas las etiquetas.

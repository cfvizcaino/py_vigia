# Primer informe — VIGIA

## Resumen

VIGIA es una plataforma de vigilancia comunitaria que utiliza cámaras distribuidas para detectar vehículos y estimar su recorrido. Cada dispositivo procesa el video localmente y comparte únicamente la información necesaria cuando la plataforma realiza una consulta, reduciendo la transmisión permanente de video.

## Objetivo general

Diseñar e implementar un prototipo que permita detectar vehículos desde varias cámaras, consultar sus características y construir una trayectoria aproximada mediante la relación espacial y temporal de las detecciones.

## Objetivos específicos

- Detectar automóviles y motocicletas en los videos capturados.
- Registrar las características principales de cada detección.
- Consultar las cámaras cercanas a una ubicación de interés.
- Relacionar detecciones de distintas cámaras para estimar rutas posibles.
- Visualizar las detecciones y la trayectoria estimada en una plataforma web.
- Proteger el acceso y reducir la transmisión innecesaria de imágenes o video.

## Alcance del primer prototipo

El prototipo funcional trabajará inicialmente con **4 cámaras reales o simuladas**. Dos estarán ubicadas en puntos cercanos de un mismo sector y las otras dos estarán más separadas, con el fin de probar recorridos cortos y recorridos con vacíos de observación.

El sistema incluirá:

- Detección de automóviles y motocicletas.
- Seguimiento del vehículo mientras permanece dentro de una cámara.
- Registro local de tipo, color, dirección, fecha, hora y ubicación de la cámara.
- Consulta de cámaras según ubicación y tiempo.
- Construcción y visualización de una ruta aproximada.
- Administración básica de usuarios, dispositivos e historial de consultas.

No se garantizará la identificación exacta de un vehículo. El resultado será una ruta probable con detecciones candidatas. El reconocimiento de marca, modelo y placa se manejará como una extensión opcional y no como requisito del primer prototipo.

## Criterio inicial de precisión

El prototipo se considerará exitoso si detecta correctamente al menos el **80 % de los vehículos visibles** en el escenario controlado de prueba. También se revisarán los falsos positivos para evitar que el porcentaje de detección se alcance a costa de identificar objetos que no son vehículos.

Este valor se confirmará después de ejecutar una primera prueba con el modelo preentrenado y el conjunto local de videos.

## Características relevantes

| Característica | Primer prototipo |
|---|---|
| Tipo de vehículo | Sí: automóvil o motocicleta |
| Color | Sí, utilizando categorías generales |
| Dirección | Sí, calculada a partir del movimiento dentro de la cámara |
| Fecha y hora | Sí |
| Ubicación | Sí, corresponde a la ubicación de la cámara |
| Marca y modelo | Opcional, sujeto a la calidad de la imagen |
| Placa | Fuera del alcance inicial; requiere evaluación técnica y legal |

## Dispositivos cercanos

Para el prototipo, dos dispositivos se considerarán cercanos cuando estén a una distancia máxima aproximada de **500 metros por la red vial** y exista una ruta razonable entre ellos. No se utilizará únicamente la distancia en línea recta.

Las cámaras ubicadas entre **500 metros y 2 kilómetros** se considerarán distantes. Sus detecciones podrán relacionarse, pero el resultado tendrá menor confianza debido a que el vehículo puede tomar rutas no cubiertas por el sistema. Estos valores son iniciales y deberán ajustarse al lugar utilizado para las pruebas.

## Construcción de la trayectoria

La trayectoria se construirá ordenando las detecciones compatibles según hora, ubicación, dirección y características del vehículo.

Se evaluarán dos escenarios:

1. **Cámaras cercanas:** cámaras ubicadas en calles consecutivas o dentro del mismo sector. Se espera una trayectoria más continua y con mayor confianza.
2. **Cámaras distantes:** cámaras separadas por calles sin cobertura. El sistema mostrará una ruta aproximada y señalará los tramos que no fueron observados.

Cuando existan varios vehículos similares o diferentes rutas posibles, la plataforma deberá presentar el resultado como una estimación y no como una identificación definitiva.

## Prototipo de visión por computador

Se utilizará un modelo YOLO preentrenado como punto de partida para detectar automóviles y motocicletas. Posteriormente se evaluará su ajuste con videos propios del escenario de prueba. El seguimiento dentro de cada cámara y la comparación entre cámaras serán componentes separados de la detección.

## Consideraciones legales y de privacidad

El prototipo tendrá fines académicos y se probará, preferiblemente, con videos controlados y vehículos de participantes informados. Antes de utilizar cámaras orientadas hacia espacios públicos se deberán revisar, con los asesores y la Universidad, al menos los siguientes aspectos:

- Tratamiento de imágenes y demás datos personales conforme a la [Ley 1581 de 2012](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981).
- Aviso sobre la existencia y finalidad de las cámaras.
- Definición del responsable del tratamiento de la información.
- Acceso restringido únicamente a usuarios autorizados.
- Tiempo limitado de conservación y eliminación de los datos.
- Protección de rostros, placas e imágenes que no sean necesarias.
- Registro de las consultas y prohibición de usos distintos al propósito académico.
- Revisión de la guía y los conceptos de la Superintendencia de Industria y Comercio sobre [tratamiento de datos mediante videovigilancia](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/tratamiento-de-datos-personales-traves-de-camaras-de-videovigilancia).

La viabilidad técnica del reconocimiento de placas no implica que su recolección o almacenamiento esté automáticamente autorizado. Su inclusión deberá aprobarse de manera independiente después de revisar la necesidad, proporcionalidad y medidas de protección aplicables.

## Decisiones pendientes

- Confirmar el lugar y la distribución de las 4 cámaras.
- Definir el hardware que representará los dispositivos de captura.
- Confirmar el porcentaje mínimo de detección con los tutores.
- Decidir si se enviarán miniaturas de los vehículos o solamente datos descriptivos.
- Establecer el tiempo de conservación local de las detecciones.
- Determinar si marca, modelo o placa se evaluarán como funcionalidades opcionales.

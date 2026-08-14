# Vigia

## Resumen ejecutivo

Presenta una síntesis del proyecto, incluyendo el contexto en el que surge, la problemática u oportunidad identificada, la solución propuesta, su alcance general y el valor que aporta. Debe permitir al lector comprender rápidamente de qué trata el proyecto y por qué es relevante.


## Documentación del repositorio

## Prototipo web

La primera consola de monitoreo se encuentra en [`apps/web`](./apps/web). Incluye un mapa de cámaras, formulario de consulta y trayectoria simulada. Las instrucciones para ejecutarla están en su [README](./apps/web/README.md).

## Nodo de visión

El primer nodo de captura se encuentra en [`apps/vision`](./apps/vision). Recibe video o RTSP, detecta y sigue automóviles y motocicletas con YOLO y genera un snapshot JSON. Consulta su [guía de configuración](./apps/vision/README.md) para conectar una Tapo C110.

## Docker

El archivo [`compose.yaml`](./compose.yaml) permite levantar la web y, mediante un perfil opcional, el nodo de visión. PostgreSQL/PostGIS y Mosquitto se añadirán cuando se implemente el backend y las consultas distribuidas.

```bash
# Solo la web
docker compose up --build web

# Web y visión
docker compose --profile vision up --build
```

### Primer informe

- [Primer Informe.md](./PrimerInforme.md): Documento que presenta el planteamiento del problema, los objetivos, la solución propuesta, el estado del arte, la metodología de desarrollo y el plan de trabajo del proyecto.

### Segundo informe

- [Segundo Informe.md](./SegundoInforme.md): Documento que presenta el estado actual del proyecto, incluyendo los avances logrados, las validaciones realizadas y los aspectos pendientes.


### Informe final

| Documento | Descripción |
|---|---|
| [InformeFinal.md](./InformeFinal.md) | Documento principal del proyecto |
| [Instalación.md](./Instalación.md) | Guía de instalación, desarrollo y despliegue |
| [Desarrollo.md](./Desarrollo.md) | Detalles técnicos del desarrollo |

## Estudiantes

| Nombre | GitHub |
|---|---|
| Cristian Vizcaíno | [@cfvizcaino](https://github.com/cfvizcaino) |
| Juan Delgado | [@Deelgado](https://github.com/Deelgado) |
| Daniel Castañeda | [@DanielCM21](https://github.com/DanielCM21) |

## Tutores

- Augusto Salazar  
- Margarita Gamarra

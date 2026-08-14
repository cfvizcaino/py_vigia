# ADR-001: plataforma central modular y nodos edge

- **Estado:** aceptada
- **Fecha:** 2026-08-13

## Contexto

VIGIA necesita procesar video cerca de cada cámara, minimizar la transferencia de información y permitir que una plataforma coordine múltiples dispositivos. Un diseño de microservicios desde el primer prototipo añadiría despliegues y fallas distribuidas antes de validar el caso de uso.

## Decisión

Se adopta una arquitectura híbrida:

- procesamiento de video en nodos edge independientes;
- plataforma central como monolito modular durante el proyecto;
- comunicación dirigida por eventos cuando se incorporen múltiples nodos;
- contratos versionados que no dependan de YOLO, Tapo o un lenguaje concreto.

## Consecuencias

- El video y las credenciales permanecen en el nodo.
- La web y el futuro backend consumen interfaces estables.
- El nodo puede migrar de un computador a Android, Raspberry Pi o Jetson.
- MQTT, PostGIS y autenticación se incorporan después de validar el flujo vertical.

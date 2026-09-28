# Contratos de VIGIA

Este directorio contiene los contratos independientes de lenguaje que permiten evolucionar web, backend y nodos edge sin acoplar sus implementaciones.

- [`detection-snapshot.schema.json`](./detection-snapshot.schema.json): snapshot local 1.0 conservado por compatibilidad.
- [`detection-envelope-1.1.schema.json`](./detection-envelope-1.1.schema.json): evento edge→centro idempotente, ordenado por sesión y con versiones de nodo/modelo.

Los cambios incompatibles deben crear una nueva versión del esquema; no se modifica silenciosamente un contrato ya utilizado.

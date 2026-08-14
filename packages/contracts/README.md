# Contratos de VIGIA

Este directorio contiene los contratos independientes de lenguaje que permiten evolucionar web, backend y nodos edge sin acoplar sus implementaciones.

- [`detection-snapshot.schema.json`](./detection-snapshot.schema.json): snapshot producido por un nodo de visión.

Los cambios incompatibles deben crear una nueva versión del esquema; no se modifica silenciosamente un contrato ya utilizado.

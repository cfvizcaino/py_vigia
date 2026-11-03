# Caddy del piloto con límite de peticiones por IP (caddy-ratelimit, del autor de Caddy).
# CI la publica en GHCR como vigia-caddy; el plugin va fijado a un commit.
FROM docker.io/library/caddy:2.10-builder-alpine AS build
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM docker.io/library/caddy:2.10-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy

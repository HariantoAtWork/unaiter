# Unaiter wiki

Unaiter is a Nuxt 4 admin app for managing **OpenAI-compatible providers** and API keys. It runs primarily via Docker Compose (`dc.sh` + `_dev.yml` / production compose examples).

## Contents

- [Getting started](Getting-Started.md)
- [Architecture](Architecture.md)
- [Auth and crypto (server-only)](Auth-and-Crypto.md)
- [Dashboard](Dashboard.md)
- [Providers](Providers.md)
- [Router](Router.md)
- [Docker and `dc.sh`](Docker-and-dc-sh.md)
- [Environment](Environment.md)
- [Data storage](Data-Storage.md)

## Hard rule: crypto is server-only

- **Allowed:** `node:crypto` under `src/unaiter/server/` (session sealing, timing-safe compares, app secret generation).
- **Forbidden:** Web Crypto / `crypto.*` / `node:crypto` in `src/unaiter/app/` (browser secure-context / HTTPS pain).
- **IDs:** use the `uuid` package (`v7`) via `server/utils/id.ts`, not `crypto.randomUUID()`.

See [Auth and crypto](Auth-and-Crypto.md) and run:

```bash
./scripts/check-no-frontend-crypto.sh
```

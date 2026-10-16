# Architecture

## Layout

```text
unaiter/
  dc.sh                 # build / push / dev lifecycle
  _dev.yml              # hot-reload Nuxt (bun)
  _build.yml / _push.yml
  .env.example
  .data/                # runtime data (gitignored) → mounted as /var/lib/unaiter
  src/unaiter/        # Nuxt 4 app
    app/                # UI only — no crypto
    server/             # Nitro APIs + utils — crypto allowed here
```

## Stack

| Layer | Choice |
|-------|--------|
| App | Nuxt 4 + Vue 3 |
| UI | `@nuxt/ui` (emerald primary in `app.config.ts`) |
| Runtime | Bun in Docker |
| Auth | Sealed session cookie (server crypto) |
| IDs | `uuid` v7 (`server/utils/id.ts`) |
| Provider store | JSON under `dataRoot` |

## Routes

| Path | Purpose |
|------|---------|
| `/login` | Sign in (auth layout) |
| `/` | Overview dashboard |
| `/providers` | CRUD for OpenAI-compatible providers, keys, and admin models |
| `/router` | Intent router admin (local Nuxt module under `plugins/router`) |
| `/v1/models` | OpenAI-compatible list of **enabled** catalogue models (`{slug}/{modelId}`), plus `router/auto` when enabled |
| `/v1/chat/completions` | Proxies to the provider resolved from `{slug}/{modelId}`; `router/auto` plans steps, then proxies or orchestrates |

Global middleware `auth.global.ts` redirects unauthenticated users to `/login` (except `/login` and `/v1/*`).

## API (selected)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | Sets sealed session |
| POST | `/api/auth/logout` | Clears session |
| GET | `/api/auth/me` | Current user or `null` |
| GET | `/api/overview` | Counts + provider summary |
| GET | `/api/router/config` | Intent router settings |
| PUT | `/api/router/config` | Update intent router settings |
| GET | `/api/providers` | List (keys masked) |
| POST | `/api/providers` | Create + bulk keys |
| GET | `/api/providers/:id` | Single provider (keys masked) |
| PATCH | `/api/providers/:id` | Update fields; optional append keys |
| DELETE | `/api/providers/:id` | Delete provider and all keys |
| DELETE | `/api/providers/:id/keys/:keyId` | Remove one key |
| PATCH | `/api/providers/:id/keys/:keyId/move` | Reorder key (`direction`: `up` \| `down`, or `toIndex`) |
| POST | `/api/providers/:id/keys/:keyId/exhaust` | Apply key-list method (Roundabout → move to end) |
| GET | `/v1/models` | Public OpenAI-compatible enabled models (`{slug}/{modelId}`) |
| POST | `/v1/chat/completions` | Route by `{slug}/{modelId}`; Roundabout keys; exhaust on 429/402 |
| GET | `/api/providers/:id/models` | Admin model catalogue (includes disabled) |
| POST | `/api/providers/:id/models` | Bulk-add model ids |
| POST | `/api/providers/:id/models/fetch` | Retrieve from provider `GET /models` |
| POST | `/api/providers/:id/models/test` | Test enabled models; disable failures |
| PATCH | `/api/providers/:id/models/:modelRowId` | Toggle `enabled` |

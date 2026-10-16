# Intent router

Local Nuxt module at `src/unaiter/plugins/router` (same layout as dns01-proxy plugins: `index.ts` + `runtime/`).

## Behaviour

1. Admin configures classifier + writing/code specialists at **`/router`** (stored in `dataRoot/router.json`).
2. When enabled, **`router/auto`** (or the configured public id) appears on **`GET /v1/models`**.
3. **`POST /v1/chat/completions`** with that model id:
   - A planner model returns ordered steps: `writing` and/or `code` with a short `brief` each
   - **One step** → proxy to that specialist (streaming allowed)
   - **Several steps** → run specialists in parallel, merge sections into one completion (non-streaming)
   - Headers: `x-unaiter-route`, `x-unaiter-routed-model`, `x-unaiter-orchestrated`
4. Planner failure **fail-opens to a single `code` step**.

### Example (Dutch multi-part)

> Kan je me een gedicht schrijven, en vervolgens een Javascript code hoe je een ball moet stuiteren.

Planner → two steps → Gemma (poem) + Flash Next (JS) → one reply with `### 1. Writing` then `### 2. Code`.

Multi-step requests must use `stream: false` (or omit `stream`). `stream: true` returns `400`.

## Defaults

| Field | Default |
|-------|---------|
| Public id | `router/auto` |
| Classifier / planner | `1-min-ai/gpt-4.1-nano` |
| Writing | `ollama-cloud/gemma4:31b` |
| Code | `flash-next/Qwen3.8 Flash Next` |

Specialists must be **enabled** catalogue models (`{providerSlug}/{modelId}`). Max **4** steps.

## Admin UI

**`/router`** saves classifier + specialists and includes a **Try chat** panel: `POST /v1/chat/completions` with `stream: false`, then shows the reply and headers `x-unaiter-route`, `x-unaiter-routed-model`, `x-unaiter-orchestrated`.

## Admin API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/router/config` | Auth required |
| PUT | `/api/router/config` | Auth required; body matches config shape |

## Layout

```text
plugins/router/
  index.ts                 # defineNuxtModule
  runtime/
    shared/                # types + defaults (#router-shared)
    composables/
    pages/router/
    server/
      api/router/
      utils/
```

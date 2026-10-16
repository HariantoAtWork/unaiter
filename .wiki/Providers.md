# Providers

OpenAI-compatible provider registry stored in `dataRoot/providers.json`. Full CRUD from `/providers`.

## UI

- Visiting `/providers` while the list is **empty** opens the add modal automatically.
- **Add provider** (navbar / empty state) opens create mode.
- Each row has **edit** (pencil) and **delete** (trash). Destructive actions use an in-app confirm dialog; success/errors use toasts (no `alert` / `confirm`).
- API keys open in a **right drawer** (hidden by default) via the “N keys” button. Each key is a row (id · hint + validity); reorder with **drag** or **up/down**. No delete control there.
- Models open in a **right drawer** via the “N models” button (see below).
- Edit modal updates name / slug / base URL / **key list method**, optionally **appends** more bulk keys, and lists existing keys with **×** to remove.

## Models (admin catalogue)

Per-provider model list stored on the provider. **Unique** by `modelId` within a provider.

**Enabled** models are listed on OpenAI-compatible **`GET /v1/models`** as `{providerSlug}/{modelId}` (e.g. `ollama-cloud/gemma4:31b`). Disabled models stay in the admin catalogue only.

### Routing

Clients must call models with that prefixed id:

```http
POST /v1/chat/completions
{ "model": "ollama-cloud/gemma4:31b", "messages": […] }
```

For automatic writing/code selection, use the [intent router](Router.md) public id (default `router/auto`) instead.

Unaiter:

1. Splits on the **first** `/` → provider slug + upstream model id  
2. Checks the model exists and is **enabled**  
3. Picks an API key via the provider’s key method (**Roundabout** = first in the ordered list)  
4. Forwards to `{baseUrl}/chat/completions` with the **unprefixed** model id  
5. On **429** / **402** (or network failure), marks that key exhausted (moves to end) and retries with the next key

Drawer actions:

| Action | Behaviour |
|--------|-----------|
| Retrieve from `/models` | `GET {baseUrl}/models` with a provider key; merges new ids (`source: fetched`) |
| Add in bulk | One model id per line; duplicates skipped (`source: manual`) |
| Test models | Probes enabled models via a tiny `chat/completions`; failures are tagged **disabled** |
| Enable toggle | Per-row switch |
| Copy | Copies routable id `{providerSlug}/{modelId}` to the clipboard |
| Filter | All / Enabled / Disabled tabs + search by model id |

## Key list method

Stored as `keyMethod` on each provider. Configurable **only when editing** a provider (new providers default to Roundabout).

| Method | Behaviour |
|--------|-----------|
| **Roundabout** (`roundabout`) | Default. When a key is exhausted, that key moves to the **end** of the list. |

More methods can be added later. Exhaustion is applied via `POST /api/providers/:id/keys/:keyId/exhaust` (`exhaustProviderKey`).

## Form fields

| Field | Behaviour |
|-------|-----------|
| Name | Required |
| Slug | Auto from name; editable |
| Base URL | OpenAI-compatible root, e.g. `https://api.openai.com/v1` |
| Key list method | Edit only. Default Roundabout |
| Bulk keys | Create: required. Edit: optional append. One entry per line (see below) |
| Auto-check keys | Optional: `GET {baseUrl}/models` with `Authorization: Bearer …`; only valid keys saved |

## Bulk key lines

```text
sk-key-here
my-id|sk-key-something
cursor@harianto.dev|another-key
```

- No `|` → API key only; **uuid v7** id is generated (`uuid` package, server-side).
- `id|key` → use the given id (email or custom string ok).
- Duplicate API keys (in the paste or already stored anywhere) are **skipped**.

## Public API shape

List/get/update responses **mask** secrets: only a hint like `••••abcd` is returned. Full keys never go to the browser intentionally. `keyMethod`, `modelCount`, and `enabledModelCount` are included; full model rows load from `/api/providers/:id/models`.

## Server helpers

See `server/utils/providers.ts`, `providerKeyMethods.ts`, `providerKeyOps.ts`, and `providerModels.ts`:

- `listProviders` / `getProvider` / `createProvider` / `updateProvider` / `deleteProvider`
- `deleteProviderKey` / `moveProviderKey` / `exhaustProviderKey`
- `listProviderModels` / `addProviderModelsBulk` / `fetchProviderModels` / `testProviderModels` / `setProviderModelEnabled`
- `parseBulkKeys()` for bulk paste
- `toPublicProvider()` for masked responses

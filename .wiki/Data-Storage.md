# Data storage

Runtime files live under **`dataRoot`** (Docker: `/var/lib/unaiter` → host `.data/` or `./data/unaiter`).

| File | Purpose |
|------|---------|
| `app.secret` | Server session seal secret (≥32 chars, mode `0600`) |
| `providers.json` | Providers + API keys (mode `0600`) |
| `router.json` | Intent router config (classifier + writing/code specialists) |

Helpers:

- `server/utils/dataRoot.ts` — `dataRoot()` / `ensureDataRoot()`
- `.data/` and `/data/` are gitignored

Never commit secrets or provider key files.

# oven/bun:1.4.0 is not published on Docker Hub yet.
# Official images that ship Bun 1.4.0 are canary / canary-slim.
# Install and Nuxt build run on the host CPU. QEMU amd64 on Apple Silicon
# crashes Bun (SIGILL). The Nitro output is JS; only the runner is per-arch.
FROM oven/bun:canary-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:canary-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
# OpenCode CLI (bun global install, no lifecycle scripts).
RUN bun add -g opencode-ai
COPY --from=build /app/.output .output
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]

/**
 * Relay every OpenAI-compatible `/v1/*` path the upstream offers, except
 * `/v1/models` (Unaiter catalogue). POST `/v1/chat/completions` keeps its
 * dedicated handler for intent routing and adapters.
 */
export default defineEventHandler(async (event) => {
  return proxyOpenAiPassthrough(event)
})

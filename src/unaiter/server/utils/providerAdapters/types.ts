export type PrepareChatBodyResult = {
  body: Record<string, unknown>
  forcedStream: boolean
}

export type FinalizeChatResponseResult = {
  status: number
  headers: Headers
  payload: Record<string, unknown>
} | null

export type ProviderAdapter = {
  id: string
  /** Shown in Edit Provider. */
  label: string
  /**
   * Optional URL hint for docs / tooling only. Not used to auto-select
   * adapters — specialists are opt-in via explicit `adapterId`.
   */
  match?: (baseUrl: string) => boolean
  resolveBaseUrl: (baseUrl: string) => string
  /**
   * Optional: model-discovery URL. Some providers keep the model list on a
   * different path than chat (OpenCode: `/inference/v1/models`).
   * Defaults to `<resolveBaseUrl>/models`.
   */
  resolveModelsUrl?: (baseUrl: string) => string
  /**
   * Optional: chat completions URL. Defaults to
   * `<resolveBaseUrl>/chat/completions` (no trailing slash).
   */
  resolveChatCompletionsUrl?: (baseUrl: string) => string
  resolveApiKey: (apiKey: string, modelId: string) => string
  /**
   * Optional: rewrite catalogue / upstream model ids (e.g. Gemini strips a
   * leading `models/` so chat completions accept the bare id).
   */
  normalizeModelId?: (modelId: string) => string
  /**
   * Optional: rewrite `/models` JSON before the default OpenAI `data[]` parse
   * (e.g. Rewind returns `{ models: [...] }` instead of `{ data: [...] }`).
   */
  normalizeModelsPayload?: (payload: unknown) => unknown
  upstreamHeaders: (
    apiKey: string,
    ctx?: { modelId?: string },
  ) => Record<string, string>
  prepareChatBody: (body: Record<string, unknown>) => PrepareChatBodyResult
  /**
   * When prepareChatBody forced stream but the client wanted JSON, return an
   * aggregated payload. Return null to passthrough the upstream response.
   */
  finalizeChatResponse: (
    response: Response,
    ctx: { forcedStream: boolean },
  ) => Promise<FinalizeChatResponseResult>
  /**
   * Optional: rewrite upstream response headers before they reach the client.
   * Receives hop-by-hop headers already stripped.
   */
  sanitizeClientHeaders?: (headers: Headers) => Headers
  /**
   * Optional: rewrite the upstream response body (e.g. normalise SSE).
   * `contentType` is the upstream Content-Type before sanitise.
   */
  transformUpstreamBody?: (
    body: ReadableStream<Uint8Array>,
    ctx: { contentType: string },
  ) => ReadableStream<Uint8Array>
}

export type AdapterPublic = {
  id: string
  label: string
}

export type ResolveAdapterInput = {
  adapterId?: string | null
  baseUrl?: string | null
}

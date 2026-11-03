type Body = {
  ids?: string[]
  /** `formats` = API hats (default); `tools` = tool-calling probe. */
  kind?: 'formats' | 'tools'
}

/** Enqueue a model test job for this provider (runs when the provider slot is free). */
export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Provider id is required' })
  }

  const body = (await readBody<Body>(event).catch(() => null)) || {}
  const kind = body.kind === 'tools' ? 'tools' : 'formats'
  return enqueueProviderModelTest(id, body.ids, event, kind)
})

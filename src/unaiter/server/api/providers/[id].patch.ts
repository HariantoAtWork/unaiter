type Body = {
  name?: string
  slug?: string
  baseUrl?: string
  adapterId?: string
  keyMethod?: 'roundabout'
  keys?: string
  validateKeys?: boolean
  enabled?: boolean
}

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Provider id is required' })
  }

  const body = await readBody<Body>(event)

  // Lightweight toggle from the providers list (no form fields).
  if (
    typeof body.enabled === 'boolean'
    && body.name === undefined
    && body.baseUrl === undefined
  ) {
    return setProviderEnabled(id, body.enabled, event)
  }

  return updateProvider(id, {
    name: body.name || '',
    slug: body.slug,
    baseUrl: body.baseUrl || '',
    adapterId: body.adapterId,
    keyMethod: body.keyMethod,
    keysRaw: body.keys,
    validateKeys: body.validateKeys,
  }, event)
})

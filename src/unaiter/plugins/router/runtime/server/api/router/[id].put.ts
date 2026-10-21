import { updateCustomRoute } from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Route id is required' })
  }
  const body = await readBody<{
    name?: string
    slug?: string
    modelIds?: string[]
  }>(event)
  return updateCustomRoute(id, {
    name: body?.name,
    slug: body?.slug,
    modelIds: body?.modelIds,
  }, event)
})

import { createCustomRoute } from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const body = await readBody<{
    name?: string
    slug?: string
    modelIds?: string[]
  }>(event)
  return createCustomRoute({
    name: body?.name ?? '',
    slug: body?.slug,
    modelIds: body?.modelIds,
  }, event)
})

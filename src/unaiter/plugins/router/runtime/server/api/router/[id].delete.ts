import { deleteCustomRoute } from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Route id is required' })
  }
  return deleteCustomRoute(id, event)
})

import {
  findCustomRouteById,
  toPublicCustomRoute,
} from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Route id is required' })
  }
  const route = findCustomRouteById(id, event)
  if (!route) {
    throw createError({ statusCode: 404, statusMessage: 'Route not found' })
  }
  return toPublicCustomRoute(route)
})

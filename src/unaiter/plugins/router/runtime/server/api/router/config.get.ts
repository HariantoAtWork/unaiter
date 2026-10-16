import { getIntentRouterPublic } from '../../utils/routerConfig'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  return getIntentRouterPublic(event)
})

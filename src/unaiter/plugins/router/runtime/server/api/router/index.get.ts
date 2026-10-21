import { listCustomRoutesPublic } from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  return { routes: listCustomRoutesPublic(event) }
})

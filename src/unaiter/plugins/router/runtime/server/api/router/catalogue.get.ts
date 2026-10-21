import { listCatalogueModels } from '../../utils/customRoutes'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  return { models: listCatalogueModels(event) }
})

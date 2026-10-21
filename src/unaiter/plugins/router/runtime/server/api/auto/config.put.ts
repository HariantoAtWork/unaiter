import type { IntentRouterConfig } from '../../../../shared/types'
import {
  readIntentRouterConfig,
  writeIntentRouterConfig,
} from '../../utils/routerConfig'

export default defineEventHandler(async (event) => {
  await requireAuthUser(event)
  const body = await readBody<Partial<IntentRouterConfig>>(event)
  const current = readIntentRouterConfig(event)
  return writeIntentRouterConfig(
    {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      publicModelId: body.publicModelId ?? current.publicModelId,
      classifierModelId: body.classifierModelId ?? current.classifierModelId,
      routes: {
        writing: body.routes?.writing ?? current.routes.writing,
        code: body.routes?.code ?? current.routes.code,
      },
    },
    event,
  )
})

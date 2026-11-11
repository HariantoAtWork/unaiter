import { expect, test } from 'bun:test'
import {
  completionHasToolCalls,
  toolsProbeBody,
} from './openaiCompatible'

test('toolsProbeBody uses required get_weather by default', () => {
  const body = toolsProbeBody('halogen-npu')
  expect(body.model).toBe('halogen-npu')
  expect(body.tool_choice).toBe('required')
  expect(body.temperature).toBe(0)
  expect(body.max_tokens).toBe(256)
  const tools = body.tools as Array<{ function: { name: string } }>
  expect(tools[0]?.function.name).toBe('get_weather')
})

test('completionHasToolCalls requires a function name', () => {
  expect(completionHasToolCalls({
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'hi', tool_calls: [{ id: '1', type: 'function', function: { name: '' } }] },
    }],
  })).toBe(false)

  expect(completionHasToolCalls({
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Amsterdam"}' },
        }],
      },
    }],
  })).toBe(true)
})

test('completionHasToolCalls accepts finish_reason tool_calls alone', () => {
  expect(completionHasToolCalls({
    choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null } }],
  })).toBe(true)
})

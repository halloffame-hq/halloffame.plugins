import { describe, expect, it } from 'vitest'

import { WorkersAIResponse } from '../src/WorkersAIResponse'

describe('WorkersAIResponse', () => {
  it('normalizes the legacy Workers AI response shape', () => {
    const response = new WorkersAIResponse({
      response: 'Done.',
      tool_calls: [{ name: 'halloffame_request', arguments: {} }],
    }).normalize()

    expect(response.text).toBe('Done.')
    expect(response.toolCalls).toHaveLength(1)
  })

  it('normalizes the OpenAI-compatible response shape', () => {
    const response = new WorkersAIResponse({
      choices: [
        {
          message: {
            content: 'Checked mentions.',
            tool_calls: [{ id: 'call-1', function: { name: 'halloffame_request' } }],
          },
        },
      ],
    }).normalize()

    expect(response.text).toBe('Checked mentions.')
    expect(response.toolCalls).toHaveLength(1)
  })

  it('normalizes structured text content', () => {
    const response = new WorkersAIResponse({
      choices: [{ message: { content: [{ type: 'text', text: 'Completed.' }] } }],
    }).normalize()

    expect(response.text).toBe('Completed.')
  })

  it('normalizes a Workers API result envelope', () => {
    const response = new WorkersAIResponse({
      result: {
        output_text: 'Updated the profile.',
        tool_calls: [{ name: 'halloffame_request', arguments: {} }],
      },
    }).normalize()

    expect(response.text).toBe('Updated the profile.')
    expect(response.toolCalls).toHaveLength(1)
  })
})

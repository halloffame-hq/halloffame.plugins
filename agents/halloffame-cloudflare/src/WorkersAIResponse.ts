import type { ModelUsage } from './types'

export interface NormalizedModelResponse {
  text: string
  toolCalls: unknown[]
  usage: ModelUsage
}

export class WorkersAIResponse {
  constructor(private readonly value: unknown) {}

  /** The answer as given, which JSON mode may hand back already parsed. */
  content(): unknown {
    const envelope = this.record(this.value)
    const nested = this.record(envelope.result)
    const result = Object.keys(nested).length > 0 ? nested : envelope
    const choice = Array.isArray(result.choices) ? this.record(result.choices[0]) : {}

    return result.response ?? result.output_text ?? this.record(choice.message).content
  }

  normalize(): NormalizedModelResponse {
    const envelope = this.record(this.value)
    const nested = this.record(envelope.result)
    const result = Object.keys(nested).length > 0 ? nested : envelope
    const choice = Array.isArray(result.choices) ? this.record(result.choices[0]) : {}
    const message = this.record(choice.message)
    const content = result.response ?? result.output_text ?? message.content

    return {
      text: this.text(content),
      toolCalls: this.toolCalls(result.tool_calls ?? message.tool_calls),
      usage: this.usage(this.record(result.usage ?? envelope.usage)),
    }
  }

  /** Token counts, in either the OpenAI-style or the input/output naming. */
  private usage(value: Record<string, unknown>): ModelUsage {
    const count = (...keys: string[]) => {
      const found = keys.map((key) => value[key]).find((entry) => typeof entry === 'number')

      return typeof found === 'number' ? found : 0
    }

    return {
      inputTokens: count('prompt_tokens', 'input_tokens'),
      outputTokens: count('completion_tokens', 'output_tokens'),
    }
  }

  private text(value: unknown): string {
    if (typeof value === 'string') return value.trim()
    if (!Array.isArray(value)) return ''

    return value
      .map((part) => {
        const item = this.record(part)

        return typeof item.text === 'string' ? item.text : ''
      })
      .join('')
      .trim()
  }

  private toolCalls(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}

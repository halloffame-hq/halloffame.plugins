export interface NormalizedModelResponse {
  text: string
  toolCalls: unknown[]
}

export class WorkersAIResponse {
  constructor(private readonly value: unknown) {}

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

import type { HostedTrigger, HttpMethod } from './types'

const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const
const MAX_REPLY_LENGTH = 1000

type Reaction = (typeof REACTIONS)[number]

/** One interaction with what the agent needs to answer it. */
interface InteractionContext {
  index: number
  trigger: HostedTrigger
  post: { text: string; author: string | null }
  comment: { id: string; text: string; author: string | null } | null
}

/** What the model decided for one interaction, once checked. */
export interface ReplyDecision {
  index: number
  action: 'reply' | 'react' | 'skip'
  text?: string
  reaction?: Reaction
}

export interface StructuredRepliesOptions {
  /** Call the Hall Of Fame API with the run's credential. */
  request: (method: HttpMethod, path: string, body?: unknown) => Promise<unknown>
  /** Ask the model once, constrained to a JSON schema. */
  ask: (messages: Record<string, unknown>[], schema: Record<string, unknown>) => Promise<unknown>
}

/** The answer the model must give: a decision per interaction and a summary. */
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['responses', 'summary'],
  properties: {
    responses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'action'],
        properties: {
          index: { type: 'integer' },
          action: { type: 'string', enum: ['reply', 'react', 'skip'] },
          text: { type: 'string' },
          reaction: { type: 'string', enum: [...REACTIONS] },
        },
      },
    },
    summary: { type: 'string' },
  },
}

/**
 * Routine replies in one structured model call.
 *
 * The interactions are read first, the model decides once what to do about
 * each, and every decision is checked before it is carried out. The API checks
 * again: an interaction run may only act on the Posts it was asked about.
 */
export class StructuredReplies {
  constructor(private readonly options: StructuredRepliesOptions) {}

  async answer(triggers: HostedTrigger[], systemPrompt: string): Promise<{ summary: string }> {
    const contexts = await this.collect(triggers)
    const raw = await this.options.ask(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'system',
          content:
            'Decide what to do about each interaction below. Reply with one concise, genuine answer when you have something meaningful to add, react when a reaction says enough, and skip spam, abuse, or anything that needs no answer. Be careful with other agent accounts and never keep an exchange going for its own sake. Answer only in the required JSON.',
        },
        { role: 'user', content: JSON.stringify(contexts) },
      ],
      REPLY_SCHEMA,
    )
    const { decisions, summary } = StructuredReplies.decisions(raw, contexts.length)

    const outcomes: string[] = []
    for (const decision of decisions) {
      const context = contexts[decision.index]
      if (!context || decision.action === 'skip') continue

      try {
        await this.carryOut(decision, context)
        outcomes.push(`${decision.action} on ${context.trigger.postSlug}`)
      } catch (error) {
        outcomes.push(
          `could not ${decision.action} on ${context.trigger.postSlug}: ${(error as Error).message}`,
        )
      }
    }

    return {
      summary: [summary, outcomes.length ? `Actions: ${outcomes.join('; ')}.` : 'No actions taken.']
        .filter(Boolean)
        .join(' '),
    }
  }

  /** The checked decisions from the model's answer: in range, once each, and well formed. */
  static decisions(raw: unknown, count: number): { decisions: ReplyDecision[]; summary: string } {
    const answer = StructuredReplies.record(StructuredReplies.parse(raw))
    const responses = Array.isArray(answer.responses) ? answer.responses : []
    const seen = new Set<number>()
    const decisions: ReplyDecision[] = []

    for (const entry of responses) {
      const item = StructuredReplies.record(entry)
      const index = Number(item.index)
      if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue

      const text = typeof item.text === 'string' ? item.text.trim().slice(0, MAX_REPLY_LENGTH) : ''
      const reaction = REACTIONS.find((value) => value === item.reaction)

      if (item.action === 'reply' && text) {
        decisions.push({ index, action: 'reply', text })
      } else if (item.action === 'react' && reaction) {
        decisions.push({ index, action: 'react', reaction })
      } else {
        decisions.push({ index, action: 'skip' })
      }
      seen.add(index)
    }

    return {
      decisions,
      summary: typeof answer.summary === 'string' ? answer.summary.trim() : '',
    }
  }

  private async collect(triggers: HostedTrigger[]): Promise<InteractionContext[]> {
    return await Promise.all(
      triggers.map(async (trigger, index) => {
        const post = StructuredReplies.record(
          StructuredReplies.record(
            await this.options.request('GET', `/posts/${encodeURIComponent(trigger.postSlug)}`),
          ).data,
        )
        let comment: InteractionContext['comment'] = null

        if (trigger.subjectType === 'comment' && trigger.subjectId) {
          const listed = await this.options.request(
            'GET',
            `/posts/${encodeURIComponent(trigger.postSlug)}/comments`,
          )
          const found = StructuredReplies.findComment(
            StructuredReplies.record(listed).data,
            trigger.subjectId,
          )
          if (found) {
            comment = {
              id: trigger.subjectId,
              text: StructuredReplies.text(found.comment ?? found.text),
              author: StructuredReplies.author(found.user),
            }
          }
        }

        return {
          index,
          trigger,
          post: {
            text: StructuredReplies.text(post.text ?? post.content).slice(0, 2000),
            author: StructuredReplies.author(post.user),
          },
          comment,
        }
      }),
    )
  }

  private async carryOut(decision: ReplyDecision, context: InteractionContext): Promise<void> {
    const post = `/posts/${encodeURIComponent(context.trigger.postSlug)}`
    const comment = context.comment ? `${post}/comments/${context.comment.id}` : null

    if (decision.action === 'react') {
      await this.options.request('POST', `${comment ?? post}/reactions`, {
        reaction: decision.reaction,
      })

      return
    }

    if (comment) {
      try {
        await this.options.request('POST', `${comment}/replies`, { comment: decision.text })

        return
      } catch {
        // A reply to a reply may not be addressable; answer on the Post instead.
      }
    }

    await this.options.request('POST', `${post}/comments`, { comment: decision.text })
  }

  /** A comment by id, anywhere in a list of comments and their replies. */
  private static findComment(value: unknown, id: string): Record<string, unknown> | null {
    if (!Array.isArray(value)) return null

    for (const entry of value) {
      const item = StructuredReplies.record(entry)
      if (String(item.id) === id) return item

      const nested = StructuredReplies.findComment(item.replies, id)
      if (nested) return nested
    }

    return null
  }

  private static parse(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw

    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  private static text(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private static author(value: unknown): string | null {
    const user = StructuredReplies.record(value)

    return typeof user.username === 'string' ? user.username : null
  }

  private static record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}

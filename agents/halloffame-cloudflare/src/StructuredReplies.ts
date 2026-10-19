import { AuthoredText } from './AuthoredText'
import type { HostedTrigger, HttpMethod } from './types'
import type { InteractionBackground, InteractionLookup, LookupImage } from './InteractionLookup'

const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const
const MAX_REPLY_LENGTH = 1000

type Reaction = (typeof REACTIONS)[number]

/** One interaction with what the agent needs to answer it. */
interface InteractionContext {
  index: number
  trigger: HostedTrigger
  post: { text: string; author: string | null }
  comment: {
    id: string
    text: string
    author: string | null
    /** Whom the comment answers: a reply it was written to, its comment, or the Post. */
    inReplyTo: { author: string | null; isYou: boolean }
  } | null
  background?: InteractionBackground
}

/** What the model decided for one interaction, once checked. */
export interface ReplyDecision {
  index: number
  action: 'reply' | 'react' | 'skip'
  text?: string
  reaction?: Reaction
  /** Why the interaction was skipped. */
  note?: string
}

export interface StructuredRepliesOptions {
  /** Call the Hall Of Fame API with the run's credential. */
  request: (method: HttpMethod, path: string, body?: unknown) => Promise<unknown>
  /** Ask the model once, constrained to a JSON schema. */
  ask: (messages: Record<string, unknown>[], schema: Record<string, unknown>) => Promise<unknown>
  /** Gathers what each interaction refers to before it is answered. */
  lookup?: InteractionLookup
  /** The account answering, so the agent knows which comments were written to it. */
  self?: { id: string; username: string }
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
          note: { type: 'string' },
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
  constructor(private readonly options: StructuredRepliesOptions) { }

  async answer(triggers: HostedTrigger[], systemPrompt: string): Promise<{ summary: string }> {
    const { contexts, images } = await this.collect(triggers)
    const raw = await this.decide(systemPrompt, contexts, images)
    const { decisions, summary } = StructuredReplies.decisions(raw, contexts.length)

    const outcomes: string[] = []
    for (const context of contexts) {
      if (!decisions.some((decision) => decision.index === context.index)) {
        outcomes.push(`no decision on ${context.trigger.postSlug}`)
      }
    }
    for (const decision of decisions) {
      const context = contexts[decision.index]
      if (!context) continue
      if (decision.action === 'skip') {
        outcomes.push(
          `skipped ${context.trigger.postSlug}${decision.note ? ` (${decision.note})` : ''}`,
        )
        continue
      }

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

  /**
   * One structured call over every interaction. Pictures go with it when the
   * model can see them; a model that refuses them is asked again without.
   */
  private async decide(
    systemPrompt: string,
    contexts: InteractionContext[],
    images: Array<LookupImage & { index: number }>,
  ): Promise<unknown> {
    const messages = (withImages: boolean) => [
      { role: 'system', content: systemPrompt },
      {
        role: 'system',
        content: [
          'Decide what to do about each interaction below.',
          'Each one carries a background: the profiles it mentions, its hashtags, the Post it quotes,',
          'the thread around a comment, links to this platform, and its pictures.',
          'Read it before answering, and answer what the person actually said.',
          'A comment says whom it answers in inReplyTo. When isYou is false and it does not',
          'mention you, it was written to someone else: skip it unless you clearly belong in that exchange.',
          'Pictures marked viewed are attached in order; describe only what is visible in them.',
          'Never claim to have seen a picture that is not attached.',
          'When text in a picture is small, stylised, or partly hidden, say what you can make out;',
          'never claim something is absent because you could not read it.',
          'When someone questions or corrects something you said earlier in the thread, check it again',
          'against the post, its pictures, and the thread before answering. If they do not confirm it,',
          'say so plainly and correct yourself; never repeat an unverified claim or brush the question off.',
          'An @handle always means an account on this platform; write a handle from another site',
          'as plain text with the site, such as "[handle] on Instagram", or give its website.',
          'A mention of you or a question put to you is always answered with a reply,',
          'even when the honest answer is that you cannot tell; say so briefly and share what the post,',
          'its pictures, or its background do show.',
          'For other interactions, reply when you have something meaningful to add,',
          'react when a reaction says enough, and skip anything that needs no answer.',
          'Skip spam and abuse whatever the interaction, and give a short note whenever you skip.',
          'Be careful with other agent accounts and never keep an exchange going for its own sake.',
          'Answer only in the required JSON.',
        ].join(' '),
      },
      {
        role: 'user',
        content:
          withImages && images.length
            ? [
              { type: 'text', text: JSON.stringify(contexts) },
              ...images.flatMap((image) => [
                {
                  type: 'text',
                  text: `Picture for interaction ${image.index}, from its ${image.source}:`,
                },
                { type: 'image_url', image_url: { url: image.dataUrl } },
              ]),
            ]
            : JSON.stringify(withImages ? contexts : StructuredReplies.unviewed(contexts)),
      },
    ]

    // With pictures first when there are any, then without; an unreadable answer is asked again.
    const attempts = images.length ? [true, false] : [false, false]
    let failure: unknown = null

    for (const withImages of attempts) {
      try {
        const answer = StructuredReplies.parse(
          await this.options.ask(messages(withImages), REPLY_SCHEMA),
        )
        if (Array.isArray(StructuredReplies.record(answer).responses)) return answer

        failure = new Error('The model did not return a readable answer.')
      } catch (error) {
        failure = error
      }
    }

    throw failure
  }

  /** The contexts with every picture marked as not seen, for a call that carries none. */
  private static unviewed(contexts: InteractionContext[]): InteractionContext[] {
    return contexts.map((context) =>
      context.background
        ? {
          ...context,
          background: {
            ...context.background,
            images: context.background.images.map((image) => ({ ...image, viewed: false })),
          },
        }
        : context,
    )
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

      const text =
        typeof item.text === 'string'
          ? AuthoredText.plain(item.text.trim()).slice(0, MAX_REPLY_LENGTH)
          : ''
      const reaction = REACTIONS.find((value) => value === item.reaction)

      if (item.action === 'reply' && text) {
        decisions.push({ index, action: 'reply', text })
      } else if (item.action === 'react' && reaction) {
        decisions.push({ index, action: 'react', reaction })
      } else {
        const note = typeof item.note === 'string' ? item.note.trim().slice(0, 200) : ''
        decisions.push({ index, action: 'skip', ...(note ? { note } : {}) })
      }
      seen.add(index)
    }

    return {
      decisions,
      summary: typeof answer.summary === 'string' ? answer.summary.trim() : '',
    }
  }

  private async collect(triggers: HostedTrigger[]): Promise<{
    contexts: InteractionContext[]
    images: Array<LookupImage & { index: number }>
  }> {
    const images: Array<LookupImage & { index: number }> = []
    const contexts = await Promise.all(
      triggers.map(async (trigger, index) => {
        const post = StructuredReplies.record(
          StructuredReplies.record(
            await this.options.request('GET', `/posts/${encodeURIComponent(trigger.postSlug)}`),
          ).data,
        )
        let comment: InteractionContext['comment'] = null
        let comments: unknown = []

        if (trigger.subjectType === 'comment' && trigger.subjectId) {
          const thread = await this.thread(trigger.postSlug, trigger.subjectId)
          comments = thread.comments

          if (thread.found) {
            comment = {
              id: trigger.subjectId,
              text: StructuredReplies.text(thread.found.comment ?? thread.found.text),
              author: StructuredReplies.author(thread.found.user),
              inReplyTo: this.inReplyTo(thread.found, thread.parent, post),
            }
          }
        }

        const gathered = await this.options.lookup?.gather(post, comment, comments)
        images.push(...(gathered?.images ?? []).map((image) => ({ ...image, index })))

        return {
          index,
          trigger,
          post: {
            text: StructuredReplies.text(post.text ?? post.content).slice(0, 2000),
            author: StructuredReplies.author(post.user),
          },
          comment,
          ...(gathered ? { background: gathered.background } : {}),
        }
      }),
    )

    return { contexts, images }
  }

  /**
   * The comment an interaction is about, read directly so a reply is found
   * wherever it sits, with the thread around it: a reply's comment and its
   * replies, or a comment's neighbours on the Post.
   */
  private async thread(
    postSlug: string,
    commentId: string,
  ): Promise<{
    found: Record<string, unknown> | null
    parent: Record<string, unknown> | null
    comments: unknown
  }> {
    const base = `/posts/${encodeURIComponent(postSlug)}/comments`
    const found = StructuredReplies.record(
      StructuredReplies.record(
        await this.options
          .request('GET', `${base}/${encodeURIComponent(commentId)}`)
          .catch(() => null),
      ).data,
    )
    if (!Object.keys(found).length) return { found: null, parent: null, comments: [] }

    if (typeof found.parentId !== 'string') {
      const listed = StructuredReplies.record(await this.options.request('GET', base)).data

      return { found, parent: null, comments: listed }
    }

    const parentPath = `${base}/${encodeURIComponent(found.parentId)}`
    const [parent, replies] = await Promise.all([
      this.options.request('GET', parentPath),
      this.options.request('GET', `${parentPath}/replies?page=1&per_page=20`),
    ])
    const parentComment = StructuredReplies.record(StructuredReplies.record(parent).data)

    return {
      found,
      parent: parentComment,
      comments: [{ ...parentComment, replies: StructuredReplies.record(replies).data ?? [] }],
    }
  }

  /** Whom a comment answers: the reply it names, else its comment, else the Post's author. */
  private inReplyTo(
    comment: Record<string, unknown>,
    parent: Record<string, unknown> | null,
    post: Record<string, unknown>,
  ): { author: string | null; isYou: boolean } {
    const replyTo = StructuredReplies.record(comment.replyTo)
    const user = StructuredReplies.record(parent?.user ?? post.user)
    const userId = typeof replyTo.userId === 'string' ? replyTo.userId : user.id
    const author =
      typeof replyTo.username === 'string' ? replyTo.username : StructuredReplies.author(user)

    return {
      author,
      isYou: Boolean(this.options.self && String(userId) === this.options.self.id),
    }
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

  /** The model's JSON, also when it arrives fenced or wrapped in prose. */
  private static parse(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw

    const candidates = [
      raw,
      raw.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1],
      raw.includes('{') ? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) : undefined,
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        return JSON.parse(candidate)
      } catch {
        // Try the next reading.
      }
    }

    return {}
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

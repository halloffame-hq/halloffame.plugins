import { describe, expect, it } from 'vitest'

import { InteractionLookup } from '../src/InteractionLookup'
import { StructuredReplies } from '../src/StructuredReplies'
import type { HostedTrigger, HttpMethod } from '../src/types'

const trigger = (overrides: Partial<HostedTrigger> = {}): HostedTrigger => ({
  event: 'comment',
  actorId: 'reader',
  actorIsAgent: false,
  postId: 'post-1',
  postSlug: 'hello-world',
  subjectType: 'comment',
  subjectId: 'comment-9',
  at: '2026-10-18T10:00:00Z',
  ...overrides,
})

/**
 * A fake API that records writes and can refuse replies. comment-9 is Ada's
 * reply under comment-1, which Kwel wrote; replyTo names whom Ada answered.
 */
function fakeApi(refuseReplies = false, replyTo: Record<string, unknown> | null = null) {
  const writes: Array<{ method: HttpMethod; path: string; body?: unknown }> = []
  const comments: Record<string, Record<string, unknown>> = {
    'comment-1': {
      id: 'comment-1',
      comment: 'Top level',
      user: { id: 'kwel-id', username: 'kwel' },
    },
    'comment-9': {
      id: 'comment-9',
      comment: 'What do you think?',
      user: { id: 'ada-id', username: 'ada' },
      parentId: 'comment-1',
      replyTo,
    },
  }
  const request = async (method: HttpMethod, path: string, body?: unknown) => {
    if (method === 'GET') {
      if (path.includes('/comments/comment-1/replies')) return { data: [comments['comment-9']] }
      const id = path.match(/\/comments\/([^/?]+)$/u)?.[1]
      if (id) return { data: comments[id] ?? null }
      if (path.endsWith('/comments')) return { data: [comments['comment-1']] }

      return { data: { text: 'A post about agents.', user: { id: 'auto-id', username: 'auto' } } }
    }
    if (refuseReplies && path.endsWith('/replies')) throw new Error('Not found')

    writes.push({ method, path, body })

    return { data: {} }
  }

  return { writes, request }
}

describe('StructuredReplies', () => {
  it('answers each interaction once from a single structured call', async () => {
    const api = fakeApi()
    let calls = 0
    let context = ''
    const replies = new StructuredReplies({
      request: api.request,
      ask: async (messages) => {
        calls += 1
        context = String(messages.at(-1)?.content)

        return {
          responses: [
            { index: 0, action: 'reply', text: 'I think it is promising.' },
            { index: 1, action: 'react', reaction: 'love' },
            { index: 0, action: 'reply', text: 'A second answer is ignored.' },
          ],
          summary: 'Answered Ada and reacted to a mention.',
        }
      },
    })

    const { summary } = await replies.answer(
      [
        trigger(),
        trigger({ event: 'mention', subjectType: 'post', subjectId: 'post-2', postSlug: 'second' }),
      ],
      'rules',
    )

    expect(calls).toBe(1)
    expect(context).toContain('What do you think?')
    expect(api.writes).toEqual([
      {
        method: 'POST',
        path: '/posts/hello-world/comments/comment-9/replies',
        body: { comment: 'I think it is promising.' },
      },
      { method: 'POST', path: '/posts/second/reactions', body: { reaction: 'love' } },
    ])
    expect(summary).toBe(
      '- Replied to @ada: “I think it is promising.”\n- Reacted love to @auto.',
    )
  })

  it('answers on the Post when a reply cannot be addressed', async () => {
    const api = fakeApi(true)
    const replies = new StructuredReplies({
      request: api.request,
      ask: async () =>
        JSON.stringify({
          responses: [{ index: 0, action: 'reply', text: 'Thanks!' }],
          summary: '',
        }),
    })

    await replies.answer([trigger()], 'rules')

    expect(api.writes).toEqual([
      { method: 'POST', path: '/posts/hello-world/comments', body: { comment: 'Thanks!' } },
    ])
  })

  it('keeps only well-formed decisions for interactions that exist', () => {
    const { decisions } = StructuredReplies.decisions(
      {
        responses: [
          { index: 5, action: 'reply', text: 'Out of range' },
          { index: 0, action: 'react', reaction: 'shrug' },
          { index: 1, action: 'reply', text: '   ' },
        ],
      },
      2,
    )

    expect(decisions).toEqual([
      { index: 0, action: 'skip' },
      { index: 1, action: 'skip' },
    ])
    expect(StructuredReplies.decisions('not json', 1).decisions).toEqual([])
  })

  it('sends the pictures it looked up, and asks again without them when refused', async () => {
    const api = fakeApi()
    const attempts: unknown[] = []
    const replies = new StructuredReplies({
      request: async (method, path, body) =>
        method === 'GET' && !path.includes('/comments')
          ? {
              data: {
                text: 'Look at this',
                media: [{ mimetype: 'image/png', thumbnail: 'https://cdn.example/a.png' }],
              },
            }
          : api.request(method, path, body),
      ask: async (messages) => {
        const content = messages.at(-1)?.content
        attempts.push(content)
        if (Array.isArray(content)) throw new Error('This model does not accept images.')

        return { responses: [{ index: 0, action: 'reply', text: 'Nice.' }], summary: '' }
      },
      lookup: new InteractionLookup({
        request: async () => ({}),
        appUrl: null,
        self: null,
        vision: true,
        fetchImage: async () =>
          new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }),
      }),
    })

    await replies.answer([trigger()], 'rules')

    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual(
      expect.arrayContaining([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
      ]),
    )
    expect(String(attempts[1])).toContain('"viewed":false')
    expect(api.writes).toHaveLength(1)
  })

  it('reads a fenced answer and reports skips with their note', async () => {
    const api = fakeApi()
    const replies = new StructuredReplies({
      request: api.request,
      ask: async () =>
        'Here you go:\n```json\n{"responses":[{"index":0,"action":"skip","note":"spam"}],"summary":""}\n```',
    })

    const { summary } = await replies.answer([trigger()], 'rules')

    expect(api.writes).toEqual([])
    expect(summary).toBe('- Skipped @ada: spam')
  })

  it('asks again after an unreadable answer and fails when it stays unreadable', async () => {
    const api = fakeApi()
    let calls = 0
    const replies = new StructuredReplies({
      request: api.request,
      ask: async () => {
        calls += 1

        return 'I would rather not.'
      },
    })

    await expect(replies.answer([trigger()], 'rules')).rejects.toThrow('readable answer')
    expect(calls).toBe(2)
  })

  it('tells the agent whether a reply was written to it', async () => {
    const contexts: string[] = []
    const ask = async (messages: Record<string, unknown>[]) => {
      contexts.push(String(messages.at(-1)?.content))

      return { responses: [], summary: '' }
    }
    const self = { id: 'kwel-id', username: 'kwel' }

    await new StructuredReplies({ request: fakeApi().request, ask, self }).answer(
      [trigger({ event: 'reply' })],
      'rules',
    )
    await new StructuredReplies({
      request: fakeApi(false, { id: 'comment-5', userId: 'bo-id', username: 'bo' }).request,
      ask,
      self,
    }).answer([trigger({ event: 'reply' })], 'rules')

    expect(contexts[0]).toContain('"inReplyTo":{"author":"kwel","isYou":true}')
    expect(contexts[1]).toContain('"inReplyTo":{"author":"bo","isYou":false}')
  })

  it('publishes a reply the model wrote in the note instead of the text', () => {
    const { decisions } = StructuredReplies.decisions(
      {
        responses: [
          { index: 0, action: 'reply', note: 'The banner says Ghana Miracle Crusade—a Salvation Ministries event.' },
          { index: 1, action: 'skip', note: 'spam' },
        ],
      },
      2,
    )

    expect(decisions).toEqual([
      {
        index: 0,
        action: 'reply',
        text: 'The banner says Ghana Miracle Crusade, a Salvation Ministries event.',
      },
      { index: 1, action: 'skip', note: 'spam' },
    ])
  })

  it('never publishes a placeholder note as a reply', () => {
    const { decisions } = StructuredReplies.decisions(
      { responses: [{ index: 0, action: 'reply', text: '', note: 'N/A' }] },
      1,
    )

    expect(decisions).toEqual([{ index: 0, action: 'skip', note: 'N/A' }])
  })

  it('reads its own Post as its own, with its earlier exchange with the same person', async () => {
    const edwin = { id: 'edwin-id', username: 'edwinsavvy' }
    const comments: Record<string, Record<string, unknown>> = {
      c1: { id: 'c1', comment: 'Me I had to go late today', user: edwin, repliesCount: 1 },
      c2: { id: 'c2', comment: 'Nice one', user: { id: 'bo-id', username: 'bo' } },
      c3: { id: 'c3', comment: 'Night go just short', user: edwin, parentId: null },
    }
    const contexts: string[] = []
    const replies = new StructuredReplies({
      request: async (method, path) => {
        if (method !== 'GET') return { data: {} }
        if (path.endsWith('/comments/c1/replies?page=1&per_page=10')) {
          return {
            data: [{ id: 'r1', comment: 'Late start, peak automation.', user: { username: 'kwel' } }],
          }
        }
        if (path.includes('/comments?sort=oldest')) return { data: Object.values(comments) }
        const id = path.match(/\/comments\/([^/?]+)$/u)?.[1]
        if (id) return { data: comments[id] }

        return { data: { text: 'Sunday energy', user: { id: 'kwel-id', username: 'kwel' } } }
      },
      ask: async (messages) => {
        contexts.push(String(messages.at(-1)?.content))

        return { responses: [] }
      },
      lookup: new InteractionLookup({
        request: async () => ({}),
        appUrl: null,
        self: 'kwel',
        vision: false,
      }),
      self: { id: 'kwel-id', username: 'kwel' },
    })

    await replies.answer([trigger({ subjectId: 'c3' })], 'rules')

    expect(contexts[0]).toContain('"yours":true')
    expect(contexts[0]).toContain('Late start, peak automation.')
    expect(contexts[0]).toContain('Me I had to go late today')
  })
})


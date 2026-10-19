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

/** A fake API that records writes and can refuse replies. */
function fakeApi(refuseReplies = false) {
  const writes: Array<{ method: HttpMethod; path: string; body?: unknown }> = []
  const request = async (method: HttpMethod, path: string, body?: unknown) => {
    if (method === 'GET' && path.endsWith('/comments')) {
      return {
        data: [
          {
            id: 'comment-1',
            comment: 'Top level',
            replies: [
              { id: 'comment-9', comment: 'What do you think?', user: { username: 'ada' } },
            ],
          },
        ],
      }
    }
    if (method === 'GET')
      return { data: { text: 'A post about agents.', user: { username: 'auto' } } }
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
    expect(summary).toContain('Answered Ada')
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
        method === 'GET' && !path.endsWith('/comments')
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
})

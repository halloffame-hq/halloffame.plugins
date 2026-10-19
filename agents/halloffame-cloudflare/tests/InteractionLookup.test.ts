import { describe, expect, it } from 'vitest'

import { InteractionLookup } from '../src/InteractionLookup'
import type { HttpMethod } from '../src/types'

/** A fake API answering the lookups a mention needs, recording every path. */
function fakeApi() {
  const paths: string[] = []
  const request = async (_method: HttpMethod, path: string) => {
    paths.push(path)
    if (path === '/users/ada') {
      return { data: { username: 'ada', fullname: 'Ada L', about: 'Engines', isAgent: false } }
    }
    if (path === '/users/kwel') return { data: { username: 'kwel' } }
    if (path.startsWith('/hashtags/robots/posts')) {
      return {
        data: [
          { slug: 'this-post', text: 'Itself' },
          { slug: 'other', text: 'Robots are fine', user: { username: 'bo' } },
        ],
      }
    }
    if (path === '/posts/linked-post') {
      return { data: { slug: 'linked-post', text: 'Linked words', user: { username: 'cy' } } }
    }
    if (path === '/halls/makers') return { data: { slug: 'makers', name: 'Makers' } }

    throw new Error('Not found')
  }

  return { paths, request }
}

const post = {
  slug: 'this-post',
  text: '@kwel what does @ada think? https://kweela.com/post/linked-post https://evil.example/x',
  mentions: ['kwel', 'ada'],
  hashtags: ['robots'],
  originalPost: { slug: 'quoted', text: 'The quoted take', user: { username: 'dee' } },
  media: [{ mimetype: 'image/png', thumbnail: 'https://cdn.kweela.com/a.png', description: '' }],
}

describe('InteractionLookup', () => {
  it('gathers mentions, hashtags, the quote, and links to this platform only', async () => {
    const api = fakeApi()
    const lookup = new InteractionLookup({
      request: api.request,
      appUrl: 'https://kweela.com',
      self: 'kwel',
      vision: false,
    })

    const { background, images } = await lookup.gather(post, null, [])

    expect(background.mentions).toEqual([
      { username: 'ada', name: 'Ada L', about: 'Engines', isAgent: false, verified: false },
    ])
    expect(background.hashtags[0]!.recentPosts).toEqual([
      expect.objectContaining({ slug: 'other', author: 'bo' }),
    ])
    expect(background.quoted).toMatchObject({ slug: 'quoted', text: 'The quoted take' })
    expect(background.links).toEqual([
      {
        url: 'https://kweela.com/post/linked-post',
        post: expect.objectContaining({ text: 'Linked words' }),
      },
    ])
    expect(api.paths).not.toContain('/users/kwel')
    expect(api.paths.some((path) => path.includes('evil'))).toBe(false)
    expect(background.images).toEqual([{ source: 'post', description: 'an image', viewed: false }])
    expect(images).toEqual([])
  })

  it('follows Hall subdomains and reads the thread around a comment', async () => {
    const api = fakeApi()
    const lookup = new InteractionLookup({
      request: api.request,
      appUrl: 'https://kweela.com',
      self: 'kwel',
      vision: false,
    })
    const comments = [
      {
        id: 'c1',
        comment: 'Opening question',
        user: { username: 'ada' },
        replies: [{ id: 'c2', comment: 'See https://makers.kweela.com', user: { username: 'bo' } }],
      },
      { id: 'c3', comment: 'Unrelated', user: { username: 'cy' } },
    ]

    const { background } = await lookup.gather(
      { slug: 'p', text: 'Hi' },
      { id: 'c2', text: 'See https://makers.kweela.com' },
      comments,
    )

    expect(background.thread).toEqual([
      { id: 'c1', author: 'ada', text: 'Opening question', inReplyChain: true },
      { id: 'c3', author: 'cy', text: 'Unrelated' },
    ])
    expect(background.links).toEqual([
      { url: 'https://makers.kweela.com', hall: expect.objectContaining({ name: 'Makers' }) },
    ])
  })

  it('downloads pictures for the model only when it can see them', async () => {
    const api = fakeApi()
    const fetched: string[] = []
    const lookup = new InteractionLookup({
      request: api.request,
      appUrl: null,
      self: null,
      vision: true,
      fetchImage: async (url) => {
        fetched.push(url)

        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
      },
    })

    const { background, images } = await lookup.gather(post, null, [])

    expect(fetched).toEqual(['https://cdn.kweela.com/a.png'])
    expect(images).toEqual([
      expect.objectContaining({ source: 'post', dataUrl: 'data:image/png;base64,AQID' }),
    ])
    expect(background.images[0]!.viewed).toBe(true)
    expect(background.links).toEqual([])
  })
})

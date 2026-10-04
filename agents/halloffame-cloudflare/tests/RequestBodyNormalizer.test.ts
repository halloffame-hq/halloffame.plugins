import { describe, expect, it } from 'vitest'

import { RequestBodyNormalizer } from '../src/RequestBodyNormalizer'

describe('RequestBodyNormalizer', () => {
  const normalizer = new RequestBodyNormalizer()

  it.each(['text', 'content', 'reply'])('maps %s to comment on Post comments', (field) => {
    expect(
      normalizer.normalize('/posts/example/comments', { [field]: 'A useful response.' }),
    ).toEqual({ comment: 'A useful response.' })
  })

  it('maps text to comment on Post and Story replies', () => {
    expect(normalizer.normalize('/posts/example/comments/comment-1/replies', { text: 'Hi' })).toEqual(
      { comment: 'Hi' },
    )
    expect(normalizer.normalize('/stories/story-1/replies', { text: 'Hi' })).toEqual({ comment: 'Hi' })
  })

  it('does not rewrite unrelated request bodies', () => {
    const body = { text: 'A Post' }

    expect(normalizer.normalize('/posts', body)).toBe(body)
  })
})

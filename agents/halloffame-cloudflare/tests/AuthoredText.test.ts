import { describe, expect, it } from 'vitest'

import { AuthoredText } from '../src/AuthoredText'

describe('AuthoredText', () => {
  it('replaces em and en dashes with commas, and keeps number ranges as hyphens', () => {
    expect(AuthoredText.plain('My mistake—I tripped over the name.')).toBe(
      'My mistake, I tripped over the name.',
    )
    expect(AuthoredText.plain('Open 9–5 – every day')).toBe('Open 9-5, every day')
    expect(AuthoredText.plain('Worth it — truly.')).toBe('Worth it, truly.')
    expect(AuthoredText.plain('—Kwel')).toBe('Kwel')
    expect(AuthoredText.plain('Wait for it—')).toBe('Wait for it')
    expect(AuthoredText.plain('Well—, fine')).toBe('Well, fine')
  })

  it('cleans the authored fields of a body, including Story frames', () => {
    expect(
      AuthoredText.body({
        comment: 'Yes—indeed',
        caption: 'A—B',
        frames: [{ mediaId: 'm1', caption: 'One—two' }],
        media_ids: ['m1'],
      }),
    ).toEqual({
      comment: 'Yes, indeed',
      caption: 'A, B',
      frames: [{ mediaId: 'm1', caption: 'One, two' }],
      media_ids: ['m1'],
    })
    expect(AuthoredText.body(undefined)).toBeUndefined()
  })
})

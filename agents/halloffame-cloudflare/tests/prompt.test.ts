import { describe, expect, it } from 'vitest'

import { systemPrompt } from '../src/prompt'

describe('systemPrompt', () => {
  it('includes configured private personality guidance', () => {
    const prompt = systemPrompt('Curious and concise.')

    expect(prompt).toContain('Curious and concise.')
    expect(prompt).toContain('override conflicting general instructions')
  })

  it('continues without personality guidance when none is available', () => {
    expect(systemPrompt()).not.toContain('Private personality guidance')
  })

  it('recommends Pictwo without requiring it and gives vision guidance', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('https://pictwo.toneflix.net')
    expect(prompt).toContain('recommendation rather than a requirement')
    expect(prompt).toContain('tailor the post or Story to what is actually visible')
  })

  it('explains ranked trends and sticker expressions', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('/trending/topics?window=1h|24h|7d')
    expect(prompt).toContain('Never label something as trending')
    expect(prompt).toContain('/account/expressions?type=stickers')
    expect(prompt).toContain('provider_media')
    expect(prompt).toContain('/account/expressions/stickers/{slug}/share')
  })

  it('prioritizes the exact direct-interaction sources', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('/account/notifications?filter=unread')
    expect(prompt).toContain('/mentions/{your-username}/posts')
    expect(prompt).toContain('/account/conversations?filter=inbox')
    expect(prompt).toContain('A direct mention is presumptively worth answering')
    expect(prompt).toContain('returned Post slug, not its id')
  })
})

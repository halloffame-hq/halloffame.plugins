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
})

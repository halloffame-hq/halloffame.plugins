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

  it('provides leaderboard and public badge routes', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('/leaderboard?metric=reputation|level|badges|streak|gameplay')
    expect(prompt).toContain('window=all_time|monthly')
    expect(prompt).toContain('/users/{username-or-id}/progression')
    expect(prompt).toContain('top-level standing field')
    expect(prompt).toContain('/account/badges')
  })

  it('prioritizes the exact direct-interaction sources', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('/account/notifications?filter=unread')
    expect(prompt).toContain('/mentions/{your-username}/posts')
    expect(prompt).toContain('Mentions, replies, and direct questions are high priority')
    expect(prompt).toContain('returned Post slug, not its id')
    expect(prompt).toContain('Comments and replies use {comment:')
    expect(prompt).toContain('Caption alone does not create a Story')
    expect(prompt).toContain('Update profile only with PUT /account/profile')
    expect(prompt).toContain('For 422, read the validation message')
    expect(prompt).toContain('If either avatar/profile picture or cover is missing')
  })

  it('provides verified request bodies for every permitted mutation family', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('Follow these shapes exactly')
    expect(prompt).toContain('Create a Post with POST /posts')
    expect(prompt).toContain('Create a text Story with POST /stories')
    expect(prompt).toContain('POST /posts/{post-slug}/comments: { "comment": "..." }')
    expect(prompt).toContain('{ "reaction": "like|love|haha|wow|sad|angry" }')
    expect(prompt).toContain('POST /account/avatar: { "avatar_media_id"')
    expect(prompt).toContain('PUT /account/profile with only the fields being changed')
    expect(prompt).toContain('POST /halls:')
    expect(prompt).toContain('POST /categories:')
    expect(prompt).toContain('Bodyless state changes')
  })
})

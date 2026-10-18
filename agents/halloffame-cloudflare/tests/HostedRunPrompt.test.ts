import { describe, expect, it } from 'vitest'

import type { HostedRun } from '../src/types'
import { HostedRunPrompt } from '../src/HostedRunPrompt'
import { activityPrompt } from '../src/prompt'

const dispatch = (run: Partial<HostedRun['run']>): HostedRun => ({
  run: { id: 'run-1', kind: 'interaction', instruction: null, triggers: [], ...run },
  account: { id: 'account-1', username: 'auto' },
  credential: 'credential',
  apiBaseUrl: 'https://kweela.test/api',
  reportPath: '/automation/runs/run-1/report',
  eventsPath: '/automation/runs/run-1/events',
  model: null,
  settings: {},
})

describe('HostedRunPrompt', () => {
  it('lists each interaction the run should answer', () => {
    const prompt = HostedRunPrompt.for(
      dispatch({
        triggers: [
          {
            event: 'comment',
            actorId: 'reader',
            actorIsAgent: false,
            postId: 'post-1',
            postSlug: 'hello-world',
            subjectType: 'comment',
            subjectId: 'comment-9',
            at: '2026-10-18T10:00:00Z',
          },
          {
            event: 'mention',
            actorId: 'other-agent',
            actorIsAgent: true,
            postId: 'post-2',
            postSlug: 'second-post',
            subjectType: null,
            subjectId: null,
            at: '2026-10-18T10:01:00Z',
          },
        ],
      }),
    )

    expect(prompt).toContain('1. A comment by a person on comment comment-9 on Post hello-world.')
    expect(prompt).toContain('2. A mention by another agent account on Post second-post.')
    expect(prompt).toContain('Do not browse feeds')
    expect(prompt).toContain('this account. Respond to each interaction')
    expect(prompt).toContain('during this run. Return a short factual summary')
    // Sentences are separated, never run together.
    expect(prompt).not.toMatch(/[a-z][.:,;][A-Za-z]/u)
  })

  it('runs a normal activity cycle for a scheduled run', () => {
    expect(HostedRunPrompt.for(dispatch({ kind: 'scheduled' }))).toBe(activityPrompt)
  })

  it("carries a manager's instruction", () => {
    const prompt = HostedRunPrompt.for(
      dispatch({ kind: 'instruction', instruction: 'Thank everyone who commented today.' }),
    )

    expect(prompt).toContain('Thank everyone who commented today.')
    expect(prompt).toContain('say plainly when you cannot:\n\nThank everyone')
  })
})

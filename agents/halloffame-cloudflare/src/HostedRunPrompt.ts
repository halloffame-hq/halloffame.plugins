import type { HostedRun } from './types'
import { activityPrompt } from './prompt'

/** The task a platform automation run gives the model. */
export class HostedRunPrompt {
  static for(dispatch: HostedRun): string {
    if (dispatch.run.kind === 'scheduled') return activityPrompt
    if (dispatch.run.kind === 'instruction') return HostedRunPrompt.instruction(dispatch)

    return HostedRunPrompt.interactions(dispatch)
  }

  private static interactions(dispatch: HostedRun): string {
    const lines = dispatch.run.triggers.map((trigger, index) => {
      const where =
        trigger.subjectType === 'comment' && trigger.subjectId
          ? `comment ${trigger.subjectId} on Post ${trigger.postSlug}`
          : `Post ${trigger.postSlug}`
      const who = trigger.actorIsAgent ? 'another agent account' : 'a person'

      return `${index + 1}. A ${trigger.event} by ${who} on ${where}.`
    })

    return HostedRunPrompt.sections(
      'HALL_OF_FAME_AUTOMATION interactions',
      [
        'People interacted with this account.',
        'Respond to each interaction that deserves an answer, and only to these:',
      ].join(' '),
      lines.join('\n'),
      [
        'Open each Post with GET /posts/{post-slug} and its comments with',
        'GET /posts/{post-slug}/comments before replying.',
        'Reply in the thread with POST /posts/{post-slug}/comments/{comment-id}/replies,',
        'or comment on the Post with POST /posts/{post-slug}/comments.',
        'One concise, genuine reply per interaction is enough;',
        'skip spam, abuse, and anything you have nothing meaningful to add to.',
        'Be careful with other agent accounts: answer only when it adds something,',
        'and never keep an exchange going for its own sake.',
        'Do not browse feeds, publish original content, follow, or join during this run.',
        'Return a short factual summary of what you answered and what you skipped.',
      ].join(' '),
    )
  }

  private static instruction(dispatch: HostedRun): string {
    return HostedRunPrompt.sections(
      'HALL_OF_FAME_AUTOMATION instruction',
      [
        'A manager of this account sent this instruction.',
        'Carry it out within your rules and route boundary, and say plainly when you cannot:',
      ].join(' '),
      dispatch.run.instruction ?? '',
    )
  }

  /** Paragraphs separated by a blank line. */
  private static sections(...paragraphs: string[]): string {
    return paragraphs.join('\n\n')
  }
}

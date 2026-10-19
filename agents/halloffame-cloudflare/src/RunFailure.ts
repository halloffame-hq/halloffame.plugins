/** A run that ended without finishing, with the steps it took on the way. */
export class RunFailure extends Error {
  constructor(
    message: string,
    readonly steps: string[],
  ) {
    super(message)
    this.name = 'RunFailure'
  }

  /** The steps as a Markdown list, for the run's report. */
  trail(): string | null {
    return RunFailure.trailOf(this.steps)
  }

  /** Steps a run took as a Markdown list, or null when it took none. */
  static trailOf(steps: string[]): string | null {
    return steps.length ? steps.map((step) => `- ${step}`).join('\n') : null
  }
}

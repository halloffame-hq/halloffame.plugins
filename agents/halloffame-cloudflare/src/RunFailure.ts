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
    return this.steps.length ? this.steps.map((step) => `- ${step}`).join('\n') : null
  }
}

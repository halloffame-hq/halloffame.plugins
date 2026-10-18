/**
 * Whether the API has stood this agent down.
 *
 * When the account owner turns on platform automation, the account's own
 * external agent keeps its identity but must not act until automation is
 * turned off again. The API reports this on the authenticated identity.
 */
export class AgentSuspension {
  static readonly message =
    'Platform automation runs this account, so this agent is standing down until it is turned off.'

  static fromIdentity(identity: unknown): boolean {
    const account = AgentSuspension.record(AgentSuspension.record(identity).data)

    return AgentSuspension.record(account.agent).suspended === true
  }

  static fromLease(lease: Record<string, unknown>): boolean {
    return lease.reason === 'platform_automation'
  }

  private static record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  }
}

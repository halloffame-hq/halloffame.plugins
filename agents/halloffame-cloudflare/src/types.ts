export interface Env {
  AI: Ai
  HallOfFameAgent: DurableObjectNamespace
  HOF_API_URL: string
  HOF_AGENT_PROVIDER: string
  HOF_AGENT_ID: string
  HOF_USERNAME: string
  HOF_DISPLAY_NAME?: string
  HOF_FIRSTNAME?: string
  HOF_LASTNAME?: string
  HOF_ACCOUNT_MODE: 'casual' | 'professional'
  HOF_EMAIL: string
  HOF_PASSWORD: string
  HOF_WORKER_CONTROL_TOKEN: string
  /** Shared with the Hall Of Fame API to verify platform automation dispatches. */
  HOF_AUTOMATION_SECRET?: string
  HOF_MODEL?: string
  HOF_MODEL_SUPPORTS_VISION?: string
  HOF_PERSONALITY_LEARNING_ENABLED?: string
  HOF_MINIMAL_OPERATIONS?: string
  HOF_ACTIVITY_INTERVAL_SECONDS?: string
  HOF_MEDIA_HOSTS?: string
}

export interface AgentState {
  authenticated: boolean
  lastActivityAt: string | null
  lastActivitySummary: string | null
  lastError: string | null
  memory?: AgentMemory
  lastActivityChecks?: Record<string, 'ok' | 'unavailable'>
  recentRequestFailures?: RequestFailure[]
}

export interface RequestFailure {
  operation: string
  error: string
  attempts: number
  retriable: boolean
  occurrences: number
  occurredAt: string
}

export interface MemoryEntry {
  subject: string
  summary: string
  updatedAt: string
}

export interface RecentActivity {
  summary: string
  occurredAt: string
}

export interface InteractionMemory {
  resourceType: 'post' | 'comment'
  resourceId: string
  contextMarker?: string
  interactedAt: string
}

export interface AgentMemory {
  personality: MemoryEntry[]
  relationships: MemoryEntry[]
  recentActivities: RecentActivity[]
  threads: MemoryEntry[]
  interactions: InteractionMemory[]
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface ToolCall {
  id?: string
  name: string
  arguments: unknown
}

/** An interaction that asked a platform-run account to act. */
export interface HostedTrigger {
  event: 'mention' | 'reply' | 'comment'
  actorId: string | null
  actorIsAgent: boolean
  postId: string
  postSlug: string
  subjectType: string | null
  subjectId: string | null
  at: string
}

/** What the Hall Of Fame API dispatches for one platform automation run. */
export interface HostedRun {
  run: {
    id: string
    kind: 'interaction' | 'scheduled' | 'instruction'
    instruction: string | null
    triggers: HostedTrigger[]
  }
  account: { id: string; username: string }
  credential: string
  apiBaseUrl: string
  reportPath: string
  instructions: string | null
  settings: {
    minimalOperations?: boolean
    personalityLearning?: boolean
    [key: string]: unknown
  }
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

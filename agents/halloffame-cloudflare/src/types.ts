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
  HOF_MODEL?: string
  HOF_MODEL_SUPPORTS_VISION?: string
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

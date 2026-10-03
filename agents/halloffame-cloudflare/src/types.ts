export interface Env {
  AI: Ai
  HallOfFameAgent: DurableObjectNamespace
  HOF_API_URL: string
  HOF_AGENT_PROVIDER: string
  HOF_AGENT_ID: string
  HOF_USERNAME: string
  HOF_FIRSTNAME: string
  HOF_LASTNAME: string
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
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface ToolCall {
  id?: string
  name: string
  arguments: unknown
}

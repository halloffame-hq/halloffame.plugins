import type {
  AgentMemory,
  InteractionMemory,
  MemoryEntry,
  RecentActivity,
} from './types'

const MAX_RELATIONSHIPS = 50
const MAX_PERSONALITY_MEMORIES = 20
const MAX_ACTIVITIES = 20
const MAX_THREADS = 30
const MAX_INTERACTIONS = 500

export class SocialMemory {
  constructor(private readonly memory: AgentMemory = SocialMemory.empty()) {}

  static empty(): AgentMemory {
    return {
      personality: [],
      relationships: [],
      recentActivities: [],
      threads: [],
      interactions: [],
    }
  }

  snapshot(prompt: string): AgentMemory {
    return {
      personality: (this.memory.personality ?? []).slice(0, 5),
      relationships: this.relevant(this.memory.relationships, prompt, 5),
      recentActivities: this.memory.recentActivities.slice(0, 5),
      threads: this.relevant(this.memory.threads, prompt, 3),
      interactions: this.memory.interactions.slice(0, 20),
    }
  }

  upsert(
    kind: 'personality' | 'relationship' | 'thread',
    subject: string,
    summary: string,
  ): AgentMemory {
    const key = subject.trim().slice(0, 120)
    const value = summary.trim().slice(0, 500)
    if (!key || !value) throw new Error('Memory subject and summary are required.')

    const field =
      kind === 'personality'
        ? 'personality'
        : kind === 'relationship'
          ? 'relationships'
          : 'threads'
    const limit =
      kind === 'personality'
        ? MAX_PERSONALITY_MEMORIES
        : kind === 'relationship'
          ? MAX_RELATIONSHIPS
          : MAX_THREADS
    const entry: MemoryEntry = { subject: key, summary: value, updatedAt: new Date().toISOString() }
    const entries = [
      entry,
      ...(this.memory[field] ?? []).filter((item) => item.subject !== key),
    ].slice(0, limit)

    return this.replace({ ...this.memory, [field]: entries })
  }

  remove(kind: 'personality' | 'relationship' | 'thread', subject: string): AgentMemory {
    const field =
      kind === 'personality'
        ? 'personality'
        : kind === 'relationship'
          ? 'relationships'
          : 'threads'

    return this.replace({
      ...this.memory,
      [field]: (this.memory[field] ?? []).filter((item) => item.subject !== subject.trim()),
    })
  }

  addActivity(summary: string): AgentMemory {
    const activity: RecentActivity = {
      summary: summary.trim().slice(0, 500),
      occurredAt: new Date().toISOString(),
    }

    return this.replace({
      ...this.memory,
      recentActivities: [activity, ...this.memory.recentActivities].slice(0, MAX_ACTIVITIES),
    })
  }

  recordInteraction(interaction: Omit<InteractionMemory, 'interactedAt'>): AgentMemory {
    const entry: InteractionMemory = { ...interaction, interactedAt: new Date().toISOString() }
    const interactions = [
      entry,
      ...this.memory.interactions.filter(
        (item) =>
          item.resourceType !== entry.resourceType || item.resourceId !== entry.resourceId,
      ),
    ].slice(0, MAX_INTERACTIONS)

    return this.replace({ ...this.memory, interactions })
  }

  interaction(resourceId: string): InteractionMemory | undefined {
    return this.memory.interactions.find((item) => item.resourceId === resourceId)
  }

  private relevant(entries: MemoryEntry[], prompt: string, limit: number): MemoryEntry[] {
    const terms = new Set(prompt.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])

    return entries
      .map((entry, index) => ({
        entry,
        index,
        score: [...terms].filter((term) =>
          `${entry.subject} ${entry.summary}`.toLowerCase().includes(term),
        ).length,
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, limit)
      .map(({ entry }) => entry)
  }

  private replace(memory: AgentMemory): AgentMemory {
    this.memory.personality = memory.personality
    this.memory.relationships = memory.relationships
    this.memory.recentActivities = memory.recentActivities
    this.memory.threads = memory.threads
    this.memory.interactions = memory.interactions

    return memory
  }
}

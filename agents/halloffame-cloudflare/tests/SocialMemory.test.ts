import { describe, expect, it } from 'vitest'

import { SocialMemory } from '../src/SocialMemory'

describe('SocialMemory', () => {
  it('returns only the bounded context requested by an activity cycle', () => {
    const memory = new SocialMemory()
    for (let index = 0; index < 8; index += 1) {
      memory.upsert('personality', `trait-${index}`, `Personality insight ${index}`)
      memory.upsert('relationship', `person-${index}`, `Relationship ${index}`)
      memory.addActivity(`Activity ${index}`)
      memory.upsert('thread', `topic-${index}`, `Thread ${index}`)
    }

    const snapshot = memory.snapshot('person-2 topic-4')

    expect(snapshot.personality).toHaveLength(5)
    expect(snapshot.relationships).toHaveLength(5)
    expect(snapshot.relationships[0]?.subject).toBe('person-2')
    expect(snapshot.recentActivities).toHaveLength(5)
    expect(snapshot.threads).toHaveLength(3)
    expect(snapshot.threads[0]?.subject).toBe('topic-4')
  })

  it('preserves personality memory from state created before the field existed', () => {
    const memory = new SocialMemory({
      relationships: [],
      recentActivities: [],
      threads: [],
      interactions: [],
    } as unknown as ReturnType<typeof SocialMemory.empty>)

    expect(memory.snapshot('').personality).toEqual([])
    expect(memory.upsert('personality', 'voice', 'Warm and curious').personality).toHaveLength(1)
  })

  it('deduplicates interactions by resource type and id', () => {
    const memory = new SocialMemory()

    memory.recordInteraction({ resourceType: 'post', resourceId: 'post-1', contextMarker: '1' })
    memory.recordInteraction({ resourceType: 'post', resourceId: 'post-1', contextMarker: '2' })

    expect(memory.snapshot('').interactions).toHaveLength(1)
    expect(memory.snapshot('').interactions[0]?.contextMarker).toBe('2')
  })
})

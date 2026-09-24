/**
 * What has already been done, so it is not done twice.
 *
 * A caller that times out retries, and a retry that moves value a second time
 * is the failure this whole contract exists to prevent. The store remembers
 * which handle a key produced, so the retry is answered with the first
 * attempt instead of starting a second one.
 *
 * The default keeps that in memory, which is enough for one process and for
 * tests. An adapter that must survive a restart - anything settling real value
 * - is given a store backed by whatever the host already durably writes to.
 */
export abstract class IdempotencyStore {
  /** 
   * The handle this key produced, or null when it is new.
   * 
   * @param key 
   */
  abstract recall(key: string): Promise<string | null>

  /** 
   * Bind a key to the handle it produced.  
   * 
   * @param key 
   * @param reference 
   */
  abstract remember(key: string, reference: string): Promise<void>

  abstract forget(key: string): Promise<void>

  /**
   * Run `operation` once for this key, however often it is asked for.
   *
   * `resolve` turns a remembered handle back into its result. It may return
   * null when the handle no longer resolves, in which case the operation runs
   * again rather than the caller receiving nothing.
   * 
   * @param key 
   * @param resolve 
   * @param operation 
   * @returns 
   */
  async once<T>(
    key: string,
    resolve: (reference: string) => Promise<T | null>,
    operation: () => Promise<{ reference: string; result: T }>,
  ): Promise<T> {
    const remembered = await this.recall(key)

    if (remembered) {
      const existing = await resolve(remembered)
      if (existing) return existing
    }

    const { reference, result } = await operation()
    await this.remember(key, reference)

    return result
  }
}

export class MemoryIdempotencyStore extends IdempotencyStore {
  private readonly entries = new Map<string, string>()

  async recall(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null
  }

  async remember(key: string, reference: string): Promise<void> {
    this.entries.set(key, reference)
  }

  async forget(key: string): Promise<void> {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

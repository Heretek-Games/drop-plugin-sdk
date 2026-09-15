/**
 * Shared in-memory key/value backing for the server and client plugin mocks.
 *
 * Both mocks must behave identically (deep-cloned reads/writes, capability
 * gating handled by their own wrappers), so the storage primitive lives in one
 * place to keep them from drifting.
 */
export class MockKeyValueStore {
  protected readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return this.store.has(key)
      ? (structuredClone(this.store.get(key)) as T)
      : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

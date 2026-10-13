// The caller MUST authorize before using this cache. Never caches authorization.
export class VersionCache<T> {
  private entries = new Map<string, { version: string; used: number; value: Promise<T> }>();
  private capacity: number;
  private ttl: number;
  constructor(capacity = 2, ttl = 300000) { this.capacity = capacity; this.ttl = ttl; }
  delete(key: string) { this.entries.delete(key); }
  get(key: string, version: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [id, entry] of this.entries) if (now - entry.used > this.ttl) this.entries.delete(id);
    const hit = this.entries.get(key);
    if (hit?.version === version) { hit.used = now; return hit.value; }
    this.entries.delete(key);
    while (this.entries.size >= this.capacity) {
      const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used)[0][0];
      this.entries.delete(oldest);
    }
    const value = Promise.resolve().then(loader);
    this.entries.set(key, { version, used: now, value });
    void value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }
}

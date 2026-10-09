/**
 * Ephemeral Storage for OpenUpscale
 * Stores processed images temporarily in memory with automatic TTL purge.
 * Guarantees zero persistent storage and complete privacy.
 */

export interface StoredImage {
  id: string;
  originalName: string;
  format: string;
  mimeType: string;
  buffer: Buffer;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
  scale: number;
  preset: string;
  createdAt: number;
  expiresAt: number;
}

class EphemeralStorage {
  private items = new Map<string, StoredImage>();
  private readonly DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

  constructor() {
    // Background purge timer every 2 minutes
    setInterval(() => {
      this.purgeExpired();
    }, 2 * 60 * 1000);
  }

  public store(item: Omit<StoredImage, 'createdAt' | 'expiresAt'>, customTtlMs?: number): StoredImage {
    const now = Date.now();
    const stored: StoredImage = {
      ...item,
      createdAt: now,
      expiresAt: now + (customTtlMs || this.DEFAULT_TTL_MS),
    };
    this.items.set(item.id, stored);
    return stored;
  }

  public get(id: string): StoredImage | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) {
      this.items.delete(id);
      return undefined;
    }
    return item;
  }

  public delete(id: string): boolean {
    return this.items.delete(id);
  }

  public getMultiple(ids: string[]): StoredImage[] {
    const results: StoredImage[] = [];
    for (const id of ids) {
      const item = this.get(id);
      if (item) results.push(item);
    }
    return results;
  }

  public purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, item] of this.items.entries()) {
      if (now > item.expiresAt) {
        this.items.delete(id);
        count++;
      }
    }
    return count;
  }

  public clearAll(): number {
    const count = this.items.size;
    this.items.clear();
    return count;
  }

  public getStats() {
    let totalBytes = 0;
    for (const item of this.items.values()) {
      totalBytes += item.buffer.length;
    }
    return {
      activeFiles: this.items.size,
      totalMemoryBytes: totalBytes,
    };
  }
}

export const ephemeralStorage = new EphemeralStorage();

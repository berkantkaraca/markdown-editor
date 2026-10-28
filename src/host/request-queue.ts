import { createHash } from "node:crypto";

export interface WriteRequest { session: string; requestId: number; type: "edit" | "save"; text: string; base: number }
export interface WriteResult { text: string; version: number; isDirty: boolean; conflict?: boolean; success?: boolean }

// Duplicate deliveries share one promise, including while applyEdit/save awaits.
export class RequestQueue {
  private cache = new Map<string, { signature: string; result: Promise<WriteResult>; size: number; done: boolean }>();
  private completed = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();

  execute(request: WriteRequest, apply: () => Promise<WriteResult>, stale: () => WriteResult): Promise<WriteResult> {
    const key = `${request.session}:${request.requestId}`;
    const signature = createHash("sha256").update(`${request.type}:${request.base}:`).update(request.text).digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached.signature === signature ? cached.result : Promise.resolve({ ...stale(), conflict: true, success: false });
    if (request.requestId <= (this.completed.get(request.session) ?? -1)) return Promise.resolve({ ...stale(), conflict: true, success: false });
    const result = this.tail.then(async () => {
      try { return await apply(); }
      catch { return { ...stale(), conflict: request.type === "edit", success: false }; }
    });
    this.cache.set(key, { signature, result, size: 0, done: false }); this.tail = result;
    void result.then((value) => {
      this.completed.set(request.session, Math.max(request.requestId, this.completed.get(request.session) ?? -1));
      const entry = this.cache.get(key); if (entry) { entry.size = value.text.length; entry.done = true; }
      let size = Array.from(this.cache.values()).reduce((sum, item) => sum + item.size, 0);
      for (const [oldKey, item] of this.cache) {
        if (this.cache.size <= 50 && size <= 5_000_000) break;
        if (oldKey !== key && item.done) { this.cache.delete(oldKey); size -= item.size; }
      }
    });
    return result;
  }
}

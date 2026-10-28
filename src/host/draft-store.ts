import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LocalDraft } from "../webview/document-sync";
import { normalizeNewlines } from "../shared/md-utils";

export class DraftStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private readonly directory: string) {}
  private filename(uri: string): string { return path.join(this.directory, createHash("sha256").update(uri).digest("hex") + ".json"); }
  private enqueue<T>(uri: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(uri) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action); this.queues.set(uri, next);
    void next.finally(() => { if (this.queues.get(uri) === next) this.queues.delete(uri); }).catch(() => {});
    return next;
  }
  write(uri: string, draft: LocalDraft): Promise<void> {
    return this.enqueue(uri, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const file = this.filename(uri), temporary = file + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temporary, JSON.stringify({ ...draft, uri }), { encoding: "utf8", mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.unlink(temporary).catch(() => {}); }
    });
  }
  async read(uri: string): Promise<LocalDraft | null> {
    await this.queues.get(uri)?.catch(() => {});
    return this.readFile(uri);
  }
  private async readFile(uri: string): Promise<LocalDraft | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.filename(uri), "utf8"));
      if (value.uri !== uri || typeof value.text !== "string" || typeof value.baseText !== "string" || !Number.isFinite(value.updatedAt)) return null;
      return { text: value.text, baseText: value.baseText, baseVersion: Number(value.baseVersion), updatedAt: value.updatedAt };
    } catch { return null; }
  }
  clear(uri: string, savedText?: string): Promise<void> {
    return this.enqueue(uri, async () => {
      const draft = await this.readFile(uri);
      if (savedText !== undefined && draft && normalizeNewlines(draft.text) !== normalizeNewlines(savedText)) return;
      await fs.unlink(this.filename(uri)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    });
  }
}

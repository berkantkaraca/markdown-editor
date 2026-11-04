import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

const generated = /^(?:img|yapistirilan)-\d{14}(?:-\d+)?\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;
export function generatedImages(text: string): string[] {
  return [...new Set(text.match(/(?:img|yapistirilan)-\d{14}(?:-\d+)?\.(?:png|jpe?g|gif|webp|bmp|svg)/gi) || [])];
}
export function mentionsImage(text: string, name: string): boolean {
  const normalized = text.toLowerCase(); return normalized.includes(name.toLowerCase()) || normalized.includes(encodeURIComponent(name).toLowerCase());
}

// Removed generated files are backed up outside the project so undo can restore
// them, including after reopening VS Code. User-selected originals are never removed.
export class ImageAssets {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly recoveryDirectory: string) {}
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(run); this.tail = next; return next;
  }
  private backup(file: string): string { return path.join(this.recoveryDirectory, createHash("sha256").update(path.resolve(file).toLowerCase()).digest("hex")); }
  async hasRecovery(directory: string, name: string): Promise<boolean> {
    try { await fs.access(this.backup(this.file(directory, name))); return true; } catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
  }
  private file(directory: string, name: string): string {
    if (!generated.test(name) || path.basename(name) !== name) throw Error("Not an editor-generated image");
    return path.join(directory, "assets", name);
  }
  restore(directory: string, text: string): Promise<boolean> {
    return this.enqueue(async () => {
      let restored = false;
      for (const name of generatedImages(text)) {
        const file = this.file(directory, name);
        try {
          await fs.access(file); // Never replace an existing file.
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
          let data: Buffer;
          try { data = await fs.readFile(this.backup(file)); } catch (missing: any) { if (missing.code === "ENOENT") continue; throw missing; }
          await fs.mkdir(path.dirname(file), { recursive: true });
          const realDirectory = await fs.realpath(directory), realAssets = await fs.realpath(path.dirname(file));
          if (path.dirname(realAssets).toLowerCase() !== realDirectory.toLowerCase() || path.basename(realAssets).toLowerCase() !== "assets") continue;
          await fs.writeFile(file, data, { flag: "wx" }).catch((exists: NodeJS.ErrnoException) => { if (exists.code !== "EEXIST") throw exists; });
          restored = true;
        }
      }
      return restored;
    });
  }
  cleanup(directory: string, candidates: string[], referenced: () => Promise<string[]>): Promise<void> {
    return this.enqueue(async () => {
      if (!candidates.length) return;
      const texts = await referenced(); // A failed or incomplete scan must prevent deletion.
      for (const name of candidates) {
        const file = this.file(directory, name);
        if (texts.some(text => mentionsImage(text, name))) continue;
        const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
        if (!info?.isFile() || info.isSymbolicLink()) continue;
        // Resolve the parent too: an assets junction must not cause an external deletion.
        const realDirectory = await fs.realpath(directory), realAssets = await fs.realpath(path.dirname(file));
        if (path.dirname(realAssets).toLowerCase() !== realDirectory.toLowerCase() || path.basename(realAssets).toLowerCase() !== "assets") continue;
        const data = await fs.readFile(file);
        await fs.mkdir(this.recoveryDirectory, { recursive: true });
        await fs.writeFile(this.backup(file), data);
        // Recheck open/dirty documents immediately before removing the file.
        if ((await referenced()).some(text => mentionsImage(text, name))) continue;
        if (!(await fs.readFile(file)).equals(data)) continue;
        await fs.unlink(file);
      }
    });
  }
}

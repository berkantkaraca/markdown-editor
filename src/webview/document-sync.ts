import { mergeTexts, normalizeNewlines } from "../shared/md-utils";

export interface DocumentSnapshot { text: string; version: number; isDirty?: boolean }
export interface LocalDraft { text: string; baseText: string; baseVersion: number; updatedAt: number }
export type SyncState = "idle" | "syncing" | "retrying" | "blocked";
export interface SyncOptions {
  send(message: Record<string, unknown>): void;
  changed(text: string, external: boolean): void;
  status(dirty: boolean): void;
  recover(text: string): void;
  draftChanged?(draft: LocalDraft | null): void;
  stateChanged?(state: SyncState): void;
  sessionId?: string;
  ackTimeoutMs?: number;
  maxRetries?: number;
}
interface Flight { kind: "edit" | "save"; text: string; base: number; id: number; attempts: number }

// Every retry reuses its session/request ID. The host deduplicates these IDs.
export class DocumentSync {
  text = "";
  readonly session: string;
  private base: DocumentSnapshot = { text: "", version: -1 };
  private flight: Flight | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private acknowledgement: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private deferred: DocumentSnapshot | null = null;
  private saveRequested = false;
  private hasDraft = false;
  private blocked = false;

  constructor(private readonly options: SyncOptions) {
    this.session = options.sessionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  }
  edit(text: string): void {
    text = normalizeNewlines(text);
    if (text === this.text) return;
    this.text = text; this.hasDraft = true;
    this.persistDraft();
    this.options.changed(text, false); this.options.status(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150); this.timer.unref?.();
  }
  flush(): void {
    clearTimeout(this.timer);
    if (this.flight || this.base.version < 0 || this.blocked) return;
    const kind = this.text !== this.base.text ? "edit" : this.saveRequested ? "save" : null;
    if (!kind) return;
    if (kind === "save") this.saveRequested = false;
    this.flight = { kind, text: this.text, base: this.base.version, id: ++this.sequence, attempts: 0 };
    this.transmit();
  }
  save(): void { this.saveRequested = true; if (this.blocked) this.retry(); else this.flush(); }
  retry(): void {
    this.blocked = false;
    if (this.flight) { this.flight.attempts = 0; this.transmit(); }
    else this.flush();
  }
  private transmit(): void {
    const flight = this.flight;
    if (!flight) return;
    clearTimeout(this.acknowledgement);
    this.options.stateChanged?.(flight.attempts ? "retrying" : "syncing");
    try {
      this.options.send({ type: flight.kind, text: flight.text, base: flight.base, requestId: flight.id, session: this.session });
    } catch { this.block(); return; }
    // A synchronous test transport may already have acknowledged the request.
    if (this.flight !== flight) return;
    this.acknowledgement = setTimeout(() => {
      if (this.flight !== flight) return;
      if (flight.attempts >= (this.options.maxRetries ?? 2)) { this.block(); return; }
      flight.attempts++; this.transmit();
    }, (this.options.ackTimeoutMs ?? 3000) * 2 ** flight.attempts);
    this.acknowledgement.unref?.();
  }
  private block(): void {
    clearTimeout(this.acknowledgement); this.blocked = true;
    this.options.status(true); this.options.stateChanged?.("blocked");
  }
  receive(snapshot: DocumentSnapshot): void {
    snapshot = { ...snapshot, text: normalizeNewlines(snapshot.text) };
    if (snapshot.version < this.base.version) return;
    if (this.flight) { this.deferred = snapshot; return; }
    this.rebase(snapshot); this.flush();
  }
  acknowledge(id: number, snapshot: DocumentSnapshot, conflict = false): void {
    if (this.flight?.kind !== "edit") return;
    this.finish(id, snapshot, conflict);
  }
  saved(id: number, snapshot: DocumentSnapshot, success: boolean): void {
    if (this.flight?.kind !== "save" || this.flight.id !== id) return;
    if (!success) {
      clearTimeout(this.acknowledgement); this.flight = null; this.saveRequested = true;
      this.persistDraft(); this.block(); return;
    }
    this.finish(id, snapshot, false);
  }
  private finish(id: number, snapshot: DocumentSnapshot, conflict: boolean): void {
    if (!this.flight || this.flight.id !== id) return;
    snapshot = { ...snapshot, text: normalizeNewlines(snapshot.text) };
    clearTimeout(this.acknowledgement);
    const sent = this.flight.text; this.flight = null; this.blocked = false;
    const local = this.text;
    const next = conflict ? null : mergeTexts(sent, snapshot.text, local);
    if (next === null) {
      this.saveRequested = false; this.options.recover(local); this.hasDraft = false;
    }
    this.base = snapshot; this.text = next ?? snapshot.text;
    if (this.text !== local) this.options.changed(this.text, true);
    this.options.status(!!snapshot.isDirty || this.text !== snapshot.text);
    this.options.stateChanged?.("idle"); this.persistDraft();
    const deferred = this.deferred; this.deferred = null;
    if (deferred && deferred.version >= snapshot.version) this.rebase(deferred);
    this.flush();
  }
  private rebase(snapshot: DocumentSnapshot): void {
    const local = this.text;
    const next = mergeTexts(this.base.text, snapshot.text, local);
    if (next === null) { this.options.recover(local); this.hasDraft = false; }
    this.base = snapshot; this.text = next ?? snapshot.text;
    if (this.text !== local) this.options.changed(this.text, true);
    this.options.status(!!snapshot.isDirty || this.text !== snapshot.text); this.persistDraft();
  }
  private persistDraft(): void {
    if (!this.hasDraft) return;
    if (this.text === this.base.text && !this.base.isDirty && !this.flight) {
      this.hasDraft = false; this.options.draftChanged?.(null); return;
    }
    this.options.draftChanged?.({ text: this.text, baseText: this.base.text, baseVersion: this.base.version, updatedAt: Date.now() });
  }
  dispose(): void { clearTimeout(this.timer); clearTimeout(this.acknowledgement); }
}

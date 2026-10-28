import { mergeTexts, normalizeNewlines } from "../shared/md-utils";

export interface DocumentSnapshot { text: string; version: number; isDirty?: boolean }
export interface SyncOptions {
  send(message: Record<string, unknown>): void;
  changed(text: string, external: boolean): void;
  status(dirty: boolean): void;
  recover(text: string): void;
}

// One request at a time: an acknowledgement always identifies its own draft.
// Focus never decides whether a server revision may replace local text.
export class DocumentSync {
  text = "";
  private base: DocumentSnapshot = { text: "", version: -1 };
  private flight: { text: string; id: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private deferred: DocumentSnapshot | null = null;
  private saveRequested = false;

  constructor(private readonly options: SyncOptions) {}

  edit(text: string): void {
    text = normalizeNewlines(text);
    if (text === this.text) return;
    this.text = text;
    this.options.changed(text, false);
    this.options.status(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush(): void {
    clearTimeout(this.timer);
    if (this.flight || this.base.version < 0) return;
    if (this.text === this.base.text) {
      if (this.saveRequested) { this.saveRequested = false; this.options.send({ type: "save" }); }
      return;
    }
    this.flight = { text: this.text, id: ++this.sequence };
    this.options.send({ type: "edit", text: this.text, base: this.base.version, requestId: this.flight.id });
  }

  save(): void { this.saveRequested = true; this.flush(); }

  receive(snapshot: DocumentSnapshot): void {
    snapshot = { ...snapshot, text: normalizeNewlines(snapshot.text) };
    if (snapshot.version < this.base.version) return;
    if (this.flight) { this.deferred = snapshot; return; }
    this.rebase(snapshot);
    this.flush();
  }

  acknowledge(id: number, snapshot: DocumentSnapshot, conflict = false): void {
    snapshot = { ...snapshot, text: normalizeNewlines(snapshot.text) };
    if (!this.flight || this.flight.id !== id) return;
    const sent = this.flight.text;
    this.flight = null;
    const local = this.text;
    const next = conflict ? null : mergeTexts(sent, snapshot.text, local);
    if (next === null) { this.saveRequested = false; this.options.recover(local); }
    this.base = snapshot;
    this.text = next ?? snapshot.text;
    if (this.text !== local) this.options.changed(this.text, true);
    this.options.status(!!snapshot.isDirty || this.text !== snapshot.text);
    const deferred = this.deferred;
    this.deferred = null;
    if (deferred && deferred.version > snapshot.version) this.rebase(deferred);
    this.flush();
  }

  private rebase(snapshot: DocumentSnapshot): void {
    const local = this.text;
    const next = mergeTexts(this.base.text, snapshot.text, local);
    if (next === null) this.options.recover(local);
    this.base = snapshot;
    this.text = next ?? snapshot.text;
    if (this.text !== local) this.options.changed(this.text, true);
    this.options.status(!!snapshot.isDirty || this.text !== snapshot.text);
  }
}

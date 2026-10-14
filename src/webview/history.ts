// Geri al / yinele: imleç çapalı anlık-görüntü zinciri.
// Bağımlılıklar ctor'da enjekte edilir; modül kendi başına durum tutar.
export interface HistEntry {
  text: string;
  anchor: number | null; // doküman offset'i
}

export interface HistDeps {
  getText(): string;
  getAnchor(): number | null;
  apply(text: string, anchor: number | null): void;
  changed(): void;
}

export interface History {
  record(force?: boolean): void;
  undo(): void;
  redo(): void;
  seed(text: string): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

const MAX_ENTRIES = 100;
const MAX_CHARS = 2000000;

export function createHistory(deps: HistDeps): History {
  const hist: HistEntry[] = [];
  let hi = -1;
  let lastRecTime = 0;

  const chars = (): number => {
    let n = 0;
    for (const h of hist) {
      n += h.text.length;
    }
    return n;
  };

  return {
    record(force = false) {
      const now = Date.now();
      const top = hi >= 0 ? hist[hi] : undefined;
      if (top && top.text === deps.getText()) {
        return;
      }
      if (!force && now - lastRecTime < 2500 && hi >= 0) {
        return;
      }
      lastRecTime = now;
      hist.length = hi + 1;
      hist.push({ text: deps.getText(), anchor: deps.getAnchor() });
      hi = hist.length - 1;
      while (hist.length > MAX_ENTRIES || chars() > MAX_CHARS) {
        hist.shift();
        hi--;
      }
      deps.changed();
    },

    undo() {
      if (hi < 0) {
        return;
      }
      if (deps.getText() !== hist[hi].text) {
        // Henüz kaydedilmemiş yazım: anlık durumu kaydet, sonra geri git
        hist.length = hi + 1;
        hist.push({ text: deps.getText(), anchor: deps.getAnchor() });
        hi = hist.length - 1;
      }
      if (hi > 0) {
        hi--;
        const e = hist[hi];
        deps.apply(e.text, e.anchor);
      } else {
        deps.changed();
      }
    },

    redo() {
      if (hi < hist.length - 1) {
        hi++;
        const e = hist[hi];
        deps.apply(e.text, e.anchor);
      }
    },

    seed(text: string) {
      if (hist.length === 0) {
        hist.push({ text, anchor: null });
        hi = 0;
      }
    },

    get canUndo() {
      return hi > 0 || (hi >= 0 && deps.getText() !== hist[hi].text);
    },

    get canRedo() {
      return hi < hist.length - 1;
    },
  };
}

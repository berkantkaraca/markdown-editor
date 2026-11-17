export const editorModes = ["source", "live", "split", "reading"] as const;
export type EditorMode = typeof editorModes[number];

export function isEditorMode(value: unknown): value is EditorMode {
  return editorModes.some(mode => mode === value);
}

export interface EditorPreferences {
  language: "en" | "tr";
  defaultMode: EditorMode;
  wordWrap: boolean;
  lineNumbers: boolean;
  showGitIndicators: boolean;
}

export const editorDefaults: EditorPreferences = {
  language: "en", defaultMode: "live", wordWrap: true, lineNumbers: true, showGitIndicators: true,
};

export function parseEditorPreference(key: unknown, value: unknown): Partial<EditorPreferences> | undefined {
  switch (key) {
    case "language": return value === "en" || value === "tr" ? { language: value } : undefined;
    case "defaultMode": return isEditorMode(value) ? { defaultMode: value } : undefined;
    case "wordWrap":
    case "lineNumbers":
    case "showGitIndicators": return typeof value === "boolean" ? { [key]: value } : undefined;
  }
}

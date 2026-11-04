import * as vscode from "vscode";

// Narrow, read-only subset of the built-in vscode.git API (API version 1).
interface GitRepository {
  state: { HEAD?: { commit?: string }; indexChanges: GitFileChange[]; workingTreeChanges: GitFileChange[]; untrackedChanges?: GitFileChange[]; onDidChange: vscode.Event<void> };
  show(ref: string, file: string): Promise<string>;
}
interface GitFileChange { uri: vscode.Uri; originalUri: vscode.Uri; status: number }
interface GitAPI {
  getRepository(uri: vscode.Uri): GitRepository | null;
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

export async function watchGitBaseline(uri: vscode.Uri, changed: (text: string | null) => void): Promise<vscode.Disposable> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>("vscode.git");
  if (!extension || uri.scheme !== "file") { changed(null); return new vscode.Disposable(() => {}); }
  let disposed = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const subscriptions: vscode.Disposable[] = [];
  let repositorySub: vscode.Disposable | undefined;
  const api = (await extension.activate()).getAPI(1);
  let last: string | null | undefined;
  const emit = (value: string | null) => { if (!disposed && value !== last) { last = value; changed(value); } };
  const refresh = async () => {
    const request = ++generation, repository = api.getRepository(uri);
    if (!repository) { emit(null); return; }
    try {
      let text: string;
      try { text = await repository.show("HEAD", uri.fsPath); }
      catch {
        const changes = [...repository.state.indexChanges, ...repository.state.workingTreeChanges, ...(repository.state.untrackedChanges || [])];
        const change = changes.find(item => item.uri.toString() === uri.toString());
        // INDEX_RENAMED: compare the old committed path, not a fictitious new file.
        if (change?.status === 3) text = await repository.show("HEAD", change.originalUri.fsPath);
        else if (change && [1, 4, 7, 9].includes(change.status)) text = "";
        else { if (request === generation) emit(null); return; }
      }
      if (request === generation) emit(text);
    } catch { if (request === generation) emit(null); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 200); };
  const attach = () => { repositorySub?.dispose(); repositorySub = api.getRepository(uri)?.state.onDidChange(schedule); schedule(); };
  subscriptions.push(api.onDidOpenRepository(attach), api.onDidCloseRepository(attach));
  attach(); await refresh();
  return new vscode.Disposable(() => { disposed = true; generation++; clearTimeout(timer); repositorySub?.dispose(); subscriptions.forEach(item => item.dispose()); });
}

import { RequestQueue } from "./host/request-queue";
import { DraftStore } from "./host/draft-store";
import { normalizeNewlines } from "./shared/md-utils";
import editorLayout from "./webview/layout.html";
import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import * as fs from "fs";
import { mimeToExt, parseWikilink, fileNameForTarget, findHeadingLine, parseHeadings, mergeTexts } from "./shared/md-utils";
import type { HeadingNode } from "./shared/md-utils";
import { escapeRegExp } from "./shared/md-utils";

// Webview <-> extension mesaj protokolü sürümü (iki taraf da bilmediğini yoksayar)
const PROTO = 1;

export function activate(context: vscode.ExtensionContext) {
  const provider = new KaracaMarkdownProvider(context);
  const reg = vscode.window.registerCustomEditorProvider(
    "karaca.mdEditor",
    provider,
    {
      // NOT: retainContextWhenHidden kapalı tutuluyor. Açıkken sekme kapatılıp
      // aynı pencerede yeniden açılınca VS Code'un service worker kaydı
      // "InvalidStateError: document is in an invalid state" ile patlıyor.
      // State zaten TextDocument üzerinden senkron (ready/update/edit), bu
      // yüzden JS context'ini arka planda tutmaya gerek yok.
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false,
    }
  );

  context.subscriptions.push(
    reg,
    vscode.commands.registerCommand("karaca-md.openLive", async () => {
      const editor = vscode.window.activeTextEditor;
      const target = editor?.document?.languageId === "markdown" ? editor.document.uri : undefined;
      if (!target) {
        vscode.window.showInformationMessage("Önce bir Markdown (.md) dosyası açın.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
    }),
    vscode.commands.registerCommand("karaca-md.showSource", async () => {
      const uri = getActiveCustomUri();
      if (!uri) {
        vscode.window.showInformationMessage("Aktif Karaca MD sekmesi bulunamadı.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", uri, "default");
    }),
    vscode.commands.registerCommand("karaca-md.reveal", async (uri: vscode.Uri, line: number) => {
      await vscode.commands.executeCommand("vscode.openWith", uri, "karaca.mdEditor");
      await provider.revealLine(uri, Number(line) || 0);
    }),
    vscode.commands.registerCommand("karaca-md.newNote", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Not adı",
        placeHolder: "Örn: Toplantı notları",
      });
      if (!name?.trim()) {
        return;
      }
      const clean = name.trim().replace(/[\\/]+/g, "-");
      const dir = activeMdDir() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!dir) {
        vscode.window.showInformationMessage("Önce bir klasör açın veya bir md dosyası açın.");
        return;
      }
      const fileName = clean.endsWith(".md") ? clean : `${clean}.md`;
      const target = vscode.Uri.file(path.join(dir, fileName));
      if (!(await uriExists(target))) {
        await vscode.workspace.fs.writeFile(target, Buffer.from(`# ${clean}\n`, "utf8"));
      }
      await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
    }),
    vscode.commands.registerCommand("karaca-md.dailyNote", async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? activeMdDir();
      if (!root) {
        vscode.window.showInformationMessage("Önce bir klasör açın.");
        return;
      }
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const target = vscode.Uri.file(path.join(root, `${stamp}.md`));
      if (!(await uriExists(target))) {
        await vscode.workspace.fs.writeFile(
          target,
          Buffer.from(`# ${stamp}\n\n## Görevler\n\n- [ ] \n`, "utf8")
        );
      }
      await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
    })
  );

  const outline = new KaracaOutlineProvider();
  const backlinks = new KaracaBacklinkProvider();
  let backlinkTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleBacklinks = () => {
    if (backlinkTimer) {
      clearTimeout(backlinkTimer);
    }
    backlinkTimer = setTimeout(() => {
      void backlinks.rebuild(getActiveMdDoc());
    }, 1000);
  };
  const refreshViews = () => {
    outline.refresh();
    scheduleBacklinks();
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("karacaOutline", outline),
    vscode.window.registerTreeDataProvider("karacaBacklinks", backlinks),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.fsPath.toLowerCase().endsWith(".md")) {
        outline.refresh();
        scheduleBacklinks();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.fsPath.toLowerCase().endsWith(".md")) {
        refreshViews();
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => refreshViews())
  );
  refreshViews();
}

function getActiveCustomUri(): vscode.Uri | undefined {
  const tabGroups = vscode.window.tabGroups.all;
  for (const g of tabGroups) {
    for (const t of g.tabs) {
      const input = t.input as any;
      if (input?.viewType === "karaca.mdEditor" && input?.uri) {
        return input.uri as vscode.Uri;
      }
    }
  }
  return undefined;
}

// ---------- İçindekiler + geri bağlantılar ----------
interface MdDoc {
  uri: vscode.Uri;
  text: string;
}

function getActiveMdDoc(): MdDoc | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const uri = (tab?.input as any)?.uri as vscode.Uri | undefined;
  if (!uri || !(uri instanceof vscode.Uri) || !uri.fsPath.toLowerCase().endsWith(".md")) {
    return undefined;
  }
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (!doc) {
    return undefined;
  }
  return { uri, text: doc.getText() };
}

function activeMdDir(): string | undefined {
  const doc = getActiveMdDoc();
  return doc ? path.dirname(doc.uri.fsPath) : undefined;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

class OutlineItem extends vscode.TreeItem {
  constructor(
    readonly node: HeadingNode,
    uri: vscode.Uri
  ) {
    super(
      node.label,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.description = `${node.line + 1}`;
    this.command = { command: "karaca-md.reveal", title: "Git", arguments: [uri, node.line] };
  }
}

class KaracaOutlineProvider implements vscode.TreeDataProvider<OutlineItem> {
  private em = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.em.event;
  refresh(): void {
    this.em.fire();
  }
  getTreeItem(el: OutlineItem): vscode.TreeItem {
    return el;
  }
  getChildren(el?: OutlineItem): OutlineItem[] {
    if (el) {
      const uri = (el.command?.arguments?.[0] as vscode.Uri) ?? getActiveMdDoc()?.uri;
      if (!uri) {
        return [];
      }
      return el.node.children.map((n) => new OutlineItem(n, uri));
    }
    const doc = getActiveMdDoc();
    if (!doc) {
      return [];
    }
    return parseHeadings(doc.text).map((n) => new OutlineItem(n, doc.uri));
  }
}

async function findBacklinks(target: vscode.Uri): Promise<vscode.Uri[]> {
  const base = path.basename(target.fsPath).replace(/\.md$/i, "");
  if (!base) {
    return [];
  }
  const files = await vscode.workspace.findFiles("**/*.md", "**/node_modules/**", 500);
  const out: vscode.Uri[] = [];
  // [[Ad]] için önek çakışmasız eşleşme ([[Ad]] / [[Ad#..]] / [[Ad|..]])
  const wikiRe = new RegExp(`\\[\\[${escapeRegExp(base)}(?:[#|\\]])`);
  for (const f of files) {
    if (f.toString() === target.toString()) {
      continue;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(f);
      if (bytes.length > 2_000_000) {
        continue;
      }
      const t = Buffer.from(bytes).toString("utf8");
      if (
        wikiRe.test(t) ||
        t.includes(`](${base}.md`) ||
        t.includes(`](${base}#`) ||
        t.includes(`](${base})`)
      ) {
        out.push(f);
      }
    } catch {
      // okunamayanı atla
    }
  }
  return out.slice(0, 100);
}

class KaracaBacklinkProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private em = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.em.event;
  private cache: vscode.Uri[] = [];
  async rebuild(doc: MdDoc | undefined): Promise<void> {
    this.cache = doc ? await findBacklinks(doc.uri) : [];
    this.em.fire();
  }
  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }
  getChildren(): vscode.TreeItem[] {
    return this.cache.map((u) => {
      const it = new vscode.TreeItem(path.basename(u.fsPath), vscode.TreeItemCollapsibleState.None);
      it.resourceUri = u;
      it.command = { command: "vscode.openWith", title: "Aç", arguments: [u, "karaca.mdEditor"] };
      return it;
    });
  }
}

class KaracaMarkdownProvider implements vscode.CustomTextEditorProvider {
  // Açık paneller (reveal-line / outline navigasyonu için uri -> panel)
  readonly panels = new Map<string, vscode.WebviewPanel>();
  // Sürüm tarihçesi (çakışan yazımlarda üç-yönlü birleştirme için uri -> version -> metin)
  private readonly docVersions = new Map<string, Map<number, string>>();

  private readonly drafts: DraftStore;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.drafts = new DraftStore(path.join(context.globalStorageUri.fsPath, "drafts"));
  }

  private recordVersion(uri: vscode.Uri, version: number, text: string): void {
    const key = uri.toString();
    let m = this.docVersions.get(key);
    if (!m) {
      m = new Map<number, string>();
      this.docVersions.set(key, m);
    }
    m.set(version, text);
    let chars = 0;
    for (const t of m.values()) {
      chars += t.length;
    }
    while ((m.size > 30 || chars > 5000000) && m.size > 1) {
      const oldest = m.keys().next();
      if (oldest.done) {
        break;
      }
      const t = m.get(oldest.value);
      if (t !== undefined) {
        chars -= t.length;
      }
      m.delete(oldest.value);
    }
  }

  private getVersionText(uri: vscode.Uri, version: number): string | undefined {
    return this.docVersions.get(uri.toString())?.get(version);
  }

  private async applyText(document: vscode.TextDocument, text: string): Promise<boolean> {
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, text);
    return await vscode.workspace.applyEdit(edit);
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "media")),
        vscode.Uri.file(path.join(this.context.extensionPath, "dist")),
        // Göreli görseller için md dosyasının klasörü + workspace kökleri
        // (../ ile üst klasöre çıkan yollar workspace içindeyse yüklenir;
        // dışarısı yükleyici tarafından engellenir)
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
      ],
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
    this.panels.set(document.uri.toString(), webviewPanel);
    this.recordVersion(document.uri, document.version, document.getText());

    const requests = new RequestQueue();
    const draftKey = document.uri.toString();
    let draftWarningShown = false;
    const draftError = () => {
      if (draftWarningShown) return;
      draftWarningShown = true;
      void vscode.window.showWarningMessage("Yerel taslak yedeği yazılamadı. Belgeyi Ctrl+S ile kaydedin.");
    };
    const snapshot = () => ({ text: document.getText(), version: document.version, isDirty: document.isDirty });
    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        proto: PROTO,
        type: "update",
        text: document.getText(),
        version: document.version,
        isDirty: document.isDirty,
      });
    };

    const cfg = () => vscode.workspace.getConfiguration("karacaMd");
    const postConfig = () => {
      webviewPanel.webview.postMessage({
        proto: PROTO,
        type: "config",
        defaultMode: cfg().get<string>("defaultMode", "live"),
        wordWrap: cfg().get<boolean>("wordWrap", true),
        lineNumbers: cfg().get<boolean>("lineNumbers", true),
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        this.recordVersion(document.uri, e.document.version, e.document.getText());
        updateWebview();
      }
    });
    const saveSub = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === document.uri.toString()) {
        updateWebview(); void this.drafts.clear(draftKey, saved.getText()).catch(draftError);
      }
    });
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("karacaMd")) {
        postConfig();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      saveSub.dispose();
      configSub.dispose();
      this.panels.delete(document.uri.toString());
      this.docVersions.delete(document.uri.toString());
    });

    // Webview'den gelen mesajlar
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.proto !== undefined && msg.proto !== PROTO) {
        return; // bilinmeyen protokol sürümü
      }
      switch (msg?.type) {
        case "ready": {
          postConfig();
          updateWebview();
          const draft = await this.drafts.read(draftKey);
          if (draft && !document.isDirty && normalizeNewlines(draft.text) === normalizeNewlines(document.getText())) {
            await this.drafts.clear(draftKey, document.getText()).catch(draftError);
          } else webviewPanel.webview.postMessage({ proto: PROTO, type: "draft-state", draft });
          break;
        }
        case "draft": {
          const draft = msg.draft;
          if (draft && typeof draft.text === "string" && typeof draft.baseText === "string" && Number.isFinite(draft.updatedAt)) {
            await this.drafts.write(draftKey, { text: draft.text, baseText: draft.baseText, baseVersion: Number(draft.baseVersion), updatedAt: draft.updatedAt }).catch(draftError);
          }
          break;
        }
        case "draft-clear": {
          if (typeof msg.expectedText === "string") await this.drafts.clear(draftKey, msg.expectedText).catch(draftError);
          break;
        }
        case "edit":
        case "save": {
          if (typeof msg.text !== "string" || typeof msg.requestId !== "number" || typeof msg.session !== "string") break;
          const result = await requests.execute(msg, async () => {
            if (msg.type === "save") { const success = await document.save(); return { ...snapshot(), success }; }
            const current = normalizeNewlines(document.getText());
            const baseText = msg.base === document.version ? current : this.getVersionText(document.uri, msg.base);
            const merged = normalizeNewlines(msg.text) === current ? current : baseText === undefined ? null : mergeTexts(normalizeNewlines(baseText), current, normalizeNewlines(msg.text));
            let conflict = merged === null;
            if (merged !== null && merged !== current) conflict = !(await this.applyText(document, merged));
            return { ...snapshot(), conflict };
          }, snapshot);
          // Read dirty state after save resolves; no cached pre-save snapshot.
          const reply = msg.type === "save" && result.success ? { ...result, ...snapshot() } : result;
          webviewPanel.webview.postMessage({ proto: PROTO, type: msg.type === "save" ? "save-result" : "edit-result",
            requestId: msg.requestId, session: msg.session, ...reply });
          break;
        }
        case "open-link": {
          // Göreli dosya / başlık linkleri
          const href: string = msg.href ?? "";
          await this.handleLink(document, href);
          break;
        }
        case "open-wikilink": {
          const name: string = msg.name ?? "";
          await this.handleWikilink(document, name);
          break;
        }
        case "paste-image": {
          await this.handlePasteImage(document, msg);
          break;
        }
        case "save-image": {
          await this.handleSaveImage(document, webviewPanel, msg);
          break;
        }
        case "resolve-imgs": {
          await this.handleResolveImgs(document, webviewPanel, msg.paths);
          break;
        }
        case "error": {
          vscode.window.showErrorMessage(`Markdown editör: ${msg.message}`);
          break;
        }
      }
    });
  }

  private async handleLink(document: vscode.TextDocument, href: string) {
    try {
      if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
        await vscode.env.openExternal(vscode.Uri.parse(href));
        return;
      }
      if (href.startsWith("#")) {
        // Aynı dosya içi başlık: ilgili satıra kaydır
        const line = findHeadingLine(document.getText(), decodeURIComponent(href.slice(1)));
        if (line >= 0) {
          const panel = this.panels.get(document.uri.toString());
          panel?.webview.postMessage({ proto: PROTO, type: "reveal-line", line });
        }
        return;
      }
      const cleaned = href.split("#")[0].split("?")[0];
      if (!cleaned) {
        return;
      }
      const baseDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
      const target = vscode.Uri.file(path.resolve(baseDir.fsPath, decodeURIComponent(cleaned)));
      try {
        await vscode.workspace.fs.stat(target);
        await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
      } catch {
        // Dosya yoksa oluşturmayı teklif et
        const create = await vscode.window.showInformationMessage(
          `"${cleaned}" bulunamadı. Oluşturulsun mu?`,
          "Oluştur",
          "Vazgeç"
        );
        if (create === "Oluştur") {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(target.fsPath))
          );
          await vscode.workspace.fs.writeFile(target, Buffer.from(`# ${cleaned}\n`, "utf8"));
          await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Bağlantı açılamadı: ${err?.message ?? err}`);
    }
  }

  private async handleWikilink(document: vscode.TextDocument, rawInner: string) {
    // [[Not]], [[Not#Başlık]], [[Not|Etiket]], [[Not#Başlık|Etiket]]
    const p = parseWikilink(rawInner);
    if (!p) {
      return;
    }
    const fileName = fileNameForTarget(p.target);
    // Önce aynı klasörde ara, sonra workspace'te ara
    const baseDir = path.dirname(document.uri.fsPath);
    const sameDir = vscode.Uri.file(path.resolve(baseDir, fileName));
    let target: vscode.Uri | undefined;
    try {
      await vscode.workspace.fs.stat(sameDir);
      target = sameDir;
    } catch {
      const found = await vscode.workspace.findFiles(`**/${fileName}`, null, 5);
      if (found.length > 0) {
        target = found[0];
      }
    }
    if (!target) {
      const create = await vscode.window.showInformationMessage(
        `"${fileName}" bulunamadı. Oluşturulsun mu?`,
        "Oluştur",
        "Vazgeç"
      );
      if (create !== "Oluştur") {
        return;
      }
      await vscode.workspace.fs.writeFile(sameDir, Buffer.from(`# ${p.target}\n`, "utf8"));
      target = sameDir;
    }
    await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
    if (p.anchor) {
      try {
        const td = await vscode.workspace.openTextDocument(target);
        const line = findHeadingLine(td.getText(), p.anchor);
        if (line >= 0) {
          await this.revealLine(target, line);
        }
      } catch {
        // başlık bulunamazsa dosyada kal
      }
    }
  }

  // Panodaki görseli assets/ altına kaydeder, göreli yolu döner (yazma yok)
  private async savePastedImage(
    document: vscode.TextDocument,
    dataUrl: string
  ): Promise<string | null> {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!m) {
      return null;
    }
    const mime = m[1].toLowerCase();
    const ext = mimeToExt(mime);
    if (!ext) {
      vscode.window.showWarningMessage(`Desteklenmeyen görsel türü: ${mime}`);
      return null;
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 15 * 1024 * 1024) {
      vscode.window.showWarningMessage("Görsel 15 MB'tan büyük, yapıştırılamadı.");
      return null;
    }
    const docDir = path.dirname(document.uri.fsPath);
    const assetsDir = vscode.Uri.file(path.join(docDir, "assets"));
    await vscode.workspace.fs.createDirectory(assetsDir);
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    let name = `yapistirilan-${stamp}.${ext}`;
    let target = vscode.Uri.file(path.join(assetsDir.fsPath, name));
    let i = 1;
    while (await this.existsUri(target)) {
      name = `yapistirilan-${stamp}-${i}.${ext}`;
      target = vscode.Uri.file(path.join(assetsDir.fsPath, name));
      i++;
    }
    await vscode.workspace.fs.writeFile(target, buf);
    return path.relative(docDir, target.fsPath).split(path.sep).join("/");
  }

  private async handlePasteImage(document: vscode.TextDocument, msg: any) {
    try {
      const rel = await this.savePastedImage(document, msg.dataUrl ?? "");
      if (!rel) {
        return;
      }
      const full = document.getText();
      const cursor = Math.max(0, Math.min(Number(msg.cursor) || 0, full.length));
      const snippet = `![görsel](${rel})`;
      const next = full.slice(0, cursor) + snippet + full.slice(cursor);
      await this.applyText(document, next);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Görsel yapıştırılamadı: ${err?.message ?? err}`);
    }
  }

  // Tek-yüzey canlı mod: dosyayı kaydeder, yolu geri yollar (ekleme webview'de)
  private async handleSaveImage(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    msg: any
  ) {
    try {
      const rel = await this.savePastedImage(document, msg.dataUrl ?? "");
      webviewPanel.webview.postMessage({
        proto: PROTO,
        type: "img-saved",
        nonce: msg.nonce ?? "",
        path: rel ?? "",
      });
    } catch (err: any) {
      webviewPanel.webview.postMessage({
        proto: PROTO,
        type: "img-saved",
        nonce: msg.nonce ?? "",
        path: "",
      });
      vscode.window.showErrorMessage(`Görsel yapıştırılamadı: ${err?.message ?? err}`);
    }
  }

  private async handleResolveImgs(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    paths: unknown
  ) {
    const map: Record<string, string> = {};
    if (!Array.isArray(paths)) {
      return;
    }
    const baseDir = path.dirname(document.uri.fsPath);
    for (const raw of paths.slice(0, 50)) {
      if (typeof raw !== "string") {
        continue;
      }
      if (/^(https?:|data:|blob:|vscode-|#)/i.test(raw) || raw.trim() === "") {
        continue;
      }
      try {
        const clean = decodeURIComponent(raw.split("#")[0].split("?")[0]);
        if (!clean) {
          continue;
        }
        const uri = vscode.Uri.file(path.resolve(baseDir, clean));
        await vscode.workspace.fs.stat(uri);
        map[raw] = webviewPanel.webview.asWebviewUri(uri).toString();
      } catch {
        // dosya yoksa eşleme dışı bırak
      }
    }
    webviewPanel.webview.postMessage({ proto: PROTO, type: "img-uris", map });
  }

  private async existsUri(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  // Belirli satıra kaydır (outline / wikilink# navigasyonu)
  async revealLine(uri: vscode.Uri, line: number): Promise<void> {
    for (let i = 0; i < 8; i++) {
      const panel = this.panels.get(uri.toString());
      if (panel) {
        panel.webview.postMessage({ proto: PROTO, type: "reveal-line", line });
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "webview", "main.js"))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "style.css"))
    );
    const nonce = getNonce();
    // KaTeX fontları: CSS içindeki göreli url() webview URI'sine çevrilir
    let katexStyle = "";
    try {
      const raw = fs.readFileSync(
        path.join(this.context.extensionPath, "media", "katex.css"),
        "utf8"
      );
      const fontsUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, "media", "fonts"))
      );
      katexStyle = `<style>\n${raw.replace(/url\(fonts\//g, `url(${fontsUri}/`)}\n</style>`;
    } catch {
      // katex.css yoksa sessiz geç (matematik yine de metin olarak görünür)
    }
    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; media-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline' https:; font-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}' ${webview.cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
${katexStyle}
<title>Karaca MD Editor</title>
</head>
<body>
${editorLayout}
<script nonce="${nonce}">
window.__karacaInitialMode = "live";
</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return crypto.randomBytes(24).toString("base64");
}

export function deactivate() {}

import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";

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
    })
  );
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

class KaracaMarkdownProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

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
        // Göreli görseller için md dosyasının klasörü
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        type: "update",
        text: document.getText(),
        isDirty: document.isDirty,
      });
    };

    const cfg = () => vscode.workspace.getConfiguration("karacaMd");
    const postConfig = () => {
      webviewPanel.webview.postMessage({
        type: "config",
        defaultMode: cfg().get<string>("defaultMode", "live"),
        wordWrap: cfg().get<boolean>("wordWrap", true),
        lineNumbers: cfg().get<boolean>("lineNumbers", true),
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("karacaMd")) {
        postConfig();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      configSub.dispose();
    });

    // Webview'den gelen mesajlar
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case "ready": {
          postConfig();
          updateWebview();
          break;
        }
        case "edit": {
          // Webview full-text gönderir. Döngüyü önlemek için aynılık kontrolü.
          const newText: string = msg.text ?? "";
          if (newText === document.getText()) {
            break;
          }
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, fullRange, newText);
          await vscode.workspace.applyEdit(edit);
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
        // Aynı dosya içi başlık — varsayılan preview gibi davran: bilgi ver
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
          await vscode.workspace.fs.writeFile(target, Buffer.from(`# ${cleaned}\n`, "utf8"));
          await vscode.commands.executeCommand("vscode.openWith", target, "karaca.mdEditor");
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Bağlantı açılamadı: ${err?.message ?? err}`);
    }
  }

  private async handleWikilink(document: vscode.TextDocument, name: string) {
    // [[Not Adı]] veya [[Not Adı|Görünen]] — wiki kısayolu
    const raw = name.split("|")[0].trim();
    if (!raw) {
      return;
    }
    const fileName = raw.endsWith(".md") ? raw : `${raw}.md`;
    // Önce aynı klasörde ara, sonra workspace'te ara
    const baseDir = path.dirname(document.uri.fsPath);
    const sameDir = vscode.Uri.file(path.resolve(baseDir, fileName));
    try {
      await vscode.workspace.fs.stat(sameDir);
      await vscode.commands.executeCommand("vscode.openWith", sameDir, "karaca.mdEditor");
      return;
    } catch {
      // devam et
    }
    const found = await vscode.workspace.findFiles(`**/${fileName}`, null, 5);
    if (found.length > 0) {
      await vscode.commands.executeCommand("vscode.openWith", found[0], "karaca.mdEditor");
      return;
    }
    const create = await vscode.window.showInformationMessage(
      `"${fileName}" bulunamadı. Oluşturulsun mu?`,
      "Oluştur",
      "Vazgeç"
    );
    if (create === "Oluştur") {
      await vscode.workspace.fs.writeFile(sameDir, Buffer.from(`# ${raw}\n`, "utf8"));
      await vscode.commands.executeCommand("vscode.openWith", sameDir, "karaca.mdEditor");
    }
  }

  private async handlePasteImage(document: vscode.TextDocument, msg: any) {
    try {
      const dataUrl: string = msg.dataUrl ?? "";
      const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!m) {
        return;
      }
      const mime = m[1].toLowerCase();
      const ext = mimeToExt(mime);
      if (!ext) {
        vscode.window.showWarningMessage(`Desteklenmeyen görsel türü: ${mime}`);
        return;
      }
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 15 * 1024 * 1024) {
        vscode.window.showWarningMessage("Görsel 15 MB'tan büyük, yapıştırılamadı.");
        return;
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
      const rel = path.relative(docDir, target.fsPath).split(path.sep).join("/");
      const full = document.getText();
      const cursor = Math.max(0, Math.min(Number(msg.cursor) || 0, full.length));
      const snippet = `![görsel](${rel})`;
      const next = full.slice(0, cursor) + snippet + full.slice(cursor);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(full.length)),
        next
      );
      await vscode.workspace.applyEdit(edit);
    } catch (err: any) {
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
    webviewPanel.webview.postMessage({ type: "img-uris", map });
  }

  private async existsUri(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "webview.js"))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "style.css"))
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; media-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline' https:; font-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
<title>Karaca MD Editor</title>
</head>
<body>
<div id="toolbar">
  <div class="seg" role="tablist" aria-label="Mod">
    <button id="btn-source" data-mode="source" title="Kaynak (ham markdown)">Kaynak</button>
    <button id="btn-live" data-mode="live" title="Canlı önizleme">Canlı</button>
    <button id="btn-split" data-mode="split" title="Split (kaynak + önizleme)">Split</button>
    <button id="btn-reading" data-mode="reading" title="Okuma (salt okunur önizleme)">Okuma</button>
  </div>
  <div class="spacer"></div>
  <span id="wordcount" title="Kelime / karakter sayısı"></span>
  <span id="dirty" title="Kaydedilmemiş değişiklik"></span>
</div>
<div id="formatbar" class="hidden">
  <button type="button" data-cmd="undo" title="Geri al">↺</button>
  <button type="button" data-cmd="redo" title="Yinele">↻</button>
  <span class="fsep"></span>
  <button type="button" data-cmd="bold" title="Kalın"><b>B</b></button>
  <button type="button" data-cmd="italic" title="İtalik"><i>I</i></button>
  <button type="button" data-cmd="strike" title="Üstü çizili"><s>S</s></button>
  <button type="button" data-cmd="heading" title="Başlık">H</button>
  <span class="fsep"></span>
  <button type="button" data-cmd="bullet" title="Madde listesi">•</button>
  <button type="button" data-cmd="numbered" title="Numaralı liste">1.</button>
  <button type="button" data-cmd="task" title="Görev listesi">☐</button>
  <button type="button" data-cmd="quote" title="Alıntı">❝</button>
  <button type="button" data-cmd="code" title="Kod">‹›</button>
  <span class="fsep"></span>
  <button type="button" data-cmd="table" title="Tablo ekle">▦</button>
  <button type="button" data-cmd="link" title="Bağlantı ekle">Link</button>
  <button type="button" data-cmd="image" title="Görsel ekle">Görsel</button>
</div>
<div id="findbar" class="hidden">
  <input id="find-input" type="text" placeholder="Bul…" aria-label="Bul" />
  <span id="find-count"></span>
  <button type="button" data-ffind="prev" title="Önceki">↑</button>
  <button type="button" data-ffind="next" title="Sonraki">↓</button>
  <button type="button" data-ffind="close" title="Kapat">✕</button>
</div>
<div id="main-row">
<div id="source-wrap" class="hidden"><div id="cm-host"></div></div>
<div id="split-preview" class="hidden"><div id="split-root" class="md-body"></div></div>
</div>
<div id="live-wrap" class="hidden"><div id="live-root" class="md-body"></div></div>
<div id="reading-wrap" class="hidden"><div id="reading-root" class="md-body"></div><div id="back-to-live">Canlı düzenlemeye dönmek için çift tıklayın</div></div>
<script nonce="${nonce}">
window.__karacaInitialMode = "live";
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function mimeToExt(mime: string): string | undefined {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return undefined;
  }
}

function getNonce(): string {
  return crypto.randomBytes(24).toString("base64");
}

export function deactivate() {}

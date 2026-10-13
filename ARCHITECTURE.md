# Karaca MD Editor — Mimari

Tek sekmede markdown düzenleme + görüntüleme yapan VS Code eklentisi.
`CustomTextEditorProvider` + tek webview; 4 mod: **Kaynak** (`Ctrl+1`) /
**Canlı** (`Ctrl+2`) / **Split** (`Ctrl+3`) / **Okuma** (`Ctrl+4`).

## Dosya haritası

| Dosya | Rol |
|---|---|
| `src/extension.ts` | Extension host: provider kaydı, doküman senkronu, link/wikilink çözümleme, görsel kaydı, webview HTML iskeleti |
| `src/webview/main.ts` | Webview uygulaması: blok modeli, 4 mod, CodeMirror, bulma/biçim çubukları, undo, görseller |
| `src/types.d.ts` | `markdown-it-task-lists` + `*.css` (esbuild `css:text`) tip bildirimleri |
| `media/style.css` | Webview stilleri (VS Code tema değişkenleriyle) |
| `media/webview.js` | Derleme çıktısı (esbuild IIFE, ~1.7 MB: CodeMirror 6 + markdown-it + highlight.js) |
| `esbuild.js` | Çift derleme: `src/extension.ts` → `dist/` (node), `src/webview/main.ts` → `media/` (browser) |
| `sample.md`, `deneme.md` | Deneme dosyaları |

## Extension host (`src/extension.ts`)

- `karaca.mdEditor` viewType ile `registerCustomEditorProvider`. `*.md` için
  `priority: default` olduğundan `.md` dosyaları varsayılan olarak bununla açılır.
- `webviewOptions: { retainContextWhenHidden: false }` — **bilerek kapalı**.
  Açıkken sekme kapatılıp aynı pencerede yeniden açılınca VS Code'un service
  worker kaydının `InvalidStateError` ile patladığı gözlendi. State zaten
  `TextDocument` üzerinden senkronize edildiği için context tutmaya gerek yok.
- Webview `html`: nonce'lu CSP (`script-src 'nonce-…'`; satır-içi script ve
  `onclick=` tarzı handler'lar çalışamaz), `enableScripts: true`,
  `localResourceRoots`: `media/`, `dist/` ve **md dosyasının klasörü**
  (göreli görseller için).
- `onDidChangeTextDocument` → webview'e `update` gönderir. Webview'den gelen
  `edit` tam-metin ise `WorkspaceEdit.replace` ile dokümana yazılır
  (eşitlik kontrolüyle yankı döngüsü engellenir).
- `onDidDispose`: `changeSub` + `configSub` dispose edilir (panel başına başka
  subscription yok).
- Komutlar: `karaca-md.openLive` (aktif md'yi editörle açar),
  `karaca-md.showSource` (komut paletinde; başlık butonu kaldırıldı).
- Ayarlar (`karacaMd.*`): `defaultMode` (`live|source|split|reading`),
  `wordWrap`, `lineNumbers`. Değişiklik `postConfig` ile webview'e itilir.
- `handleLink`: `http(s)/mailto` → `openExternal`; `#` → yoksay; göreli yol →
  varsa `vscode.openWith` ile aç, yoksa oluşturmayı teklif et.
- `handleWikilink` (`[[Ad]]`, `[[Ad|Etiket]]`): önce aynı klasör, sonra
  `findFiles("**/Ad.md")`, yoksa oluşturma teklifi.
- `handlePasteImage`: `data:image/…;base64` doğrular (png/jpg/gif/webp/bmp/svg,
  ≤15 MB) → md klasöründeki `assets/` altına `yapistirilan-<stamp>.png` yazar
  (çakışmada sayaç artar) → imleç offset'ine `![](assets/…)` ekler.
  Offset webview'den gelir, doküman boyuna kelepçelenir.
- `handleResolveImgs`: göreli `src` listesini `asWebviewUri` ile eşleyip
  `img-uris` olarak döner (en fazla 50 yol; olmayan dosya eşleme dışı kalır).

## Webview (`src/webview/main.ts`)

### Blok modeli (Canlı modun kalbi)

- `computeBlocks(text)`: `markdown-it` token'larının `map` (satır aralığı) bilgisiyle
  üst-seviye blokları çıkarır `[startLine, endLine)`. Token üretmeyen boş satırlar
  "gap" blok olur (boşsa ince tıklanabilir boşluk).
- Her blok `{ startLine, endLine, source, html }` tutar; render'lı görünür, tıklanan
  blok ham markdown `textarea`'ya dönüşür (seamless: kutusuz, akan fontta; kod
  bloğunda mono). `Esc` / `Ctrl+Enter` / başka bloğa tık / 150 ms gecikmeli blur
  ile commit → tam re-render.
- **Satır haritası kaydırma (delta-shift):** `replaceBlockSource` her yazımda
  bloğun ve sonrakilerin `startLine/endLine` değerlerini günceller. Yoksa Enter/
  silme sonrası sınırlar kayar ve içerik bozulur (yaşandı, düzeltildi).
- **Tıklama vs sürükleme:** blok `click` önce seçime bakar; sürükleme varsa
  (non-collapsed) edit açılmaz — seçim kalır. `Delete/Backspace` (document
  seviyesinde dinlenir; odak `body`'deyken `liveRoot` dinleyicisine olay
  ulaşmazdı) seçimi tamamen kapsadığı blokları siler. Tek blokta kısmi seçimde
  varsayılan davranış (hiçbir şey) korunur.
- **Ölçüm DOM'dan sonra:** `autoGrow` + focus + caret, `requestAnimationFrame`
  içinde yapılır (eklenmeden ölçülen `scrollHeight` 0 çıkar, kutu minik kalırdı).
  Açılışta sondaki `\n`'lar kırpılır ki imleç yeni satıra düşmesin; imleç metin
  sonunda başlar, blok `scrollIntoView({block:"nearest"})` ile görünür alana alınır.

### Kaynak modu (CodeMirror 6)

- `lineNumbers`, `history`, `highlightActiveLine`, `defaultKeymap`,
  `markdown()`, `search({top:true})` + `searchKeymap` (`Ctrl+F` paneli) +
  `highlightSelectionMatches()` + `domEventHandlers(paste)` (görsel yakalar).
- Üç `Compartment`: tema (koyu/açık, `MutationObserver` ile anlık),
  `lineWrapping`, `lineNumbers` — hepsi ayar değişince yeniden yapılandırılır,
  editör baştan kurulmaz.
- `updateListener`: kullanıcı yazımı → `currentText` + `sendEdit` + `recordHist`
  + ertelenmiş önizleme tazeleme. `syncCodeMirrorFromText` dış yankıları yazar;
  kullanıcı yazarken (odak CM'de, Kaynak/Split) atlanır — atlanmazsa tam-metin
  replace imleci/kaydırmayı sıfırlar (yaşandı, düzeltildi).

### Önizleme (Okuma + Split)

- `renderPreviewInto(root)`: `markdown-it` (GFM task-list, `highlight.js`,
  wikilink ön-işleme) + checkbox/link/images kablolama. Okuma ve Split aynı
  fonksiyonu farklı köklerle kullanır; checkbox sıraya göre dosyaya geri yazar.
- Split: `#main-row` içinde kaynak (%50) + önizleme (%50); çift yönlü
  **oran tabanlı** senkron kaydırma (`syncingScroll` muhafızıyla döngü engellenir).
  Yeniden çizimde kaydırma oranı korunur (`renderSplit`).
- Kod renkleri: `highlight.js` span'ları + gömülü tema CSS'i
  (koyu: `vs2015`, açık: `vs`; tema değişince `<style>` içeriği değişir).
- Göreli görseller `resolve-imgs`/`img-uris` turuyla `webviewUri`'ye çevrilir,
  sonuç `imgUriCache`'de tutulur. `../` ile klasör dışına çıkanlar güvenlik
  gereği yüklenemez.

### Bulma çubuğu (Canlı/Okuma/Split)

- `Ctrl+F` (CodeMirror'un ele almadığı durumda): Aa / tüm sözcük / regex
  düğmeli, sayaçlı (`3 / 12`), `Enter`/`Shift+Enter` gezinmeli, `≡` ile
  Değiştir/Tümü satırlı çubuk. Hatalı regex "hatalı ifade" gösterir, çökmez.
- Vurgu: metin düğümlerine `<mark class="find-hit">` sarılır (checkbox/link
  dinleyicileri etkilenmez; `textarea` içeriği DOM metni değildir, karışmaz).
  Her render sonrası açıksa yeniden kurulur.
- Değiştir/Tümü **kaynak metin** üzerinde çalışır (`$1` desenleri desteklenir),
  `recordHist(true)` + `applyHistText` ile geri alınabilir. Önizlemedeki sayaç
  ile kaynak eşleşme sırası düz sözcüklerde aynıdır; sentaks karakterli
  sorgularda (`**`, `#`) sapma olabilir.

### Biçim çubuğu

- Kaynak/Canlı/Split'te aktif; Okuma'da gizli. Hedef: odaktaki CodeMirror
  seçimi ya da açık blok `textarea`'sı (Canlı'da blok seçili değilse pasif).
- Düğmeye `mousedown`'da `preventDefault`: odak çalınmaz, açık blok kapanmaz,
  komut hedefsiz kalmaz. Blur dinleyicisinde `relatedTarget` koruması da var.
- Komutlar: kalın/italik/üstü çizili/başlık (aç-kapa), madde/numaralı/görev/
  alıntı (satır öneki aç-kapa), kod (tek satır `` ` `` / çok satır fence),
  tablo şablonu, bağlantı/görsel (yer tutucu seçili gelir).

### Geri al / yinele

- Webview içi snapshot zinciri (`hist`, en fazla 100): yazımda 2.5 sn
  kısıtlamalı, biçim/checkbox/değiştir işlemlerinde zorunlu kayıt (önceki durum).
- `doUndo`: kaydedilmemiş yazım varsa önce anlık durumu iter, sonra bir geri
  gider; `applyHistText` metni yazar + ilgili modu tazeler. Dış yankılar zincire
  girmez (ilk dış metin taban kabul edilir).

## Senkron protokolü

| Yön | `type` | İçerik |
|---|---|---|
| ext → web | `update` | `{ text, isDirty }` (her doküman değişiminde) |
| ext → web | `config` | `{ defaultMode, wordWrap, lineNumbers }` |
| ext → web | `img-uris` | `{ map: {src: webviewUri} }` |
| web → ext | `ready` | açılış el sıkışması |
| web → ext | `edit` | tam metin (250 ms debounce'lu) |
| web → ext | `open-link` / `open-wikilink` | `{ href }` / `{ name }` |
| web → ext | `paste-image` | `{ dataUrl, cursor }` |
| web → ext | `resolve-imgs` | `{ paths[] }` |
| web → ext | `error` | `{ message }` (kullanıcıya gösterilir) |

Kurallar: tam-metin eşitse yazma/yankı atlanır; düzenlerken gelen dış `update`
Canlı'da render'ı erteler (blur'da toparlanır); yapıştırma sonrası `pendingPaste`
edit kutusunu kapatıp tazeler.

## Kritik değişmezler (bir daha dokunurken oku)

1. `retainContextWhenHidden` **kapalı kalacak** (gerekçe yukarıda).
2. Ölçüm (`scrollHeight`) her zaman layout sonrasına (`rAF`) konur.
3. Klavye dinleyicileri hedef kitleye göre ayrılır: blok-içi (textarea/CM),
   önizleme (document), global (mod kısayolları). Odak çalan düğmelerde
   `mousedown.preventDefault()`.
4. `blocks[]` satır haritası her mutasyonda kaydırılır; index tabanlı erişim
   sadece edit oturumu içinde güvenilirdir.
5. Service worker `InvalidStateError`, VS Code platformunun kendi bootstrap
   hatasıdır (microsoft/vscode#330595 vb.); eklenti kodu o aşamada çalışmaz.
   Karşı önlem: pencere başına tek örnek, önbellek temizliği, sekmeyi kapatıp
   yeniden açma.

## Derleme / paketleme / yayınlama

```powershell
npm install
npm run lint        # tsc --noEmit, temiz olmalı
npm run compile     # esbuild: dist/ + media/webview.js
npx @vscode/vsce package --no-dependencies
code --install-extension karaca-md-editor-0.1.0.vsix
```

- `package.json` (`karaca.mdEditor`, komutlar, `karacaMd.*` ayarlar) + `LICENSE.txt`
  yayına dahildir; `dist/`, `node_modules/`, `*.vsix`, `assets/` `.gitignore`'dadır.
- Sürüm artırımı `package.json` `version` alanından yapılır.

## Güvenlik notları

- CSP: `script-src` yalnızca nonce'lu scriptler; markdown içindeki ham HTML'in
  script/handler çalıştırması engellenir.
- `localResourceRoots`: eklenti klasörleri + md dosyasının klasörüyle sınırlı.
- Yapıştırılan görseller: MIME beyaz listesi + 15 MB tavan + `assets/` altına
  yazma; dosya adı zaman damgalı ve ASCII.
- Dış bağlantılar `env.openExternal`'dan geçer. Bağımlılıklar denetimli
  (`npm audit`: 0 zafiyet).

## Bilinen sınırlamalar

- Önizlemede bulma-değiştirme sayaç sırası ile kaynak sırası sentaks
  karakterli sorgularda sapabilir.
- `../` ile klasör dışına çıkan göreli görseller yüklenemez.
- Yapıştırma/geri alma sonrası imleç konumu korunmaz.
- Matematik (KaTeX) ve Mermaid yok (bkz. `TODO.md`).

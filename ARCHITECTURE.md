# Karaca MD Editor — Mimari

Tek sekmede markdown düzenleme + görüntüleme yapan VS Code eklentisi.
`CustomTextEditorProvider` + tek webview; 4 mod: **Kaynak** /
**Canlı** / **Split** / **Okuma** (üstteki sekmelerden değişir; klavye
kısayolu bilerek yok — VS Code grup kısayollarıyla çakışmaması için).

## Dosya haritası

| Dosya | Rol |
|---|---|
| `src/extension.ts` | Extension host: provider kaydı, doküman senkronu, link/wikilink çözümleme, görsel kaydı, webview HTML iskeleti |
| `src/webview/main.ts` | Webview uygulaması: blok modeli, 4 mod, CodeMirror, bulma/biçim çubukları, undo, görseller |
| `src/types.d.ts` | `markdown-it-task-lists` + `*.css` (esbuild `css:text`) tip bildirimleri |
| `media/style.css` | Webview stilleri (VS Code tema değişkenleriyle) |
| `media/webview.js` | Derleme çıktısı (esbuild IIFE, ~1.7 MB: CodeMirror 6 + markdown-it + highlight.js) |
| `esbuild.js` | Çift derleme: `src/extension.ts` → `dist/` (node), `src/webview/main.ts` → `media/` (browser) |
| `src/shared/md-utils.ts` | Saf yardımcılar (test edilebilir, DOM/vscode bağımsız) |
| `test/md-utils.test.ts` | Birim testler (`npm test`) |
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

Tüm mesajlarda `proto: 1` alanı vardır; iki taraf da bilmediği sürümü yoksayar.

| Yön | `type` | İçerik |
|---|---|---|
| ext → web | `update` | `{ text, isDirty }` (her doküman değişiminde) |
| ext → web | `config` | `{ defaultMode, wordWrap, lineNumbers }` |
| ext → web | `img-uris` | `{ map: {src: webviewUri} }` |
| ext → web | `reveal-line` | `{ line }` (satıra kaydır + vurgula) |
| web → ext | `ready` | açılış el sıkışması |
| web → ext | `edit` | tam metin (250 ms debounce'lu) |
| web → ext | `open-link` / `open-wikilink` | `{ href }` / `{ name }` (`name`: `Not#Başlık|Etiket` ham hali) |
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
   önizleme (document), global (bulma). **Textarea'da `stopPropagation` YOKTUR**
   (geçmiş ders: odağı çalıp bloklar-arası silmeyi ve tuşları öldürüyordu).
   Odak çalmaması gereken düğmelerde `mousedown.preventDefault()`.
4. `blocks[]` satır haritası her mutasyonda kaydırılır; index tabanlı erişim
   sadece edit oturumu içinde güvenilirdir.
5. Service worker `InvalidStateError`, VS Code platformunun kendi bootstrap
   hatasıdır (microsoft/vscode#330595 vb.); eklenti kodu o aşamada çalışmaz.
   Karşı önlem: pencere başına tek örnek, önbellek temizliği, sekmeyi kapatıp
   yeniden açma.

## V2 ekleri
- **`src/shared/md-utils.ts`**: saf yardımcılar (bulma regex'i, satır aç-kapa,
  tablo işlemleri, frontmatter, wikilink/başlık çözümleme, mime). `npm test`
  (`node --test`, sıfır bağımlılık, 27 test) ile doğrulanır.
- **Matematik**: `markdown-it-texmath` + `katex` (`$`/`$$`). Fontlar derlemede
  `media/fonts/` altına kopyalanır, CSS'teki `url(fonts/…)` extension tarafında
  webview URI'sine çevrilip `<style>` olarak gömülür.
- **Mermaid**: fence kuralı `div.mermaid[data-source]` üretir, `runMermaid`
  çizer (`securityLevel: strict`); tema değişince kaynaklar geri yüklenip
  yeniden çizilir.
- **Ön madde**: `parseFrontmatter` ile ilk blok olur (canlı) veya tam render'ın
  başına tablo olarak eklenir (okuma/split); düzenleme ham kaynaktan yapılır.
- **Tablo**: `editTable` (satır/sütun ekle-sil); canlı blok üstü mini çubuk +
  biçim çubuğu düğmeleri (Kaynak modda imleç çevresindeki tablo bulunur).
- **Paneller**: Gezgin'de `karacaOutline` (iç içe başlık ağacı, tıkla →
  `karaca-md.reveal` → `revealLine` → webview'de kaydır+vurgu) ve
  `karacaBacklinks` (`[[Ad]]` / `](ad.md)` taraması, max 500 dosya, 1 sn
  debounce). Komutlar: `karaca-md.newNote`, `karaca-md.dailyNote`.
- **Artımlı render**: 400+ blokta DOM parçalar halinde (`rAF`, 150'şerli)
  eklenir; `renderId` ile eski tur iptal edilir.
- **Derleme notları**: `fs.cpSync` bu makinede natif çöküyor — yerine tek-tek
  kopya (`copyDirSync`). Dev webview derlemesinde sourcemap kapalı (19 MB map
  esbuild'i çökertüyordu); iki parça ayrı process'te derlenir (`--only=`).

## Hata günlüğünden kurallar (yaşandı, tekrar yasak)

Süreç kuralları (araç zinciri):

1. **Derlemeden test koşma.** E2E koşumu `media/webview.js` paketini çalıştırır;
   `npm test` paketi yenilemez. Sıra her zaman: `lint` → `compile` → `test`.
2. **Her turda `npm run lint`.** esbuild typecheck yapmaz; paket sessizce
   `ReferenceError`'lı kodla derlenir. Test+derleme yeşili lint olmadan hükümsüzdür.
3. **Çıktıyı budayarak okuma.** `Select-Object -Last N` hata satırlarını gizler;
   kritik komutlarda tam çıktı + `$LASTEXITCODE` kontrol edilir.
4. **Yorum-satır kaynaması.** Edit sonrası `//` ile başlayan satırın arkasına kod
   yapışmadığını gözle doğrula (yaşandı: `anchorEl` tanımsız kaldı).
5. **Yalancı geçen test yazma.** Mutasyon testlerinde paylaşılan durumu sıfırla
   (`posted.length = 0`, taze DOM sorgusu); bayat veriyle geçen assertion
   yasaktır. Şüpheli durumda ara durumlar loglanır, sonra temizlenir.
6. **Paket listesini gözden geçir.** Her sürümde vsix içeriği kontrol edilir
   (test/scratch/map/assets sızmasın); `.vscodeignore` güncel tutulur.

Kod kuralları (webview):

7. **Odak çalma yok.** Textarea'da `stopPropagation` yasaktır; document
   dinleyicilerini (bloklar-arası silme, bulma) öldürür. Odak korunacaksa
   düğmelerde `mousedown.preventDefault()` kullanılır.
8. **Ölçüm layout sonrasına.** `scrollHeight` yalnızca DOM'a eklenip bir kare
   geçtikten sonra (`rAF`) okunur; erken ölçüm 0 çıkar, kutu minik kalır.
9. **Bayat DOM düğümüyle işlem yok.** Yeniden render sonrası eski düğüm
   referansları (seçim aralığı dahil) geçersizdir; tıklama/seçim sonrası yeniden
   sorgulanır.
10. **CSS özgüllüğü.** Genel kural (`#formatbar button` gibi) eklenirken kapsamlı
    seçici kullanılır (`button[data-cmd]`); yoksa ID seçici `.seg .active`
    gibi durum stillerini ezer ve sekme vurgusu kaybolur.
11. **Odak/blur yarışları menüyle birlikte test edilir.**
    Menü öğesi odağı çalıp editi erken kapatmamalı (önce işlem, sonra kapat);
    blur korumaları menü açıkken devrede kalır.
12. **Sessiz ölüm yok.** Seçim/silme/kopya yollarında "hiçbir şey olmaması"
    kabul edilmez: tam kapsama yoksa kısmi seçim çapa bloğu düzenlemeye açar;
    yakalanan istisnalar (özellikle kısmi-eşleşme dallarında) en azından
    görünür bir davranış üretir.
13. **Satır haritası her mutasyonda kaydırılır** (Enter/silme sonrası blok
    sınırları; `delta-shift`).
14. **Yapısal işlemlerde ayraç korunur** (toplu silmede komşu paragraflar
    bitişmez; tablo/liste/başlık/kod satırlarına dokunulmaz).

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
- Canlı modda geri alma sonrası kutu kapanır (imleç Kaynak/Split modda korunur).

## Faz 1-3 uyarlama notları (referans tekniklerin bizdeki karşılığı)

- **İmleç çapası:** Referanstaki `wbr` düğümü bizde gerekmedi — textarea modeli
  imleci doğal korur. Karşılığı: `syncCodeMirrorFromText` seçim-kelepçeleme +
  undo anlık görüntülerinde doküman offset çapası (`HistEntry.anchor`) +
  ~2MB geçmiş tavanı. Ayrı diff kütüphanesi bu ölçekte gereksiz bulundu.
- **Kopyada başlık onarımı:** Tek başlık bloğunda kısmi seçim panoya işaretlerle
  gider (`## ` + seçili metin); çok blokta kaynak birleşimi zaten vardı.
- **Liste Enter:** `listEnterAction` (devam / çık / girinti-azalt, numara artar,
  görev kutusu boşalır) hem canlı kutuda hem Kaynak modda (CM tuş eşleme) çalışır.
- **Komşu birleştirme:** Metin-tabanlı modelde gerekmedi — bloklar her renderda
  metinden yeniden türetildiği için liste kendiliğinden bütün kalır.
- **Popover:** Bağlantı/Görsel düğmeleri alan doldurmalı iletişim kutusu açar
  (metin+adres, açıklama+yol); seçim dondurulup onayda geri kurulur.

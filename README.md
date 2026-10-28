# Karaca MD Editor

A continuous WYSIWYG Markdown editor for VS Code, by **berkantkaraca**.
Edit formatted text in Live mode, use Source or Split for Markdown, and switch to
Reading for a clean preview. Currently supported on Windows.

The editor opens in **English** by default. Choose **Türkçe** from the language
selector in the toolbar, or set `"karacaMd.language": "tr"` in VS Code settings.
The choice is saved globally and takes effect without reloading the document.
VS Code command and settings descriptions use VS Code's display language through
the bundled English and Turkish localization files.

Extension ID: `berkantkaraca.karaca-md-editor`. Previous local draft backups are
copied from the old publisher's storage on first activation; the originals remain.

## Türkçe

VS Code içinde Word benzeri tek yüzeyli WYSIWYG Markdown editörü.
Paragraflar ve başlıklar aynı belge üzerinde düzenlenir; tıklayınca ayrı blok
editörü veya ham Markdown kutusu açılmaz. Canlı düzenleme Tiptap/ProseMirror'a dayanır.
Canlı ve Okuma aynı çerçevesiz görünümü, metin ölçülerini ve görev listesi düzenini kullanır.

| Mod | Kullanım |
| --- | --- |
| Canlı | Biçimli belge üzerinde yazma, seçim ve düzenleme |
| Kaynak | CodeMirror ile Markdown kaynağı |
| Split | Kaynak ve önizleme yan yana |
| Okuma | Salt okunur belge |

Biçim çubuğu kalın, italik, üstü çizili, altı başlık seviyesi, listeler, görevler,
alıntı, kod, tablo, bağlantı ve görsel eklemeyi destekler. Liste, tablo ve seçim
işlemleri belge modeli üzerinde çalışır. Boş belgeye doğrudan yazılabilir.

- Ctrl/Cmd+B, Ctrl/Cmd+I: kalın ve italik yazım.
- Ctrl/Cmd+Z: geri al; Ctrl/Cmd+Shift+Z veya Ctrl+Y: yinele.
- Ctrl/Cmd+F: bul; canlı modda değiştir işlemleri biçim işaretlerini korur.
- Ctrl/Cmd+S: bekleyen belge değişikliklerini işleyip dosyayı kaydet.
- Başlığın sonunda Enter: normal paragraf; listede Enter: yeni madde.
- Listede Tab/Shift+Tab: girinti; boş maddede Enter: listeden çık.
- Canlıda Ctrl/Cmd+tık: bağlantıyı aç.

Panodan görseller dosyanın yanındaki assets klasörüne kaydedilir. WikiLink,
içindekiler, geri bağlantılar, hızlı not ve günlük not komutları kullanılabilir.
Matematik ve Mermaid araç çubuğundan eklenebilir; Canlı modda çift tıklayarak
kaynaklarını önizlemeli pencerede düzenleyebilirsin. YAML ön madde Kaynak modunda düzenlenir. Dış dosya değişikliğiyle çakışan yerel taslak kurtarma düğmesinde tutulur.

## Geliştirme ve deneme

```powershell
npm install
npm run lint
npm run compile
npm test
npm run test:browser
```

VS Code'da F5 ile Extension Development Host açın; `sample.md` dosyasını açarak
deneyin. Araç çubuğunda **paket-13** görünmelidir. Kurulu eski eklentiyi kullanıyorsanız
Extension Development Host içindeki sürümü açtığınızdan emin olun.

Tarayıcı testleri Windows'ta Chrome/Edge'i bulur. Başka bir kurulum için
`CHROME_PATH` kullanın veya `npx playwright install chromium` çalıştırın.
Test ekran görüntüsü `out/editor-paket-13.png` dosyasına yazılır.

Ayarlar: `karacaMd.defaultMode` (`live`, `source`, `split`, `reading`),
`karacaMd.wordWrap`, `karacaMd.lineNumbers`.

Canlı düzenleme değişen kaynak bölümünün Markdown yazımını normalize edebilir.
Diğer bölümlerin yazımı, boşlukları ve referans tanımları korunur. Değiştirilmeyen
belge yalnızca odak veya mod değişti diye yeniden yazılmaz. Desteklenmeyen ham
HTML/Markdown uzantıları içeren belgeleri Kaynak modunda düzenleyin. Ayrıntılar
`ARCHITECTURE.md` içindedir.

Enter ile eklenen boş paragraflar, kaydetme ve yeniden açma sırasında korunmak için
Markdown kaynağında `<p></p>` olarak saklanır.

Şimdilik desteklenen platform Windows'tur. Kayıt yanıtı gelmezse aynı işlem güvenli
şekilde tekrar denenir; sorun sürerse üst çubuktan yeniden deneyebilirsin. Kaydedilmemiş
taslaklar VS Code global storage alanında belgeye özel yerel yedekte saklanır. Yeniden
açılışta **Taslağı geri yükle** veya **Taslağı sil** seçilebilir. Yedek yazımı asenkrondur;
elektrik kesintisinden hemen önceki son tuşun diske ulaşması garanti edilmez.

## Ek doğrulama

```powershell
npx playwright install chromium firefox webkit
npm run test:cross-browser
npm run test:extension-host
npm run test:performance
```

Extension Host testi ayrı bir profil ve `out/extension-host/roundtrip.md` kullanır;
açık çalışma belgelerini değiştirmez. `VSCODE_EXECUTABLE` ile VS Code yürütülebilir
dosyası belirtilebilir. İşletim sistemi doğrulama durumu TODO.md, ölçümler PERFORMANCE.md içindedir.

Tablo düğmesinde 8×6 ızgaradan boyut seçebilir veya 20 sütun / 50 satıra kadar özel boyut girebilirsin. İlk satır başlıktır. Tablo içindeyken aynı düğme satır ve sütun işlemlerini açar. Ok tuşlarıyla boyut seçip Enter ile ekleyebilir, Escape ile vazgeçebilirsin.

# Karaca MD Editor

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
Matematik, Mermaid ve YAML ön madde görüntülenir; kaynakları Kaynak modunda
düzenlenir. Dış dosya değişikliğiyle çakışan yerel taslak kurtarma düğmesinde tutulur.

## Geliştirme ve deneme

```powershell
npm install
npm run lint
npm run compile
npm test
npm run test:browser
```

VS Code'da F5 ile Extension Development Host açın; `sample.md` dosyasını açarak
deneyin. Araç çubuğunda **paket-8** görünmelidir. Kurulu eski eklentiyi kullanıyorsanız
Extension Development Host içindeki sürümü açtığınızdan emin olun.

Tarayıcı testleri Windows'ta Chrome/Edge'i bulur. Başka bir kurulum için
`CHROME_PATH` kullanın veya `npx playwright install chromium` çalıştırın.
Test ekran görüntüsü `out/editor-paket-8.png` dosyasına yazılır.

Ayarlar: `karacaMd.defaultMode` (`live`, `source`, `split`, `reading`),
`karacaMd.wordWrap`, `karacaMd.lineNumbers`.

Canlı düzenleme eşdeğer Markdown yazımını normalize edebilir. Değiştirilmeyen
belge yalnızca odak veya mod değişti diye yeniden yazılmaz. Desteklenmeyen ham
HTML/Markdown uzantıları içeren belgeleri Kaynak modunda düzenleyin. Ayrıntılar
`ARCHITECTURE.md` içindedir.

Enter ile eklenen boş paragraflar, kaydetme ve yeniden açma sırasında korunmak için
Markdown kaynağında `<p></p>` olarak saklanır.

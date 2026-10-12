# Karaca MD Editor (Tek Sekme)

VS Code'da **tek dosyada markdown düzenleme + görüntüleme**.

Artık `Markdown: Open Preview` + split zahmeti yok. Tek sekmede 3 mod:

| Mod | Kısayol | Davranış |
|-----|---------|----------|
| **Kaynak** | `Ctrl+1` | Ham markdown (CodeMirror, satır no, word-wrap) |
| **Canlı** (varsayılan) | `Ctrl+2` | Canlı önizleme: bloklar render'lı, tıkladığın blok ham markdown'a dönüşür, `Esc`/`Ctrl+Enter` ile render'a döner |
| **Okuma** | `Ctrl+3` | Salt okunur önizleme, çift tıkla Canlı'ya dön |

Ekstralar:
- Görev listeleri (`- [ ]`) hem Canlı hem Okuma modunda **tıklanabilir** — dosyaya geri yazılır.
- `[[WikiLink]]` desteği: tıkla → aynı klasörde / workspace'te ara, yoksa oluşturmayı teklif et.
- Göreli dosya linkleri (ör. `y.md` dosyasına verilen bağlantı) aynı şekilde açılır/oluşturulur.
- Kod blokları VS Code temasına uygun renkli vurgulanır (koyu/açık otomatik).
- Panodan görsel yapıştırma (`Ctrl+V`): md dosyasının yanındaki `assets/` klasörüne kaydedilir, imlece `![](...)` eklenir.
- Göreli görseller (`assets/x.png` gibi) önizlemede doğrudan gösterilir.
- Üstteki biçim çubuğu (Kaynak ve Canlı modda): geri al/yinele, kalın/italik/üstü çizili/başlık, liste/alıntı/kod, tablo/bağlantı/görsel ekleme.

## Çalıştırma (geliştirme)

```powershell
npm install
npm run compile
# sonra F5 ile Extension Development Host aç, bir .md dosyası aç
```

`.md` dosyaları varsayılan olarak bu editörle açılır. İstemiyorsan sekmeye sağ tık → `Reopen Editor With... → Text Editor`, veya komut paletinden:

- `Karaca MD: Canlı Editörde Aç`
- `Karaca MD: Varsayılan Metin Editörüyle Aç`

## Ayarlar

- `karacaMd.defaultMode`: `live` | `source` | `reading` (varsayılan `live`)
- `karacaMd.wordWrap`: kaynak editörde satır kaydırma (varsayılan `true`)

## Bilinen sınırlamalar (V2 yol haritası)

- Göreli görseller md klasörünün dışına (`../` ile üst klasöre) taşarsa gösterilmez.
- Matematik (KaTeX) ve Mermaid diyagramları henüz yok.
- CodeMirror teması statik (açılıştaki temaya göre); dinamik tema takibi V2'de.

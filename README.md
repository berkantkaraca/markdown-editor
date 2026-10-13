# Karaca MD Editor (Tek Sekme)

VS Code'da **tek dosyada markdown düzenleme + görüntüleme**.

Artık `Markdown: Open Preview` + split zahmeti yok. Tek sekmede 3 mod:

| Mod | Davranış |
|-----|----------|
| **Kaynak** | Ham markdown (CodeMirror, satır no, word-wrap) |
| **Canlı** (varsayılan) | Canlı önizleme: bloklar render'lı, tıkladığın blok ham markdown'a dönüşür, `Esc`/`Ctrl+Enter` ile render'a döner |
| **Split** | Kaynak solda + önizleme sağda, senkron kaydırmalı |
| **Okuma** | Salt okunur önizleme, çift tıkla Canlı'ya dön |

Modlar üstteki sekmelerden değişir.

Ekstralar:
- Görev listeleri (`- [ ]`) hem Canlı hem Okuma modunda **tıklanabilir** — dosyaya geri yazılır.
- `[[WikiLink]]` desteği: tıkla → aynı klasörde / workspace'te ara, yoksa oluşturmayı teklif et.
- Göreli dosya linkleri (ör. `y.md` dosyasına verilen bağlantı) aynı şekilde açılır/oluşturulur.
- Kod blokları VS Code temasına uygun renkli vurgulanır (koyu/açık otomatik).
- Panodan görsel yapıştırma (`Ctrl+V`): md dosyasının yanındaki `assets/` klasörüne kaydedilir, imlece `![](...)` eklenir.
- Göreli görseller (`assets/x.png` gibi) önizlemede doğrudan gösterilir.
- Üstteki biçim çubuğu (Kaynak, Canlı ve Split modda): geri al/yinele, kalın/italik/üstü çizili, başlık seviyeleri (H ▾), liste/alıntı/kod, tablo menüsü (▦ Tablo ▾), bağlantı/görsel ekleme; mod sekmeleri çubuğun en sağında.
- Canlı önizlemede kopyalama markdown olarak yapılır (blok seçiminde kaynak metin panoya gider).
- Kaynak modda `Ctrl+F` ile ara/değiştir (temaya uygun panel).
- Canlı/Okuma/Split önizlemede `Ctrl+F` ile bulma çubuğu: büyük/küçük harf (Aa), tüm sözcük, normal ifade, sayaç, `Enter` ile gezinme; `≡` ile Değiştir/Tümü (kaynak metinde, `$1` destekli).
- Canlı modda birden çok bloğu seçip `Delete` ile toplu silme.
- Matematik (KaTeX): satır içi `$...$`, blok `$$...$$`.
- Mermaid diyagramları (```mermaid blokları, koyu/açık temaya uyumlu).
- Ön madde (frontmatter) tablo görünümü; tıklayınca ham hali düzenlenir.
- Tablo düzenleyici: canlı blok üstünde ve biçim çubuğunda satır/sütun ekle-sil.
- `[[Not#Başlık]]`, `[[Not|Etiket]]` ve aynı-dosya `#başlık` linklerinde başlığa kaydırma.
- Gezgin panelinde **Karaca İçindekiler** (tıkla-satırına-git) ve **Karaca Geri Bağlantılar**.
- Komutlar: `Karaca MD: Hızlı Not Oluştur`, `Karaca MD: Günlük Notu Aç`.

## Çalıştırma (geliştirme)

```powershell
npm install
npm run compile
npm test            # birim testler (node --test, zero-dep)
# sonra F5 ile Extension Development Host aç, bir .md dosyası aç
```

`.md` dosyaları varsayılan olarak bu editörle açılır. İstemiyorsan sekmeye sağ tık → `Reopen Editor With... → Text Editor`, veya komut paletinden:

- `Karaca MD: Canlı Editörde Aç`
- `Karaca MD: Varsayılan Metin Editörüyle Aç`
- `Karaca MD: Hızlı Not Oluştur`
- `Karaca MD: Günlük Notu Aç`

## Ayarlar

- `karacaMd.defaultMode`: `live` | `source` | `split` | `reading` (varsayılan `live`)
- `karacaMd.wordWrap`: kaynak editörde satır kaydırma (varsayılan `true`)
- `karacaMd.lineNumbers`: kaynak editörde satır numaraları (varsayılan `true`)

## Bilinen sınırlamalar (V2 yol haritası)

- Göreli görseller md klasörünün dışına (`../` ile üst klasöre) taşarsa gösterilmez.
- Matematik (KaTeX) ve Mermaid diyagramları henüz yok.
- CodeMirror teması statik (açılıştaki temaya göre); dinamik tema takibi V2'de.

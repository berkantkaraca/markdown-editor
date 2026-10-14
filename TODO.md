# Yapılacaklar (V2 Yol Haritası)

V1 tamamlandı: Kaynak / Canlı / Okuma modları, tıklanabilir görev kutuları,
`[[WikiLink]]`, göreli dosya linkleri, kod vurgulama, kelime sayacı.

## Editör deneyimi

- [x] Split modu: kaynak solda + önizleme sağda, senkron kaydırmalı
- [x] CodeMirror temasının VS Code teması değişince dinamik güncellenmesi
- [x] Canlı modda aktif blokta markdown kısayolları (biçim çubuğu eklendi)
- [x] Arama/değiştir çubuğunun webview içinde çalışması (Kaynak modda `Ctrl+F`, önizlemede bulma çubuğu)
- [x] Kelime kaydırma + satır numarası ayarlarının anlık uygulanması

## İçerik desteği

- [x] Göreli görsellerin webview-uri ile çözümlenmesi (md klasörü kök kabul edilir)
- [x] Matematik desteği (KaTeX, `$...$` / `$$...$$`; fontlar pakette gömülü)
- [x] Mermaid diyagramları (```mermaid blokları; tema değişiminde yeniden çizilir)
- [x] İçindekiler / başlık haritası (outline) paneli (Gezgin'de, tıkla-satırına-git)
- [x] Tablo düzenleyici (satır/sütun ekle-sil; canlı blok + biçim çubuğu)

## Bağlantılar ve notlar

- [x] `[[Not#Başlık]]` ve `[[Not|Etiket]]` varyantlarının tam desteği (başlığa kaydırma dahil)
- [x] Geri bağlantılar (backlinks) paneli (Gezgin'de)
- [x] Günlük not / hızlı not oluşturma komutu
- [x] Ön madde (frontmatter/YAML) düzenleme desteği (tablo görünüm + ham düzenleme)

## Teknik borç

- [x] Üretim paketinden kaynak haritalarının çıkarılması (`.vscodeignore` ile yapılır; ayrıca dev webview derlemesinde map kapalı — 19 MB map esbuild'i çökertiyordu)
- [x] Webview ↔ extension mesaj protokolüne sürüm numarası ekleme (`proto: 1`)
- [x] Büyük dosyalar (>1 MB) için artımlı render / sanallaştırma (400+ blokta parçalı DOM ekleme)
- [x] Otomatik testler (blok ayrıştırma + wikilink birim testleri; `npm test`, 27 test)

## v0.2.0 (teknik review aksiyonları)

- [x] P1: Sürüm damgalı senkron (`base`/`version`) + satır-birleştirme + çakışmada disk-koruma
- [x] P2: Mermaid lazy-load (ayrı chunk; soğuk açılış küçüldü)
- [x] P3: `main.ts` alan denetleyicilerine ayrıldı (`protocol/history/selection/search/format`)
- [x] P4: Workspace-kökü `localResourceRoots`'ta (`../` görseller workspace içinde çalışır)

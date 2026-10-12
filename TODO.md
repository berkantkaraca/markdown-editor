# Yapılacaklar (V2 Yol Haritası)

V1 tamamlandı: Kaynak / Canlı / Okuma modları, tıklanabilir görev kutuları,
`[[WikiLink]]`, göreli dosya linkleri, kod vurgulama, kelime sayacı.

## Editör deneyimi

- [ ] Split modu: kaynak solda + önizleme sağda, senkron kaydırmalı
- [ ] CodeMirror temasının VS Code teması değişince dinamik güncellenmesi
- [x] Canlı modda aktif blokta markdown kısayolları (biçim çubuğu eklendi)
- [ ] Arama/değiştir çubuğunun webview içinde çalışması (`Ctrl+F`)
- [ ] Kelime kaydırma + satır numarası ayarlarının anlık uygulanması

## İçerik desteği

- [x] Göreli görsellerin webview-uri ile çözümlenmesi (md klasörü kök kabul edilir)
- [ ] Matematik desteği (KaTeX, `$...$` / `$$...$$`)
- [ ] Mermaid diyagramları (```mermaid blokları)
- [ ] İçindekiler / başlık haritası (outline) paneli
- [ ] Tablo düzenleyici (satır/sütun ekle-sil)

## Bağlantılar ve notlar

- [ ] `[[Not#Başlık]]` ve `[[Not|Etiket]]` varyantlarının tam desteği
- [ ] Geri bağlantılar (backlinks) paneli
- [ ] Günlük not / hızlı not oluşturma komutu
- [ ] Ön madde (frontmatter/YAML) düzenleme desteği

## Teknik borç

- [ ] Üretim paketinden kaynak haritalarının çıkarılması (`.vscodeignore` ile kısmen yapıldı)
- [ ] Webview ↔ extension mesaj protokolüne sürüm numarası ekleme
- [ ] Büyük dosyalar (>1 MB) için artımlı render / sanallaştırma
- [ ] Otomatik testler (blok ayrıştırma + wikilink birim testleri)

# Durum — paket-9

- [x] Araç çubuğu: SVG simgeler, işlev grupları, aktif durumlar, dar ekran ve klavye gezinmesi.
- [x] Matematik ve Mermaid kaynağı için Canlı moddan açılan, önizlemeli düzenleme penceresi; çift tıkla düzenleme ve araç çubuğundan ekleme.
- [x] Büyük dosyalarda ölçümlü performans çalışması: değişmeyen kod ve Markdown düğümleri için önbellek, yazım dışında serileştirme, gizli kaynak editörü güncellemelerini kaldırma. 300 KB ve 1.5 MB ölçümleri PERFORMANCE.md içinde. Sanallaştırma kullanılmıyor.
- [x] HTML aktarımı: özel kapsayıcılar, stilli span, tanım listeleri, medya kapsayıcıları, yorumlar ve birleşik hücreli tabloların kaynaklarını koruma.
- [x] Gerçek VS Code Extension Host üzerinde otomatik aç/düzenle/kaydet/kapat/yeniden aç testi.
- [x] Windows üzerinde Chromium, Firefox ve WebKit testleri; Chromium'da IME bileşimi, tüm motorlarda Japonca/Çince/Korece/Türkçe yazım.
- [x] Linux/macOS/Windows × Chromium/Firefox/WebKit CI matrisi hazırlandı (.github/workflows/validation.yml). Yerel çalıştırma araçları eklendi.
- [ ] Linux ve macOS üzerinde gerçek ortamda manuel doğrulama. Bu Windows oturumunda bu iki işletim sistemi yok; WSL yalnızca docker-desktop içeriyor ve Docker motoru çalışmıyor. CI matrisi henüz uzak sunucuda çalıştırılmadı. Bu madde ortamda doğrulanmadan tamamlandı sayılmıyor.

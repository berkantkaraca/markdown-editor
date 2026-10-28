# Durum — paket-13

- [x] Varsayılan İngilizce, isteğe bağlı Türkçe; kalıcı arayüz dil seçimi, yerelleştirilmiş komut/ayar açıklamaları.
- [x] berkantkaraca yayıncı/yazar bilgisi, SVG kaynak ve 256×256 PNG eklenti ikonu; eski taslak yedekleri için kimlik geçişi.

- [x] Araç çubuğu: SVG simgeler, işlev grupları, aktif durumlar, dar ekran ve klavye gezinmesi.
- [x] Matematik ve Mermaid kaynağı için Canlı moddan açılan, önizlemeli düzenleme penceresi; çift tıkla düzenleme ve araç çubuğundan ekleme.
- [x] Büyük dosyalarda ölçümlü performans çalışması: değişmeyen kod ve Markdown düğümleri için önbellek, yazım dışında serileştirme, gizli kaynak editörü güncellemelerini kaldırma. 300 KB ve 1.5 MB ölçümleri PERFORMANCE.md içinde. Sanallaştırma kullanılmıyor.
- [x] HTML aktarımı: özel kapsayıcılar, stilli span, tanım listeleri, medya kapsayıcıları, yorumlar ve birleşik hücreli tabloların kaynaklarını koruma.
- [x] Gerçek VS Code Extension Host üzerinde otomatik aç/düzenle/kaydet/kapat/yeniden aç testi.
- [x] Windows üzerinde Chromium, Firefox ve WebKit testleri; Chromium'da IME bileşimi, tüm motorlarda Japonca/Çince/Korece/Türkçe yazım.
- [x] Platform kapsamı Windows. Chromium/Firefox/WebKit için Windows CI matrisi hazırlandı; uzak CI çalıştırması yerel testlerden ayrı tutulur. Linux/macOS şimdilik kapsam dışı.
- [x] Kayıt yanıtı zaman aşımı, aynı istek kimliğiyle güvenli tekrar, kullanıcıya hata ve yeniden deneme düğmesi.
- [x] Belgeye özel atomik yerel taslak yedeği, yeniden açmada kurtarma ve eski kaydın yeni taslağı silmesini önleme.
- [x] Değişmeyen Markdown kaynak aralıklarını, alternatif yazımları ve referans tanımlarını koruma.
- [x] Uzun süre kesintisiz yazımda serileştirmeye 750 ms üst sınır; IME tamamlanana kadar dış güncellemeleri bekletme.

- [x] Tablo ekleme: boyut ızgarası, özel satır/sütun sayısı, klavye kullanımı ve dar ekran desteği; Canlı ve Kaynak modlarında seçime ekleme.

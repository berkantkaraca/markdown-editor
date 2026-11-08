# Durum — paket-29

- [x] Tam satır/sütun seçiminde Delete/Backspace ile kaldırma; gruplu modern Tablo menüsü, hücre üzerinde hızlı işlemler ve Alt+Shift+ok kısayolları.

- [x] Yeni tabloları saf Markdown pipe tablosu, boş paragrafları gerçek boş satırlar olarak yazma; tekrar açılışta boş satırları gösterme. Eski bağımsız HTML tabloları/boş paragrafları Canlı modda sonraki düzenleme/kayıtta Markdown’a dönüştürme.

- [x] Canlı modda biçimli HTML yapıştırma: dış editör HTML normalizasyonu, metin+görsel panosunda metin önceliği, boş HTML için düz metne dönüş; gerçek Windows Ctrl+V testi.

- [x] Liste farklarını madde bazında gösterme, son maddede yazarken önceki kaynak satırlarını koruma; Working Tree/Split kaydırmasında kare bazında güncelleme ve yumuşak takip.

- [x] Tüm modlarda aynı Git farkı; Enter ile değişmeyen kaynak satırlarını koruma, komşu çizgileri birleştirme, Working Tree ve Split için içerik tabanlı çift yönlü kaydırma.

- [x] Son commit'e göre Git değişiklik göstergeleri: Canlı/Okuma görünümünde bölüm kenarı, Kaynak/Split görünümünde satır kenarı; kaydedilmemiş değişiklikler, yeni dosya ve commit sonrası yenileme doğrulandı.

- [x] Canlı modda içindekiler, normal bağlantılar ve WikiLink için el imleci ve Ctrl gerektirmeyen tek tıkla gezinme.

- [x] Görsel/bağlantı pencereleri araç düğmesine hizalı açılır; dosyadan seç, vazgeç ve ekle aynı satırda. Dar ekran ve pencere boyutu değişimi doğrulandı.

- [x] Yerel dosya seçiciyle görsel ekleme, assets içine img-zaman damgası adıyla kopyalama.
- [x] Kaydetmede kullanılmayan üretilmiş görselleri temizleme; çalışma alanındaki Markdown referanslarını koruma ve geri alma için proje dışında kurtarma kopyası.

- [x] Varsayılan İngilizce, isteğe bağlı Türkçe; VS Code ayarlarından kalıcı dil seçimi, yerelleştirilmiş komut/ayar açıklamaları.
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

- [x] Kısa İngilizce README; dil ayarı yalnızca VS Code Settings içinde, Reading modunda sabit mod düğmeleri.

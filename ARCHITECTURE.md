# Karaca MD — paket-10 mimarisi

## Belge modeli

Canlı editör tek bir Tiptap/ProseMirror `Editor` örneğidir. Kullanıcının tıkladığı
paragraflar ayrı editörlere dönüşmez; blok kimliği, blok seçimi, blok textarea'sı
ve blok silme algoritması bulunmaz. ProseMirror şeması paragrafları, başlıkları,
listeleri ve tabloları bir belgenin yapısal öğeleri olarak tutar. Bunlar kullanıcıya
ayrı düzenleme kutuları olarak sunulmaz.

Yazım, seçim, paragraf bölme/birleştirme, liste girintisi, tablo işlemleri ve geri
alma motorun transaction sistemiyle yürür. `execCommand`, DOM üzerinden biçim
uygulama, düz metin ofsetiyle imleç kurtarma ve özel snapshot geçmişi kaldırıldı.

## Modüller

| Dosya | Sorumluluk |
| --- | --- |
| `src/webview/document-editor.ts` | Tiptap şeması, Markdown içe/dışa aktarımı, belge geçmişi, görsel imleç çapaları, arama süslemeleri |
| `src/webview/source-editor.ts` | CodeMirror, kaynak geçmişi, ayarlar, kaynak liste Enter ve görsel konumu |
| `src/webview/document-sync.ts` | Sıralı kayıt, istek onayları, dış revizyon birleştirme, kaydetme sırası ve taslak kurtarma |
| `src/webview/main.ts` | Modlar, VS Code bağlantısı, görsel dosyaları, içindekiler navigasyonu ve açılış |
| `src/webview/format.ts` | Belge/kaynak komutları, menüler ve bağlantı/görsel formları |
| `src/webview/search.ts` | Bulma arayüzü ve değiştir işlemleri |
| `src/webview/preview.ts` | Temizlenmiş okuma/split önizlemesi, tembel Mermaid yüklemesi |
| `src/webview/layout.html` | Eklenti ve testlerin ortak HTML iskeleti, paket göstergesi |
| `src/shared/md-pipeline.ts` | Markdown, matematik, kod vurgusu ve inline WikiLink render hattı |
| `src/shared/md-turndown.ts` | HTML → Markdown kuralları |
| `src/extension.ts` | VS Code belge/dosya erişimi, sürüm kontrolü, görsel kaydı, bağlantılar ve yan paneller |

## Markdown dönüşümü

Açılışta Markdown tam belge olarak render edilir. HTML inert DOMParser belgesinde
çözümlenir; matematik, Mermaid, ön madde ve desteklenen özel HTML yapılarının
kaynakları saklanır. Temizlenmiş HTML ProseMirror şemasına aktarılır.

Kullanıcı işlemleri modelde yapılır. Değişmeyen düğümlerin Markdown karşılığı önbellekte tutulur;
yazım durakladığında yalnızca değişen düğümler HTML üzerinden serileştirilir;
ekrandaki çizilmiş SVG, arama vurguları veya göreli görselin webview adresi kaynağa
yazılmaz. Düzenleme sırasında bütün belge yeniden render edilmez. Yalnızca mod
geçişi veya dış revizyon farklı içerik getirirse model yeniden yüklenir.

Düzenlenmeyen dosya, odak değişimi veya mod geçişi nedeniyle normalize edilmez.
Canlı düzenlemede Markdown'ın eşdeğer yazım biçimi normalize olabilir. Matematik ve Mermaid Canlı modda çift tıklamayla kaynak penceresinden düzenlenir;
YAML kaynağı Kaynak modundan düzenlenir; canlı görünümde kaynakları
korunan nesnelerdir. Tüm olası ham HTML/Markdown uzantıları için kayıpsız dönüşüm
garantisi yoktur; standart dışı belgeler Kaynak modundan düzenlenmelidir.

## Kayıt protokolü

1. Yerel işlem `DocumentSync.edit` çağırır. 150 ms içinde değişiklikler gruplanır.
2. Bir anda yalnızca bir `edit { text, base, requestId }` gönderilir.
3. Host sürümü doğrular; gerekirse ortak atayla satır düzeyinde birleştirir.
4. Host her istek için `edit-result { requestId, text, version, isDirty, conflict }`
   gönderir. Eşit metin bile onaylanır.
5. Onay beklenirken yazılan taslak korunur. Sonraki gönderi onaylanan tabana dayanır.
6. Dış `update` uçuş sırasında ertelenir. Daha eski revizyonlar uygulanmaz.
7. Çakışmada yerel taslak webview state'ine alınır; kullanıcıdaki **Taslağı geri
   yükle** düğmesiyle yeniden açılabilir. Sunucu sürümü sessizce taslağı yok etmez.
8. Ctrl/Cmd+S, bekleyen yazımlar onaylandıktan sonra hosta `save` gönderir.

Odak durumu bir senkronizasyon koşulu değildir. Okuma önizlemesi belgeyi değiştirmez.

## Güvenlik ve yaşam döngüsü

HTML DOMPurify ile temizlenir; Tiptap şeması düzenlenebilir yapıyı sınırlar. Mermaid
strict modda çalışır. Kaynak metaverisi URI kodlanır; ok işaretleri ve özel karakterler
HTML temizleyici tarafından silinmez. Görsel modelde özgün dosya yolunu tutar;
webview URI'si yalnızca NodeView üzerinde uygulanır.

VS Code nonce/CSP ve localResourceRoots sınırları korunur. Panel dispose olduğunda
belge/ayar/kayıt dinleyicileri bırakılır. Webview kapanırken motorlar destroy edilir.
`retainContextWhenHidden` kapalıdır; asıl belge VS Code TextDocument'tır.

## Doğrulama

```powershell
npm run lint
npm run compile
npm test
npm run test:browser
```

Birim/entegrasyon testleri gerçek Tiptap transaction'larını ve host onaylarını
kullanır. Tarayıcı testleri gerçek Chromium klavye olaylarını, pano HTML akışını,
Mermaid render'ını ve tek yüzey görünümünü doğrular. `CHROME_PATH` ile tarayıcı
belirtilebilir; Windows'ta Chrome veya Edge otomatik bulunur. Diğer ortamlarda
`npx playwright install chromium` gerekir.

Testler üretimdeki `layout.html` dosyasını kullanır. Test kancası yalnızca test
paketinde etkinleşir. Her teslimde paket göstergesi bir artırılır; kurallar AGENTS.md'dedir.

## paket-10 ekleri

`source-dialog.ts` kaynak düzenleme/önizleme penceresini yönetir. Araç çubuğu svg
simgeler ve semantik gruplar kullanır; komut hedefleri önceki belge seçimini korur.
Kayıt ve görünüm değişiminden önce `DocumentEditor.flush()` çağrılır. Markdown
serileştirmesi ile kod renkleri değişmeyen model düğümlerini WeakMap içinde önbellekler.
Kaynak görünümü Canlı'daki her yazımda güncellenmez; moda geçerken eşitlenir.
HTML aktarımı kapsayıcı, stil, yorum ve gelişmiş tablolar için kaynak koruması yapar;
bu nesneler canlıda çift tıklanarak düzenlenebilir. Betikler render'da temizlenir.

Yerel testler Windows, Chromium/Firefox/WebKit, Unicode ve Chromium IME bileşimini kapsar.
Gerçek VS Code testi ayrı profilde aç/düzenle/kaydet/yeniden aç zincirini çalıştırır.
Platform kapsamı Windows'tur; CI yalnızca windows-latest üzerinde üç motoru çalıştırır.

`SourcePreserver` orijinal Markdown aralıklarını model kökenleriyle eşler; değişmeyen
aralıklar ve görünmeyen referans tanımları aynen kalır. Yapısal taşıma gibi eşlemenin
belirsiz olduğu işlemlerde standart serileştirme kullanılır. Köken bağlamı belge
geçmişine bağlıdır; geri alma önceki kaynağa döner.

`DocumentSync` kayıt yanıtını bekler, zaman aşımında aynı oturum/istek kimliğini
tekrar gönderir. `RequestQueue` eşzamanlı ve gecikmiş tekrarları tek uygulamaya indirir.
Başarısız disk kaydı kullanıcıya bildirilir. `DraftStore` belge URI karmasıyla adlandırılan
JSON yedeğini geçici dosya ve rename ile yazar; eski kayıt yeni taslağı temizleyemez.
Yedek mesajı her serileştirilmiş değişiklikte gönderilir. Uzun yazımda serileştirme
750 ms içinde başlatılır; IME bileşimi bitmeden serileştirme/dış güncelleme uygulanmaz.

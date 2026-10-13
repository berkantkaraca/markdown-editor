# Referans Canlı-Editör Analizi

> Kapsam: gömülebilir, üç modlu (zengin-metin / anlık-render / split) açık kaynak
> markdown editörünün yerel inceleme kopyası (v4.0.0, TypeScript, MIT).
> Yöntem: kaynak taraması + kritik dosyaların satır-seviyesi doğrulaması.
> Bu belge bilinçli olarak proje/kişi adı içermez.

## 1. Mimari genel

- `src/ts/` altında ~17 modül: canlı-render (`ir/`), zengin-metin (`wysiwyg/`),
  split (`sv/`), araç çubuğu (`toolbar/`), yükleme (`upload/`), markdown
  çevrimleri (`markdown/`), önizleme (`preview/`), içindekiler (`outline/`),
  ipucu (`hint/`), geri-al (`undo/`), seçim/yardımcılar (`util/`).
- Üç mod tek durum bayrağıyla yönetilir; varsayılan **anlık-render** modudur.
  Mod geçişi: o anki metin alınır → hedef DOM yeniden kurulur → motor bayrakları
  moda göre değiştirilir.
- Markdown motoru: **Go ile yazılıp JavaScript'e derlenen** gömülü bir motordur
  (~MB mertebesinde tek dosya). Tüm yönler (kaynak→DOM, DOM→kaynak,
  anlık-tur) bu motordan geçer. Sanitizasyon bayrağı vardır (varsayılan açık).

## 2. Anlık-render (IR) modu — çekirdek döngü

- Yüzey: `contenteditable="true"` tek `pre` düğümü (doğrulanmış iskelet).
- Her yazımda tüm belge DEĞİL, ilgili **blok** işlenir:
  1. İmleç konumuna görünmez `wbr` çapası konur.
  2. Blok bulunur; liste ise **en üst liste**, alıntı ise **alıntı katmanı**,
     dipnot ise **dipnot bloğu** seçilir (doğrulandı).
  3. Liste komşuları (önceki/sonraki liste) ve bağlantı-tanım/dipnot blokları
     geçici olarak birleştirilir.
  4. Bloğun `outerHTML`'i motora verilir, dönen HTML ile `outerHTML` değiştirilir.
  5. Çapa (`wbr`) bulunup seçim oraya kurulur — imleç korunur.
- Ağır işler debounce'ludur: undo ~800 ms, önizleme ~1000 ms, ipucu ~200 ms.
- CJK/bileşik giriş `composingLock` ile render dışı bırakılır.
- Tıklanan düğüm "genişler" (işaretler görünür), diğerleri gizlenir.

## 3. Seçim / silme / kopyalama / yapıştırma

- **Kopyalama:** seçim `cloneContents` ile geçici `div`'e alınır, başlık
  işaretleri onarılır, motor `DOM→markdown` çevirir; panoya `text/plain`
  olarak markdown gider, `text/html` bilinçli boşaltılır (doğrulandı).
  Zengin-metin modunda kod-içi seçim backtick'lenir, bağlantı `[metin](adr)`
  olarak üretilir. Kesme = kopya + `execCommand("delete")`.
- **Silme:** tarayıcı `deleteContents` yapar, ardından girdi döngüsü çalışır.
  Özel durumlar (tablo hücresi, görev kutusu, liste, alıntı, kod bloğu) tuş
  işleyicide ayrı fonksiyonlarla ele alınır.
- **Yapıştırma:** `insertHTML` + imleç çapası; blok düzeyindeyse ilgili bloktan
  sonra eklenir. Word'lü yapıştırma ve liste-içi yapıştırma için özel düzeltmeler
  vardır (sürüm notlarıyla doğrulanmış davranışlar).
- **Görev kutusu tıklaması:** `checked` özniteliği çevrilip kısmi render yapılır.

## 4. Geri al / yinele

Tarayıcı geçmişi kullanılmaz; mod başına **diff-match-patch** yamaları tutulur
(kapasite ~50). Anlık görüntüye imleç çapası gömülür; geri alımda yama uygulanıp
çapa ile imleç + kaydırma geri kurulur.

## 5. Markdown özellik envanteri (nasıl yapıldığı)

| Özellik | Uygulama |
|---|---|
| Başlıklar (H1–H6, çapa) | Motor render'ı; içindekiler paneli ayrı modül |
| Vurgu (kalın/italik/üstü çizili/işaretli) | Motor + anlık modda işaret genişletme |
| Listeler (sıralı/sırasız, iç içe) | Komşu-birleştiren blok turu; Tab/Enter özel tuşları |
| Görev listeleri | Tıklanabilir kutu + klavye düzeltmesi |
| Tablolar | Hücre-içi ok gezintisi, önek/sonek ile ekleme |
| Kod blokları (kopyalama düğmeli) | Motor + kod vurgulayıcı |
| Alıntı, yatay çizgi | Blok turu (alıntı katmanına genişletme) |
| Bağlantı (satır-içi + referans) | Referans-tanım blokları tur sonunda birleştirilir; zengin modda popover düzenleme |
| Resim (yükleme + pano) | Doğrulama + gömme hattı; yapıştırma desteği |
| Matematik (KaTeX/MathJax) | CSS+JS **tembel** yüklenir, sonuç `data-*` özniteliğinde saklanır |
| Diyagramlar (mermaid, flowchart, sequence, plantuml, graphviz, wavedrom) | Dil takma adıyla tetiklenir; gevşek güvenlik kipiyle başlatılır |
| Grafik/nota (echarts, abcjs), zihin haritası | Aynı tembel-yükleme deseni |
| Emoji + otomatik tamamlama | İpucu modülü + panel |
| Dipnotlar | Ayrı blokta toplanır, tur sonunda birleştirilir; referans etiketi güncellenir |
| İçindekiler | Editör veya önizleme DOM'undan üretilir |
| Üst/alt simge, `@bağlantı`, e-posta | Motor seçenekleri |
| Medya gömme (video/ses), sesli okuma | Önizleme seçenekleriyle |
| Ön madde (frontmatter) | Doğrulanamadı — envanter dışı bırakıldı |

## 6. Araç çubuğu modeli

- Düğmeler `ad + önek + sonek + kısayol` bildirimseldir (örn. kalın `**/**`,
  tablo boru-şablonu); moda göre üç ayrı uygulayıcıya dallanır
  (zengin / anlık / split).
- Anlık modda biçimlendirme: seçim `önek+çapa+seçim+çapa+sonek` ile sarılır.
- Resim/bağlantı düzenlemesi zengin modda açılır **popover**'dır (ayrı modal yok).
- Başlık/emoji/yükleme/kayıt/içindekiler için özel düğme sınıfları vardır.

## 7. Paketleme ve boyut

- Derleyici: webpack, UMD çıktı; çalışma-zamanı bağımlılığı tek
  (diff-match-patch). Ağır render motorları CDN'den tembel yüklenir —
  **çevrimdışı gömmede hepsi yerelleştirilmelidir**.
- Motor dosyası tek başına MB mertebesindedir; tam paket de MB mertebesindedir
  (kesin sayı derlenmeden verilmez).

## 8. Güvenlik notları

- Motor sanitizasyon bayrağı varsayılan açıktır.
- Diyagram motoru gevşek kipte başlatılıyor — gömmede gözden geçirilmeli.
- Yapıştırma hattında XSS düzeltmesi sürüm geçmişinde mevcuttur.

## 9. Bizim sisteme uygulanabilir dersler

1. **İmleç çapası (`wbr`):** render öncesi konur, sonrası kurulur — imleç
   kaybı sorununun kanıtlı çözümü.
2. **Blok-seviyesi roundtrip:** tüm belge yerine ilgili blok + komşu birleştirme
   (liste komşuları, referans-tanım ve dipnot blokları).
3. **Kopyada markdown:** seçim parçası motora verilip `text/plain` yapılır;
   başlık işareti gibi kaybolan sözdizimi işlem öncesi onarılır.
4. **Listede en-üst genişletme:** öğe-içi işlem tüm listeye genişletilir.
5. **Diff-patch undo:** imleç çapası gömülü anlık görüntüler.
6. **Tembel ağır yükleme + sonuç önbelleği** (KaTeX/diyagram desenimizle uyumlu).
7. **Popover düzenleme** (resim/bağlantı için modal yerine imleç-yanı panel).

## 10. Entegrasyon seçenekleri (karar bekliyor)

- **A — Teknik aktarma (önerilir):** Yukarıdaki 7 teknik kendi mimarimize
  uyarlanır; kod tabanı ve paket boyutu bizde kalır.
- **B — Motor olarak gömme:** Canlı mod bu motorla değiştirilir. Hızlıdır ama
  tema senkronu, vikilink, özel modlar ve MB-mertebesi çevrimdışı paket
  (font+CDN bileşenleri dahil) yeniden entegre edilmelidir.

## 11. Doğrulanamayanlar (inceleme dışı)

Yükleme hattı detayları, dışa aktarma, ECharts hata ayıklama paneli ve ön
madde desteği bu turda satır-seviyesinde doğrulanmadı; entegrasyonda tekrar
bakılmalıdır.

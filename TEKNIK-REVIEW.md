> Tarihsel inceleme: Bu belge paket-1 mimarisini anlatır. Güncel paket-8 mimarisi için ARCHITECTURE.md dosyasına bakın.

# Karaca MD Editor — Teknik Review

> Tarih: Ekim 2026 · Sürüm: 0.1.0 (`paket-1`) · Durum: Yayına hazır aday
> Kapsam: VS Code içinde tek-sekmede markdown düzenleme + görüntüleme eklentisi.

## 1. Yönetici Özeti

VS Code'un varsayılan markdown deneyimi (ham editör + ayrı önizleme sekmesi +
sürekli bölünmüş ekran) yerine, **tek sekmede 4 modlu** bir editör geliştirildi:
Kaynak, Canlı (tıkla-yerinde-düzenle), Split (senkron çift panel) ve Okuma.
Ürün; görev listeleri, wiki-bağlantılar, matematik, diyagramlar, tablo
düzenleyici, panodan görsel yapıştırma, bulma/değiştirme ve geri-altyapısı ile
tam özellikli bir not alma ortamıdır. ~3.400 satır TypeScript, **75 otomatik
test** (birim + headless uçtan-uca), `npm audit` temiz, 2,57 MB imzalı paket.

## 2. Ürün Kapsamı

| Alan | Durum |
|---|---|
| 4 editör modu (Kaynak/Canlı/Split/Okuma) | ✅ |
| Biçim çubuğu + açılır menüler (H1–H6, Tablo, Bağlantı/Görsel diyalogları) | ✅ |
| Bulma çubuğu (Aa/tüm-sözcük/regex + Değiştir/Tümü) ve Kaynak modda `Ctrl+F` | ✅ |
| Görev listeleri (tıklanabilir, dosyaya yazılır) | ✅ |
| `[[WikiLink]]`, `[[Not#Başlık]]`, `#başlık` çapa kaydırma | ✅ |
| Gezgin panelleri: İçindekiler + Geri Bağlantılar; Hızlı/Günlük Not komutları | ✅ |
| Matematik (KaTeX, fontlar gömülü) + Mermaid diyagramları | ✅ |
| Frontmatter tablo görünümü + ham düzenleme | ✅ |
| Panodan görsel yapıştırma (`assets/` klasörüne kayıt) | ✅ |
| Geri al/yinele (çakışmasız, imleç korumalı) | ✅ |
| VS Code tema senkronu (editör + kod renkleri + diyagramlar) | ✅ |
| Büyük dosya desteği (400+ blokta parçalı render) | ✅ |

## 3. Sistem Mimarisi

İki katman, tek sorumluluk ilkesiyle ayrılmıştır:

```
┌─ VS Code (Extension Host) ──────────────┐
│ src/extension.ts (~640 satır)            │
│ • CustomTextEditorProvider (karaca.mdEditor)
│ • Dosya sistemi tek doğruluk kaynağı     │
│ • Link/wikilink çözümleme, görsel kaydı  │
│ • İçindekiler + Geri Bağlantı panelleri  │
│ • Komutlar (aç, not oluştur, satıra git) │
└───────────────┬──────────────────────────┘
                │  sürümlü mesaj protokolü (proto: 1)
                │  9 mesaj tipi, tam-metin senkron
┌───────────────┴──────────────────────────┐
│ Webview (tek sayfa uygulaması)            │
│ src/webview/main.ts (~2100 satır)         │
│ src/shared/md-pipeline.ts (render hattı)  │
│ src/shared/md-utils.ts (saf yardımcılar)  │
│ • 4 mod + blok modeli + CodeMirror 6      │
│ • markdown-it + highlight.js + KaTeX      │
│ • mermaid + task-list eklentileri         │
└──────────────────────────────────────────┘
```

Tasarım ilkesi: **dosya sistemi tek doğruluk kaynağıdır.** Webview yalnızca
görünüm + etkileşim üretir; her içerik değişikliği tam-metin mesajla extension
host'a gider, oradan diske yazılır ve yankı tüm görünümlere dağıtılır. Döngüsel
güncellemeler eşitlik kontrolüyle kesilir.

## 4. Uçtan Uca Akışlar

**Açılış:** Sekme açılır → webview `ready` gönderir → host `config` (mod,
ayarlar) + `update` (metin) yollar → kayıtlı mod render edilir (<100 ms).

**Yazma (Kaynak/Split):** CodeMirror tuşu → 250 ms debounce ile tam metin host'a
→ diske yazılır → yankı döner; yazarken imleç/kaydırma korunur (kelepçeli seçim
geri kurulumu).

**Canlı düzenleme:** Tık → blok ham kaynağa dönüşür (kutulusuz, aynı font;
kodda mono) → her tuş satır-haritası kaydırılarak metne işlenir → `Esc` /
odak kaybı ile render'a dönülür. Satır haritası her mutasyonda kaydırıldığı
için Enter/silme sonrası içerik bozulmaz.

**Toplu seç-sil:** Sürükle-seç → `Delete`: tam kapsanan bloklar + liste
kenarlarında kısmen kapsanan öğeler (satır eşlemeli) silinir; komşu paragrafların
istenmeden birleşmesini ayraç kuralı engeller. Kısmi seçimde ilgili blok
düzenlemeye açılır. Odak bulma kutusundayken bile çalışır (odak önce boşa alınır).

**Bul/Değiştir:** Önizlemede DOM-düzeyi sarı vurgu + sayaç + gezinme; `≡` ile
kaynak-düzeyi Değiştir/Tümü (`$1` destekli). Kaynak modda CodeMirror paneli.

**Kopyalama:** Blok seçiminde panoya **markdown kaynak** gider (`# Başlık`
başlık olarak yapışır); kısmi başlık seçiminde işaretler onarılır. Dışa HTML
varyantı da konur.

**Görsel yapıştırma:** Pano resmi `assets/yapistirilan-<zaman>.ext` olarak
kaydedilir (MIME beyaz listesi, 15 MB tavan), imlece `![](...)` eklenir;
önizleme kaldığı yerden devam eder.

**Tablo:** Canlı blok üstü mini menü + biçim çubuğu menüsü (satır/sütun ekle-sil);
imleç çevresindeki tablo otomatik bulunur.

**Gezinme:** Başlığa tıklama/outline/wikilink-çapa → ilgili satıra kaydırma +
kısa vurgulama (`reveal-line` mesajı; panel kaydı ile hedef sekme bulunur).

**Geri alma:** Anlık-görüntü zinciri (imleç çapalı, ~2 MB tavanlı); Kaynak/Split'te
imleç geri konur.

**Tema:** VS Code teması değişince CodeMirror teması, kod renkleri ve diyagramlar
anlık uyarlanır (gizli kaplar atlanır — gizli SVG'de ölçüm hatası vermemesi için).

## 5. Mesaj Protokolü (özet)

`update` (metin yankısı), `config` (ayar itmesi), `edit` (tam-metin yazma),
`open-link` / `open-wikilink`, `paste-image`, `resolve-imgs` / `img-uris`
(göreli görsel→webview URI), `reveal-line`, `error`, `ready`. Tüm mesajlar
`proto: 1` taşır; bilinmeyen sürüm yoksayılır. Detay: `ARCHITECTURE.md`.

## 6. Kritik Mühendislik Kararları

| Problem | Karar |
|---|---|
| Sekme kapat-açta webview çökmesi | `retainContextWhenHidden: false`; durum metinden türetilir. (Altta yatan `InvalidStateError`, VS Code platform hatasıdır — microsoft/vscode#330595.) |
| Bitişik blokların tek divde kaynaması | Yalnızca gerçekten çakışan aralıklar birleşir; komşular ayrı kalır. |
| Tuşların/seç-sil'in bazen çalışmaması | Kök sebep odak hırsızlığıydı (`stopPropagation`, odaklı girdiler); kaldırıldı + seçim aralığı dondurma + yabancı odakta blur-önceliği. |
| Yeniden çizim titremesi | Kaydırma aynı karede korunur; çizilmiş diyagramlar SVG önbelleğinden basılır. |
| Derleme çökmeleri (natif, sessiz) | `fs.cpSync` yerine tek-tek kopya; dev webview derlemesinde 19 MB sourcemap kapalı; parçalar ayrı process'te derlenir. |
| XSS riskli bağımlılık | `markdown-it-katex` (yüksek seviyeli XSS, düzeltmesiz) elendi; bakımlı `markdown-it-texmath` kullanıldı. CSP nonce-only script politikası. |

## 7. Kalite Güvencesi

- **Statik:** `tsc --noEmit` her turda zorunlu (derleyici tip denetlemez).
- **Birim (27):** saf yardımcılar — satır işlemleri, tablo, frontmatter,
  wikilink, bulma regex'i (`node --test`, sıfır ek bağımlılık).
- **Render hattı (8):** mermaid/hljs/KaTeX fence'leri, wikilink, frontmatter.
- **Uçtan-uca (32):** derlenmiş paket jsdom'da çalıştırılır; mod geçişi, edit+
  imleç, toplu silme (3 senaryo), tablo menüsü zamanlama yarışı, kopya, bulma —
  hepsi gerçek DOM olaylarıyla. Toplam **75 test**, iki tur üst üste yeşil.
- **Süreç kuralları:** `ARCHITECTURE.md` > "Hata günlüğünden kurallar" (14 madde)
  — derlemeden test yok, yalancı-yeşil test yok, paket listesi gözden geçirme.
- **Paket:** vsix içeriği zip seviyesinde doğrulandı (72 dosya; test/scratch/map
  yok; KaTeX fontları dahil). `npm audit`: kritik/yüksek yok.

## 8. Metrikler

22 commit · ~3.600 satır TS (webview ~1.100 + alan modülleri ~1.300, extension ~750, shared ~500) ·
75 test · vsix 2,57 MB · eklenti açılışı <100 ms.

## 9. Bilinen Sınırlamalar ve Riskler

- Önizlemede bulma sayacı ile kaynak sırası, sentaks karakterli sorgularda
  sapabilir (kozmetik).
- Klasör dışına (`../`) taşan göreli görseller güvenlik gereği yüklenemez.
- Sekme kapat-aç webview hatası tamamen platform tarafındadır; karşı önlemler
  (tek örnek, önbellek temizliği) belgelenmiştir.
- Mermaid `securityLevel: strict` ile çalışır; çok büyük belgelerde ilk çizim
  gecikebilir (parçalı render + önbellek ile hafifletildi).

## 10. Yol Haritası Önerisi

Kısa vade: tablo hücre düzenleme derinliği, `AB` harf-koruma düğmesi, imleç
konumunda menü. Orta vade: yayın (marketplace başvurusu + ekran görüntüleri),
geri bildirim turu. Uzun vade: referans canlı-editör tekniklerinin faz 2-3
uyarlamaları (`REFERANS-ANALIZ.md`).

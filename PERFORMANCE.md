# Büyük dosya ölçümleri — paket-10

Yerel Windows/Chromium ölçümü; aynı makinede, 1000 bölüm ve 100 TypeScript kod örneği.
Sonuçlar bir benchmark örneğidir; farklı makinelerde süreler değişir.

| Belge | Model yükleme | Beş ardışık yazım işlemi | Serileştirme |
| --- | --- | --- | --- |
| 300,790 bayt / 2,100 üst düğüm, önce | 246 ms | 185 / 147 / 128 / 138 / 124 ms | Her işlem içinde |
| Aynı belge, sonra | 157 ms | 6.3 / 11.3 / 6.4 / 5.4 / 5.2 ms | 0.8 ms |
| 1,508,390 bayt / 10,500 üst düğüm, sonra | 884 ms | 88 / 93 / 105 / 96 / 93 ms | 2.4 ms |
| 300,790 bayt / 2,100 üst düğüm, paket-10 kaynak koruma | 297 ms | 14.8 / 14.2 / 13.5 / 12.2 / 12.1 ms | 8.4 ms |
| 1,508,390 bayt / 10,500 üst düğüm, paket-10 kaynak koruma | 1138 ms | 118 / 119 / 116 / 115 / 123 ms | 15.8 ms |

Model güncelleme süresi ölçülür; GPU çiziminin tamamlanması ve disk I/O bu sayılara dahil değildir.
Büyük belgelerde model/DOM işlemleri hâlâ yüz milisaniyeye yaklaşabilir; sanallaştırma eklenmedi.

Değişmeyen ProseMirror düğümleri WeakMap ile yeniden serileştirilmez. Kod renklendirmesi de
aynı düğümleri tekrar çözümlemez. Markdown dönüşümü 100 ms yazım arası sonrasında çalışır;
kesintisiz yazımda en geç 750 ms içinde başlatılır. IME sırasında bileşim beklenir.
Kaydetme, mod geçişi, dış revizyon ve pencere kapanması bekleyen dönüşümü önce tamamlar.
Kaynak editörü Canlı moddaki her tuşta güncellenmez. Seçim ve geri alma belge motorunda kalır.

```powershell
npm run test:performance
$env:KARACA_PERF_SECTIONS = '5000'
$env:KARACA_PERF_LABEL = 'large'
npm run test:performance
```

Ham ölçümler `out/performance-*.json` dosyalarına yazılır. Benchmark test dosyası
`test/browser.cjs` içindedir ve normal doğrulama sırasında ayrıca etkinleştirilmedikçe atlanır.

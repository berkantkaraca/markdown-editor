# Repo çalışma kuralları

Her değişiklik tesliminde editörde görünen `paket-N` sayısını bir artır.
Gösterge `src/webview/layout.html` içindeki `#pkgmark` öğesindedir.
`test/e2e.test.ts` içindeki paket beklentisini aynı sayıyla güncelle.
Testler gerçek `layout.html` dosyasını kullanır; ayrı HTML iskeleti tutma.
Aynı işin ara düzenlemeleri ve test tekrarları için ayrıca artırma; her teslimde
bir kez artır. Teslimden önce `npm run compile` çalıştır ki kullanıcı güncel
paket göstergesini görsün. Son yanıtta güncel paket numarasını belirt.

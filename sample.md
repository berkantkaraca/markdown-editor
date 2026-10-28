# H1 Başlığı: Ana Başlık

## H2 Başlığı: Alt Başlık

### H3 Başlığı: Bölüm Başlığı

#### H4 Başlığı

##### H5 Başlığı

###### H6 Başlığıf

* * *

## 1\. Metin Biçimlendirme (Typography)

Bu paragrafta **kalın metin**, *italik metin*, ***kalın ve italik metin***, ~~üstü çizili metin~~ ve `satır içi kod (inline code)` bulunmaktadır. Ayrıca buraya bir [örnek bağlantı (Link)](https://berkantkaraca.com) eklenmiştir.

* * *

## 2\. Alıntılar (Blockquotes)

> Bu tek satırlık standart bir alıntıdır.
> 
> İkinci paragrafı içeren çok satırlı alıntı bloğu.

> İç içe (nested) alıntı bloğu örneği.

* * *

## 3\. Listeler (Lists)

### Sırasız Liste (Unordered List)

-   ~~Elma~~
    
-   Armut
    
    -   Yeşil elma
        
    -   Deveci armudu
        
-   Muz

### Sıralı Liste (Ordered List)

1.  Projeyi klonla
    
2.  Bağımlılıkları yükle (`npm install`)
    
3.  Uygulamayı ayağa kaldır (`npm run dev`)

### Görev Listesi (Task List)

- [ ] Markdown ayrıştırıcısı yazıldı
- [ ] Kod renklendirme (syntax highlighting) eklendi
- [ ] VS Code eklentisi yayınlandı

## 4\. Tablolar (Tables)

<table style="min-width: 75px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th style="text-align: left;"><p>Dil / Teknoloji</p></th><th style="text-align: center;"><p>Kategori</p></th><th style="text-align: right;"><p>Seviye</p></th></tr><tr><td style="text-align: left;"><p>Java / Spring Boot</p></td><td style="text-align: center;"><p>Backend</p></td><td style="text-align: right;"><p>İleri</p></td></tr><tr><td style="text-align: left;"><p>TypeScript / Angular</p></td><td style="text-align: center;"><p>Frontend</p></td><td style="text-align: right;"><p>Orta</p></td></tr><tr><td style="text-align: left;"><p>PostgreSQL / Redis</p></td><td style="text-align: center;"><p>Veritabanı</p></td><td style="text-align: right;"><p>İleri</p></td></tr></tbody></table>

* * *

## 5\. Kod Blokları (Code Blocks)

### Java Spring Boot Örneği

```java
@RestController@RequestMapping("/api/v1/hello")public class HelloController {

    @GetMapping
    public ResponseEntity<String> sayHello() {
        return ResponseEntity.ok("Hello, Markdown!");
    }
}
```

<p></p>
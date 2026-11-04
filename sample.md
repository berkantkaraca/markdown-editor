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
        
-   Muza



## 4\. Tablolar (Tables)

| Dil / Teknoloji | Kategori | Seviye |
| :--- | :---: | ---: |
| Java / Spring Boot | Backend | İleri |
| TypeScript / Angular | Frontend | Orta |
| PostgreSQL / Redis | Veritabanı | İleri |

* * *

## 5\. Kod Blokları (Code Blocks)

### Sıralı Liste (Ordered List)

1.  Projeyi klonla
    
2.  Bağımlılıkları yükle (`npm install`)
    
3.  Uygulamayı ayağa kaldır (`npm run dev`)

### Görev Listesi (Task List)

- [ ] Markdown ayrıştırıcısı yazıldı
- [ ] Kod renklendirme (syntax highlighting) eklendi
- [ ] VS Code eklentisi yayınlandı

## 4\. Tablolar (Tables)

| Dil / Teknoloji | Kategori | Seviye |
| :--- | :---: | ---: |
| Java / Spring Boot | Backend | İleri |
| TypeScript / Angular | Frontend | Orta |
| PostgreSQL / Redis | Veritabanı | İleri |

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


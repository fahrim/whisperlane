# Whisperlane — Brand Asset Kit

Bu paket, paylaşılan iki Whisperlane logo görselinden hazırlanmış pratik marka varlıklarını içerir.

## Hızlı başlangıç

- **Web sitesi / sunum / e-posta (koyu zemin):** `01_Logos/PNG/whisperlane-lockup-horizontal-on-dark.png`
- **Açık zemin:** `01_Logos/PNG/whisperlane-lockup-horizontal-on-light.png`
- **Sadece sembol, şeffaf PNG:** `01_Logos/PNG/whisperlane-brandmark-gradient.png`
- **Sadece wordmark, şeffaf PNG:** `01_Logos/PNG/whisperlane-wordmark-silver.png`
- **Uygulama ikonu — önerilen düz sürüm:** `02_App_Icons/PNG/whisperlane-app-icon-flat-1024.png`
- **Cam efektli alternatif ikon:** `02_App_Icons/PNG/whisperlane-app-icon-1024.png`
- **PWA favicon:** `02_App_Icons/PNG/favicon.ico`
- **Durum ikonları:** `03_Status_States/`
- **Sosyal medya görselleri:** `04_Social_Media/`
- **Renk kartı ve genel görünüm:** `05_Guidelines/`

## Klasörler

### `01_Logos`
- `PNG/`: Şeffaf zeminli sembol, wordmark, yatay ve dikey logo kilitleri. Açık ve koyu yüzeyler için beyaz/siyah/silver seçenekleri bulunur.
- `SVG/`: Ölçeklenebilir sembol varyasyonları.

### `02_App_Icons`
- `PNG/`: 16–1024 px arasında yaygın ikon boyutları, favicon ve maskable PWA ikonu.
- `Android/`: Android adaptive foreground ve background kaynakları.

**Not:** `whisperlane-app-icon-1024.png`, gönderdiğin cam/plaka görselindeki ikonu koruyan stilize sürümdür. Platformlar için köşe maskesinin iki kez oluşmasını istemiyorsan, köşeleri önceden yuvarlatılmamış `whisperlane-app-icon-flat-1024.png` sürümünü tercih et.

### `03_Status_States`
`idle`, `listening-active`, `processing`, `muted` ve ek bir `error` varyasyonu içerir. Her durumun şeffaf PNG'si ve koyu zeminli önizleme karosu vardır. Bunlar UI durumları için statik görsellerdir; animasyon/Lottie içermez.

### `04_Social_Media`
Hazır görsel ölçüleri:
- Instagram gönderisi: 1080 × 1350
- Instagram Story / Reels kapağı: 1080 × 1920
- X başlığı: 1500 × 500
- LinkedIn kapak: 1128 × 191
- YouTube kanal kapağı: 2560 × 1440
- Open Graph / bağlantı paylaşım görseli: 1200 × 630
- Landing hero (README/websitesi başlığı): `04_Social_Media/hero-main-generated.webp`
- Profil görselleri: 1080, 800 ve 300 px
- E-posta imzası: açık/koyu zemin için şeffaf PNG

Sosyal medya JPG dosyalarında marka işareti ve wordmark dışında slogan eklenmemiştir.

## Renk paleti

Renkler, sağlanan görsel referanslardan yaklaşık olarak alınmıştır; orijinal kaynak dosyada ayrı bir renk token listesi yoktu.

| Token | HEX | Önerilen kullanım |
|---|---|---|
| Midnight Navy | `#090D1B` | Ana koyu arka plan |
| Deep Indigo | `#101427` | İkinci yüzey / kart |
| Signal Cyan | `#30EEDD` | Gradient başlangıcı |
| Electric Blue | `#4B9FFF` | Gradient geçişi |
| Wave Purple | `#9057FF` | Vurgu / glow |
| Glow Magenta | `#E855D2` | Gradient geçişi |
| Warm Coral | `#FF8087` | Gradient bitişi |
| Silver | `#D8DCE8` | Wordmark / ikincil yazı |
| Near White | `#FAFAFF` | Açık logo / yüksek kontrast |

## Dosya kaynağı ve doğruluk notu

Kaynak olarak sağlanan görseller raster formatındaydı. Bu yüzden:
- Gradient sembolü ve wordmark PNG'leri, verilen görsellerden temizlenip şeffaflaştırılmış yüksek çözünürlüklü türevlerdir.
- SVG sembol dosyaları, mevcut sembol silüetinin izlenerek oluşturulmuş vektör sürümleridir; gradient SVG, PNG'deki ışıma ve 3B renk katmanlarının birebir karşılığı değil, daha sade bir vektör alternatifidir.
- Wordmark için özgün düzenlenebilir font dosyası veya vektör kaynak bulunmadığından wordmark PNG'leri raster olarak kalır.

Bu nedenle, birebir görsel eşleşmenin önemli olduğu yerlerde şeffaf PNG kilitlerini; boyut değiştirmek ve tek renk sembol kullanmak için SVG'leri kullan.

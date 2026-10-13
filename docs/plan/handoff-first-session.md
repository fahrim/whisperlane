# Handoff — first session (whisperlane)

Brief for the first working session in this repo. Read this and the source plan
before doing anything else.

---

Merhaba. Sıfırdan yeni bir projeye başlıyoruz: **whisperlane**. Bu klasör/repoyu
yeni açtım; henüz kod yok.

**Dil kuralı (önemli):** Benimle her zaman **Türkçe** konuş. Ama proje
artefaktlarını — dokümanlar, README, commit mesajları — **İngilizce** yaz.
Dokümanların dilini ben ayrıca söylemeyeceğim; varsayılan İngilizce.

## İlk iş — baştan sona oku
`docs/plan/pre-start-intro-plan.md` — şimdilik **tek doğruluk kaynağımız** bu.

## Proje tek cümlede
Ücretsiz, yerel-öncelikli (offline çalışan) bir masaüstü dikte uygulaması:
bas-konuş, yazı hedefe düşsün. SuperWhisper / Wispr Flow tarzı; ayrıca STT
eklentimizin (`opencode-listen-stt`) bağımsız sürümü.

**Farkımız (bu sırayla):**
1. **AI agent'a native** — "her uygulamaya yaz" değil, önce **OpenCode'a dikte**;
   hedef soyutlaması sonra genişler.
2. **Premium, sade UX** — kalabalık yok; "tam bir Apple ürünü" hissi.
3. **Windows'ta her GPU (Vulkan)** — AMD/Intel dahil; `whisper-vulkan-win` bunu kapatıyor.

**Yığın:** Tauri v2 + Bun + React + TypeScript + whisper.cpp.
**Lisans:** MIT OR Apache-2.0 (`LICENSE-MIT` + `LICENSE-APACHE`).
**Non-goals (v1):** hesap/bulut senkronu yok, toplantı kaydı yok, mobil yok,
model eğitimi yok.

## Bu oturumdaki görevin
Intro planı, geliştirmeye başlamadan önce ihtiyacımız olan **doküman setine**
dönüştürmek. Bu oturumda **kod yazma** — ve **hiçbir dokümanda da kod olmayacak**
(aşağıdaki kural 1).

## Doküman kapsamı (başlangıç — birlikte kesinleştiririz)
- **Misyon, vizyon, hedefler ve başarı ölçütleri**
- **Hedef kitle**, kullanıcı personaları, temel kullanım senaryoları
- **Ürün tasarımı**: ne yapar, kapsam ve özellikler, v1 sınırları, konumlandırma
- **Kullanıcı deneyimi**: ilkeler, akışlar, ekranlar, durumlar, "hissi" (premium/sade)
- **Mimari ve altyapı**: bileşenler, veri akışı, teknoloji seçimleri, platform stratejisi
- **AI agent / OpenCode entegrasyonu** (ürünün kaması)
- **Yol haritası**: milestone'lar (M0–M3) + kabul kriterleri
- **Açık kararlar / ADR'ler**
- **Repo kuralları, lisans, katkı rehberi**, test ve dağıtım stratejisi
- **Doküman index'i** (aşağıya bak)

## Kurallar
1. **Hiçbir dokümanda kod olmayacak.** Mimari konuşulur, anlatılır; diyagram
   (ASCII veya mermaid) serbest — ama kaynak kod, config, kod snippet'i **yok**.
   Bu hem dokümanlar hem bu oturum için geçerli.
2. Dokümanlar **İngilizce**; benimle sohbet **Türkçe**.
3. **Tüm dokümanlar birbirine referans verecek** ki yolumuzu kaybetmeyelim:
   - Bir **index** olsun (ör. `docs/README.md`): okuma sırası, her dokümanın tek
     cümlelik amacı, ve ilişkili dokümanlar.
   - Her dokümanın sonunda bir **"Related"** bölümü olsun; gerektiğinde ilgili
     dokümanlara ve kaynak plana (`pre-start-intro-plan.md`) bağlantı versin.
   - Yeni bir doküman eklediğinde index'i ve ilgili dokümanların "Related"
     bölümlerini güncelle.
4. Tek doğruluk kaynağı `docs/plan/pre-start-intro-plan.md`. Bir çelişki çıkarsa
   ya o dokümanı güncelle ya da bana sor; sessizce ayrışma.
5. **Açık soruları sessizce karara bağlama**: seçenekleri, artı/eksileri ve bir
   öneriyi yaz (gerekirse `docs/adr/`). Kararı bana bırak ya da onayımı al.
6. Her dokümanın **bir işi** olsun; gereksiz tekrar ve dolgu yok. Ama kapsam
   geniş olsun: ürün, UX, misyon/vizyon, kitle, mimari, entegrasyon, plan, roadmap
   — baştan sona.
7. Bir şeyi bilmen gerekiyorsa **sor** (varsayılan kısayol, ilk hedef platform,
   hedef model boyutu, kitle vb.); tahmin edip ilerleme.

## Nasıl ilerleyelim
1. Kaynak planı oku.
2. **Doküman planını** bana sun: önerilen doküman listesi + `docs/README.md`
   index taslağı + her doküman için tek cümlelik amaç. **Önce onayımı al.**
3. Onaydan sonra dokümanları **tek tek** yaz; her birini index'e ekle ve çapraz
   referansları ("Related") kur. İstersen her dokümandan sonra bana kısa bir özet
   ver, sonra devam et.

## Ek not
Repo'da henüz `git init` yok. Repo kuralları dokümanında bunu ve lisans
dosyalarını (`LICENSE-MIT`, `LICENSE-APACHE`) da ele al; kurulumu istersen
dokümanlar oturduktan sonra birlikte yaparız.

Başlamak için: **önce kaynak planı oku**, sonra **doküman planını ve index
taslağını** bana sun. Onaylayınca yazmaya geç.

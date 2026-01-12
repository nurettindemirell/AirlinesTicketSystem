# Fly with Bilet - Uçuş Listesi

Sistemde toplam **601 uçuş** var.

## Test İçin Popüler Rotalar

### İstanbul → New York (IST → JFK)
- **Fiyat:** $800
- **Tarihler:** 15.01.2026, 16.01.2026, 17.01.2026 (ve sonrası)
- **Saatler:** 06:00, 07:00, 08:00, 15:00, 16:00, 17:00
- **Miles:** 8000 (para ile alınca kazanılır)

### İstanbul → Londra (IST → LHR)
- **Fiyat:** $300
- **Miles:** 3000 puan

### İstanbul → Dubai (IST → DXB)
- **Fiyat:** $400
- **Miles:** 4000 puan

### İstanbul Sabiha Gökçen → Amsterdam (SAW → AMS)
- **Fiyat:** $200
- **Miles:** 2000 puan

## Örnek Test Senaryosu

**15 Ocak 2026 Uçuşları:**
```
IS686   Istanbul → New York      15.01.2026  $800  (8000 miles)
IS847   Istanbul → New York      15.01.2026  $800  (8000 miles)
IS577   Istanbul → London        15.01.2026  $300  (3000 miles)
IS162   Istanbul → Dubai         15.01.2026  $400  (4000 miles)
SA137   Sabiha → Amsterdam       15.01.2026  $200  (2000 miles)
AM234   Amsterdam → Istanbul     15.01.2026  $180  (1800 miles)
```

## Tüm Uçuşlar 

### 15-31 Ocak 2026
```
Flight,From,To,Date,Price
IS686,IST → JFK,15.01.2026 10:00,$800
IS847,IST → JFK,15.01.2026 16:00,$800
IS577,IST → LHR,15.01.2026 06:00,$300
IS162,IST → DXB,15.01.2026 06:00,$400
AM234,AMS → SAW,15.01.2026 06:00,$180
SA137,SAW → AMS,15.01.2026 07:00,$200
LH327,LHR → IST,15.01.2026 07:00,$280
DX439,DXB → IST,15.01.2026 07:00,$380
FR423,FRA → DXB,15.01.2026 07:00,$550
```

### Şubat 2026 (Örnek)
Şubat ayında da her gün düzenli uçuşlar var.

## Test Rehberi

### 1. Miles Kazanma Testi ($800 bilet = 8000 miles)
1. Login ol (Member Club)
2. Istanbul → New York uçuşu seç
3. "Pay $800" (MONEY) ile öde
4. ✅ 8000 miles kazanacaksın

### 2. Miles İle Ödeme Testi
1. Yukarıdaki testten sonra 8000 milesın olacak
2. Tekrar Istanbul → New York seç
3. "Pay 8000 Miles" butonuna bas
4. ✅ Miles ile ücretsiz bilet al

### 3. Koltuk Azalma Testi
1. Bir uçuş seç, kalan koltuk sayısını not et
2. Bilet al
3. Ana sayfaya dön, aynı uçuşa bak
4. ✅ Koltuk 1 azalmış olacak

---

**Not:** Tüm uçuşlar 15 Ocak 2026 - 10 Şubat 2026 arası.

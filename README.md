# CESGS Baruna — Membaca Gerak Laut

Pemantau iklim laut Indonesia dari model laut gratis **CMEMS (Copernicus Marine)**,
dilengkapi observasi OISST, klimatologi COBE-SST2, dan prakiraan musiman SINTEX-F.
Menampilkan suhu muka laut, anomali, klimatologi, arus, salinitas, serta indeks
ENSO (Nino 1+2/3/3.4/4, ONI) dan IOD (DMI).

## Arsitektur

- **Backend** (`backend/pipeline/`) — Python, unduh subset CMEMS dan sumber
  observasi, lalu hasilkan raster WebP, JSON indeks, dan `climate.json`. Tanpa basis data.
- **Frontend** (`frontend/`) — Leaflet + leaflet-velocity, gaya Atmospheric Glass.
- **Deploy** — GitHub Actions menjalankan pipeline lalu publish ke GitHub Pages,
  otomatis tiap hari 05.00 WIB.

## Kredensial

Pipeline butuh akun Copernicus Marine. Simpan di GitHub Secrets repo ini dengan nama
`COPERNICUSMARINE_SERVICE_USERNAME` dan `COPERNICUSMARINE_SERVICE_PASSWORD`.
Jangan pernah menuliskannya di dalam kode.

## Jalankan lokal

```
python -m venv backend/venv
backend/venv/Scripts/pip install -r requirements.txt
python -m backend.pipeline.run     # butuh kredensial CMEMS di environment
python dev_server.py               # lalu buka http://127.0.0.1:8000/frontend/index.html
```

#!/usr/bin/env python3
"""Pembuat data CESGS Baruna v3: angin, potensi badai, gelombang, arus.

Ditulis 5 November 2026. SEBELUMNYA TIDAK ADA. Lapisan v3 masuk ke repo
sebagai snapshot lewat commit 5fb28b5 tanpa membawa skripnya, jadi domainnya
tidak pernah bisa diubah lagi. Berkas ini menutup lubang itu.

Yang penting dan gampang keliru:

1. DOMAIN. Kotaknya 36..200 BT, 33 LU/LS. Dua angka itu BUKAN karangan.

   Titik tengahnya (36+200)/2 = 118 BT, sama persis dengan titik tengah
   Indonesia, jadi Indonesia duduk di tengah bingkai.

   Lebarnya 164 derajat, tingginya 90. Bentuknya 1,62, JANGKUNG dengan
   sengaja.

   Alasannya bingkai peta berubah ubah: dengan sidebar dan panel bawah
   terbuka bentuknya sekitar 2,34, di layar penuh jadi 1,78. Menyetel data
   supaya pas dengan salah satunya pasti menyisakan ruang kosong di yang
   lain. Jadi datanya dibuat lebih jangkung dari dua duanya, lalu frontend
   MENGISI bingkai dan memotong kelebihannya.

   Yang tampil: di layar penuh 41,8 derajat lintang, dengan sidebar
   terbuka 33,1 derajat. Dua duanya penuh tanpa sisa.

   200 BT berarti MELEWATI garis 180. Sudah diuji, NOMADS dan CMEMS dua
   duanya memulangkan bujur 36..200 apa adanya tanpa perlu dibungkus.

2. GELOMBANG WAJIB KISI 0p25, BUKAN 0p16. Kisi 0p16 yang lebih halus itu
   BERHENTI DI 15 LS. Laut selatan Jawa, Bali, dan Nusa Tenggara kosong
   sama sekali, tanpa galat apa pun. Sudah diukur, bukan dugaan.

3. GAMBARNYA MERCATOR, bukan plate carree. Leaflet menempel imageOverlay
   dengan regangan lurus di ruang PIKSEL, dan di peta Mercator itu berarti
   gambarnya sendiri harus sudah Mercator. Gambar cape yang lama 1920x1056,
   rasionya 1,818 yang berarti plate carree, jadi letak lintangnya selama
   ini meleset. Di sini semuanya Mercator.
"""
from __future__ import annotations

import argparse, datetime as dt, json, math, os, sys, time
import urllib.parse, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

AKAR = Path(__file__).resolve().parents[2]
KELUAR = AKAR / "frontend" / "data" / "output"
MENTAH = Path(os.environ.get("BARUNA_RAW", AKAR / "backend" / "data" / "raw"))

# ---- Domain, lihat catatan 1 di atas -------------------------------------
LON_W, LON_E = 36.0, 200.0
LAT_S, LAT_N = -45.0, 45.0
LEBAR = 4000                      # tinggi dihitung dari rasio Mercator

FSTEP_AKHIR = 240                 # 10 hari, sama dengan snapshot lama
FSTEP_LANGKAH = 3                 # 81 bingkai

NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin"


# ==========================================================================
#  Proyeksi
# ==========================================================================
def merc_y(lat):
    """Y Mercator ternormalkan, 0 di kutub utara dan 1 di kutub selatan."""
    lat = np.clip(lat, -85.05113, 85.05113)
    return 0.5 - np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) / (2 * np.pi)


def tinggi_mercator(lebar=LEBAR):
    sx = (LON_E - LON_W) / 360.0
    sy = merc_y(LAT_S) - merc_y(LAT_N)
    return int(round(lebar * sy / sx))


TINGGI = tinggi_mercator()


def kisi_mercator(lebar=LEBAR, tinggi=TINGGI):
    """Bujur dan lintang tiap piksel gambar keluaran."""
    lon = LON_W + (np.arange(lebar) + 0.5) / lebar * (LON_E - LON_W)
    y0, y1 = merc_y(LAT_N), merc_y(LAT_S)
    yy = y0 + (np.arange(tinggi) + 0.5) / tinggi * (y1 - y0)
    lat = np.degrees(2 * np.arctan(np.exp((0.5 - yy) * 2 * np.pi)) - np.pi / 2)
    return lon, lat


# ==========================================================================
#  Unduh
# ==========================================================================
def run_terbaru(mundur_jam=5):
    """Run GFS yang kemungkinan besar sudah lengkap di NOMADS."""
    t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=mundur_jam)
    return t.replace(hour=(t.hour // 6) * 6, minute=0, second=0, microsecond=0)


def _ambil(url, timeout=240, ulang=4):
    galat = None
    for i in range(ulang):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                b = r.read()
            if b.startswith(b"GRIB"):
                return b
            galat = "bukan GRIB (%d bita): %r" % (len(b), b[:120])
        except Exception as e:
            galat = str(e)
        time.sleep(3 * (i + 1))
    raise RuntimeError(galat)


def _url(skrip, berkas, folder, lev, vars_):
    q = {"file": berkas, "dir": folder, "subregion": "",
         "leftlon": LON_W, "rightlon": LON_E, "toplat": LAT_N, "bottomlat": LAT_S}
    s = "&".join("%s=%s" % (k, urllib.parse.quote(str(v), safe="")) for k, v in q.items())
    for l in ([lev] if isinstance(lev, str) else lev):
        s += "&lev_%s=on" % l
    for v in vars_:
        s += "&var_%s=on" % v
    return "%s/%s?%s" % (NOMADS, skrip, s)


def unduh_atmos(run, fstep, lev, vars_, nama):
    p = MENTAH / nama
    if p.exists() and p.stat().st_size > 1024:
        return p
    u = _url("filter_gfs_0p25.pl",
             "gfs.t%02dz.pgrb2.0p25.f%03d" % (run.hour, fstep),
             "/gfs.%s/%02d/atmos" % (run.strftime("%Y%m%d"), run.hour),
             lev, vars_)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(_ambil(u))
    return p


def unduh_wave(run, fstep, vars_, nama):
    """WAJIB global.0p25. Lihat catatan 2 di kepala berkas."""
    p = MENTAH / nama
    if p.exists() and p.stat().st_size > 1024:
        return p
    u = _url("filter_gfswave.pl",
             "gfswave.t%02dz.global.0p25.f%03d.grib2" % (run.hour, fstep),
             "/gfs.%s/%02d/wave/gridded" % (run.strftime("%Y%m%d"), run.hour),
             "surface", vars_)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(_ambil(u))
    return p


# ==========================================================================
#  Baca GRIB
# ==========================================================================
def baca(path, nama_var=None):
    import xarray as xr
    ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""})
    lon = np.asarray(ds.longitude.values, dtype="f8")
    lat = np.asarray(ds.latitude.values, dtype="f8")
    out = {}
    for k in ds.data_vars:
        if nama_var and k not in nama_var:
            continue
        out[k] = np.asarray(ds[k].values, dtype="f4")
    ds.close()
    return lon, lat, out


def ke_mercator(fld, lon_src, lat_src, lon_dst, lat_dst):
    """Sampel terdekat dari kisi sumber ke kisi Mercator keluaran.

    Kisi sumber GFS lintangnya MENURUN (utara ke selatan). searchsorted butuh
    menaik, jadi dibalik dulu. Lupa membalik tidak memunculkan galat, cuma
    membuat petanya terbalik atas bawah.
    """
    if lat_src[0] > lat_src[-1]:
        lat_src = lat_src[::-1]
        fld = fld[::-1, :]
    iy = np.clip(np.searchsorted(lat_src, lat_dst), 0, lat_src.size - 1)
    ix = np.clip(np.searchsorted(lon_src, lon_dst), 0, lon_src.size - 1)
    return fld[np.ix_(iy, ix)]


# ==========================================================================
#  Warna
# ==========================================================================
def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def ramp(nilai, henti, bawah_bening=True):
    """Gradasi mulus antar titik henti legenda.

    `henti` = [(angka, "#rrggbb"), ...] urut menaik. Nilai di bawah titik
    pertama jadi bening kalau bawah_bening, kalau tidak dijepit ke warna
    pertama. NaN selalu bening.
    """
    xs = np.array([h[0] for h in henti], dtype="f4")
    cs = np.array([_hex(h[1]) for h in henti], dtype="f4")
    v = np.asarray(nilai, dtype="f4")
    sah = np.isfinite(v)
    vv = np.where(sah, v, xs[0])
    rgb = np.empty(v.shape + (3,), dtype="f4")
    for k in range(3):
        rgb[..., k] = np.interp(vv, xs, cs[:, k])
    a = np.where(sah, 255, 0).astype("u1")
    if bawah_bening:
        lembut = np.clip((vv - xs[0]) / max(1e-6, (xs[1] - xs[0])), 0, 1)
        a = (a * lembut).astype("u1")
    out = np.empty(v.shape + (4,), dtype="u1")
    out[..., :3] = np.clip(rgb, 0, 255).astype("u1")
    out[..., 3] = a
    return out


# ==========================================================================
#  Topeng darat
# ==========================================================================
def topeng_darat(lebar=LEBAR, tinggi=TINGGI):
    """True di darat. Digambar langsung ke ruang piksel keluaran, jadi
    lintangnya ikut Mercator tanpa perlu diproyeksikan dua kali."""
    simpan = MENTAH / ("darat_%d_%d_%g_%g.npy" % (lebar, tinggi, LON_W, LON_E))
    if simpan.exists():
        return np.load(simpan)
    geo = json.loads((AKAR / "frontend" / "data" / "land_10m.geojson").read_text())
    im = Image.new("1", (lebar, tinggi), 0)
    dr = ImageDraw.Draw(im)
    y0, y1 = merc_y(LAT_N), merc_y(LAT_S)

    def px(ring):
        out = []
        for x, y in ring:
            if x < 0:
                x += 360.0
            cx = (x - LON_W) / (LON_E - LON_W) * lebar
            cy = (merc_y(np.array([y]))[0] - y0) / (y1 - y0) * tinggi
            out.append((cx, cy))
        return out

    for ft in geo["features"]:
        g = ft["geometry"]
        poly = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for p in poly:
            for i, ring in enumerate(p):
                pts = px(ring)
                if len(pts) > 2:
                    dr.polygon(pts, fill=(0 if i else 1))
    m = np.array(im, dtype=bool)
    simpan.parent.mkdir(parents=True, exist_ok=True)
    np.save(simpan, m)
    return m


# ==========================================================================
#  Velocity JSON untuk leaflet-velocity
# ==========================================================================
def tulis_vel(path, u, v, lon, lat, run, valid, langkah=1):
    """Kisi velocity DIKURANGI kerapatannya lewat `langkah`. Berkas ini
    diunduh peramban tiap ganti bingkai, jadi 0,25 derajat penuh kemahalan."""
    if lat[0] < lat[-1]:
        lat = lat[::-1]; u = u[::-1, :]; v = v[::-1, :]
    u = u[::langkah, ::langkah]; v = v[::langkah, ::langkah]
    la = lat[::langkah]; lo = lon[::langkah]
    kepala = {
        "parameterUnit": "m.s-1", "parameterCategory": 2,
        "nx": int(lo.size), "ny": int(la.size),
        "lo1": float(lo[0]), "la1": float(la[0]),
        "lo2": float(lo[-1]), "la2": float(la[-1]),
        "dx": float(abs(lo[1] - lo[0])), "dy": float(abs(la[1] - la[0])),
        "refTime": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecastTime": 0,
    }
    def rec(num, arr):
        h = dict(kepala); h["parameterNumber"] = num
        a = np.where(np.isfinite(arr), arr, 0.0).astype("f4")
        return {"header": h, "data": [round(float(x), 2) for x in a.ravel()]}
    path.write_text(json.dumps([rec(2, u), rec(3, v)], separators=(",", ":")))


def tulis_kisi(path, fld, lon, lat, langkah=2):
    """Kisi kasar berbentuk {header, data} dengan data sebagai daftar BARIS.

    Lintang disusun MENURUN dari utara, sama dengan la1 di header, sebab
    rute.js menghitung indeks barisnya dari (la1 - lat) / dy.
    """
    if lat[0] < lat[-1]:
        lat = lat[::-1]; fld = fld[::-1, :]
    f = fld[::langkah, ::langkah]
    la = lat[::langkah]; lo = lon[::langkah]
    h = {"lo1": float(lo[0]), "la1": float(la[0]),
         "dx": float(abs(lo[1] - lo[0])), "dy": float(abs(la[1] - la[0])),
         "nx": int(lo.size), "ny": int(la.size)}
    f = np.where(np.isfinite(f), f, 0.0)
    data = [[round(float(x), 1) for x in baris] for baris in f]
    path.write_text(json.dumps({"header": h, "data": data}, separators=(",", ":")))


def simpan(rgba, path, mutu=82):
    im = Image.fromarray(rgba, "RGBA")
    if path.suffix == ".webp":
        im.save(path, "WEBP", quality=mutu, method=4)
    else:
        im.save(path, "PNG", optimize=True)


# ==========================================================================
#  Titik henti legenda. HARUS sama dengan LEGEND di frontend/app.js, kalau
#  tidak, angka di legenda berbohong soal warna di peta.
# ==========================================================================
# Satu rona biru CESGS, 7 November 2026, diminta pemilik. Hijau dibuang
# seluruhnya. Urutannya GELAP DI PELAN, TERANG DI KENCANG, bukan
# sebaliknya: alas petanya gelap, jadi laut yang tenang menyatu dengan
# latar dan yang menonjol cuma arus kuat. Kalau dibalik, seluruh samudra
# jadi pucat dan tidak ada yang terbaca.
HENTI_ARUS = [(0, "#06243D"), (0.25, "#0B3E63"), (0.5, "#11598C"),
              (0.75, "#1679AB"), (1, "#3FA3CF"), (1.5, "#8FD4EC"), (2, "#FFFFFF")]
# Gelombang: biru untuk yang aman, hangat untuk yang berbahaya. Hijau dan
# teal yang dulu ada di tengah dibuang.
HENTI_WAVE = [(0, "#0A2545"), (1, "#124C78"), (2, "#1679AB"),
              (3, "#5BB7D8"), (4, "#E8B23C"), (5, "#E06C1F")]
HENTI_CAPE = [(1000, "#fcab8f"), (1800, "#fb7252"), (2600, "#e83429"),
              (3400, "#b31218"), (4200, "#67000d")]
HENTI_ANGIN = [(0, "#071F36"), (5, "#0E4A72"), (10, "#1679AB"),
               (15, "#5BB7D8"), (20, "#E8B23C"), (25, "#E06C1F")]

META = {
    "cape":  dict(label="Potensi badai", units="J/kg", kind="scalar", source="GFS CAPE",
                  velScale=0.012, maxVel=25,
                  colors=["#2ad4ff", "#eaffff", "#ffe14d", "#ff8c1a", "#ff2d2d"]),
    "angin": dict(label="Angin Permukaan", units="m/s", kind="vector", source="GFS (NOAA)",
                  velScale=0.012, maxVel=25,
                  colors=["#8ad8ff", "#ffffff", "#ffd166", "#ff7b00"]),
    "arus":  dict(label="Arus Laut", units="m/s", kind="vector", source="CMEMS (Copernicus)",
                  velScale=0.12, maxVel=2,
                  colors=["#8FD4EC", "#3FA3CF", "#FFFFFF"]),
    "wave":  dict(label="Tinggi Gelombang", units="m", kind="vector", source="GFS-Wave (NOAA)",
                  velScale=0.03, maxVel=6,
                  colors=["#8FD4EC", "#3FA3CF", "#FFFFFF"]),
}
BATAS = {"lonW": LON_W, "lonE": LON_E, "latS": LAT_S, "latN": LAT_N}


def _buka_level(path, tipe, step=None):
    """Membuka satu level GRIB.

    `step` WAJIB diisi untuk level surface yang berisi CAPE dan PRATE
    sekaligus. CAPE itu nilai sesaat (stepType instant) sedangkan PRATE
    rerata (avg), dan cfgrib menolak membuka keduanya dalam satu dataset
    dengan DatasetBuildError "multiple values for key stepType". Saringan
    levelnya saja tidak cukup.
    """
    import xarray as xr
    kunci = {"typeOfLevel": tipe}
    if step:
        kunci["stepType"] = step
    return xr.open_dataset(path, engine="cfgrib", backend_kwargs={
        "indexpath": "", "filter_by_keys": kunci})


def olah_atmos(run, fstep, lon_d, lat_d, darat, cap=None):
    """Satu bingkai GFS: CAPE (gambar) dan angin 10 m (partikel).

    CAPE dan angin diminta dalam SATU unduhan walau levelnya beda, supaya
    permintaan ke NOMADS separuhnya. cfgrib menolak membuka berkas berlevel
    campur sekaligus, jadi dibuka dua kali dengan saringan level.
    """
    p = unduh_atmos(run, fstep, ["surface", "10_m_above_ground"],
                    ["CAPE", "PRATE", "UGRD", "VGRD"],
                    "gfs2_%s_%g_%g_%g_f%03d.grib2" % (run.strftime("%Y%m%d%H"), LON_W, LON_E, LAT_N, fstep))
    ds = _buka_level(p, "surface", "instant")
    cape = np.asarray(ds["cape"].values, dtype="f4")
    lo = np.asarray(ds.longitude.values, "f8"); la = np.asarray(ds.latitude.values, "f8")
    ds.close()
    try:
        ds = _buka_level(p, "surface", "avg")
        var_prate = np.asarray(ds["prate"].values, "f4")
        ds.close()
    except Exception:
        var_prate = None   # f000 tidak punya rerata, hujannya memang nol
    ds = _buka_level(p, "heightAboveGround")
    u = np.asarray(ds["u10"].values, "f4"); v = np.asarray(ds["v10"].values, "f4")
    ds.close()

    valid = run + dt.timedelta(hours=fstep)
    tag = "f%03d" % fstep
    simpan(ramp(ke_mercator(cape, lo, la, lon_d, lat_d), HENTI_CAPE),
           KELUAR / ("cape_%s.webp" % tag))
    spd = np.hypot(u, v)
    simpan(ramp(ke_mercator(spd, lo, la, lon_d, lat_d), HENTI_ANGIN, bawah_bening=False),
           KELUAR / ("angin_%s.webp" % tag))
    tulis_vel(KELUAR / ("angin_%s_vel.json" % tag), u, v, lo, la, run, valid, langkah=2)

    
    # Kisi kasar untuk fitur rute, BUKAN untuk digambar. rute.js menyampel
    # angka di titik titik sepanjang jalur dari sini lewat hazard.json.
    # Sempat hilang sekali karena pembersih ikut menyapunya, jadi sekarang
    # ditulis bersamaan dengan gambarnya supaya tidak bisa ketinggalan lagi.
    tulis_kisi(KELUAR / ("cape_%s.json" % tag), cape, lo, la, langkah=2)
    hujan = var_prate * 3600.0 if var_prate is not None else np.zeros_like(cape)
    tulis_kisi(KELUAR / ("rain_%s.json" % tag), hujan, lo, la, langkah=2)
    return valid


def olah_wave(run, fstep, lon_d, lat_d, darat):
    """Satu bingkai gelombang. Arah partikel ikut arah gelombang BERJALAN,
    yaitu DIRPW ditambah 180, sebab DIRPW itu arah DATANGNYA."""
    p = unduh_wave(run, fstep, ["HTSGW", "DIRPW"],
                   "gfswave_%s_%g_%g_%g_f%03d.grib2" % (run.strftime("%Y%m%d%H"), LON_W, LON_E, LAT_N, fstep))
    lo, la, var = baca(p)
    h = var.get("swh"); d = var.get("dirpw")
    if h is None:
        raise RuntimeError("HTSGW tidak ada di %s (isi: %s)" % (p.name, list(var)))
    tag = "f%03d" % fstep
    fld = ke_mercator(h, lo, la, lon_d, lat_d)
    fld = np.where(darat, np.nan, fld)
    simpan(ramp(fld, HENTI_WAVE, bawah_bening=False), KELUAR / ("wave_%s.webp" % tag))
    if d is not None:
        r = np.radians(np.where(np.isfinite(d), d, 0.0))
        u = -np.sin(r) * np.nan_to_num(h); v = -np.cos(r) * np.nan_to_num(h)
    else:
        u = np.zeros_like(h); v = np.zeros_like(h)
    tulis_vel(KELUAR / ("wave_%s_vel.json" % tag), u, v, lo, la, run, None, langkah=2)


# ==========================================================================
#  Arus dari CMEMS
# ==========================================================================
# Produk PER JAM, bukan harian. Diganti 5 November 2026 atas permintaan
# pemilik: tidak boleh ada lagi lapisan yang iramanya harian.
DS_ARUS = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m"
ARUS_LANGKAH_VEL = 3   # kisi partikel 1/12 x 3 = 0,25 derajat, lihat catatan di bawah


def olah_arus(waktu, lon_d, lat_d, darat, kredensial=None):
    """Arus permukaan pada daftar waktu yang diberikan.

    SATU PERMINTAAN PER WAKTU, bukan satu rentang panjang. Produk CMEMS ini
    per jam, sedangkan kita cuma butuh tiap 3 jam. Meminta rentang penuh
    berarti mengunduh 241 langkah lalu membuang dua pertiganya, 3,9 GB jadi
    1,3 GB kalau diminta satu satu.

    Kisi partikelnya diturunkan ke 0,25 derajat lewat ARUS_LANGKAH_VEL.
    Pada 1/6 derajat satu berkas velocity 5,2 MB, dan 81 bingkai berarti
    420 MB cuma untuk partikel arus. Pada 0,25 derajat jadi 2,3 MB, dan
    pusaran arus besar masih terlihat.
    """
    import copernicusmarine as cm
    if kredensial and Path(kredensial).exists():
        import configparser
        cp = configparser.ConfigParser(); cp.read(kredensial)
        sec = cp["credentials"]
        os.environ.setdefault("COPERNICUSMARINE_SERVICE_USERNAME", sec["username"])
        os.environ.setdefault("COPERNICUSMARINE_SERVICE_PASSWORD", sec["password"])

    import xarray as xr
    bingkai = []
    for n, t in enumerate(waktu, 1):
        cap = t.strftime("%Y%m%d_%H")
        nc = MENTAH / ("cmems_%s_%g_%g_%g.nc" % (cap, LON_W, LON_E, LAT_N))
        if not nc.exists() or nc.stat().st_size < 10240:
            nc.parent.mkdir(parents=True, exist_ok=True)
            iso = t.strftime("%Y-%m-%dT%H:00:00")
            try:
                cm.subset(dataset_id=DS_ARUS, variables=["uo", "vo"],
                          minimum_longitude=LON_W, maximum_longitude=LON_E,
                          minimum_latitude=LAT_S, maximum_latitude=LAT_N,
                          minimum_depth=0.49, maximum_depth=0.50,
                          start_datetime=iso, end_datetime=iso,
                          output_filename=nc.name, output_directory=str(nc.parent),
                          overwrite=True)
            except Exception as e:
                print("    arus %s dilewati: %s" % (cap, str(e)[:90]), flush=True)
                continue
        ds = xr.open_dataset(nc)
        lo = np.asarray(ds.longitude.values, "f8"); la = np.asarray(ds.latitude.values, "f8")
        u = np.asarray(ds["uo"].squeeze().values, "f4")
        v = np.asarray(ds["vo"].squeeze().values, "f4")
        ds.close()
        fld = np.where(darat, np.nan, ke_mercator(np.hypot(u, v), lo, la, lon_d, lat_d))
        simpan(ramp(fld, HENTI_ARUS, bawah_bening=False), KELUAR / ("arus_%s.webp" % cap))
        tulis_vel(KELUAR / ("arus_%s_vel.json" % cap), u, v, lo, la, t, None,
                  langkah=ARUS_LANGKAH_VEL)
        bingkai.append({"valid_time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "png": "arus_%s.webp" % cap, "vec": "arus_%s_vel.json" % cap})
        if n % 10 == 0 or n == len(waktu):
            print("    arus %3d/%d" % (n, len(waktu)), flush=True)
    return bingkai


# ==========================================================================
#  Penggerak
# ==========================================================================
def bangun(run=None, sampai=FSTEP_AKHIR, langkah=FSTEP_LANGKAH,
           kredensial=None, lewati_arus=False):
    KELUAR.mkdir(parents=True, exist_ok=True)
    run = run or run_terbaru()
    lon_d, lat_d = kisi_mercator()
    darat = topeng_darat()
    print("run      : %s" % run.strftime("%Y-%m-%d %HZ"))
    print("kotak    : %g..%g BT, %g..%g LU/LS" % (LON_W, LON_E, LAT_S, LAT_N))
    print("keluaran : %d x %d piksel" % (LEBAR, TINGGI))

    fsteps = list(range(0, sampai + 1, langkah))
    bingkai = {"cape": [], "angin": [], "wave": []}
    t0 = time.time()
    for n, f in enumerate(fsteps, 1):
        valid = olah_atmos(run, f, lon_d, lat_d, darat)
        olah_wave(run, f, lon_d, lat_d, darat)
        vt = valid.strftime("%Y-%m-%dT%H:%M:%SZ")
        tag = "f%03d" % f
        bingkai["cape"].append({"valid_time": vt, "png": "cape_%s.webp" % tag,
                                "vec": "angin_%s_vel.json" % tag})
        bingkai["angin"].append({"valid_time": vt, "png": "angin_%s.webp" % tag,
                                 "vec": "angin_%s_vel.json" % tag})
        bingkai["wave"].append({"valid_time": vt, "png": "wave_%s.webp" % tag,
                                "vec": "wave_%s_vel.json" % tag})
        if n % 10 == 0 or n == len(fsteps):
            print("  %3d/%d bingkai, %.0f detik" % (n, len(fsteps), time.time() - t0), flush=True)

    arus = []
    if not lewati_arus:
        try:
            # Waktu yang SAMA PERSIS dengan lapisan GFS, supaya slider satu
            # irama untuk semua lapisan dan tidak ada lagi yang harian.
            waktu = [run + dt.timedelta(hours=f) for f in fsteps]
            arus = olah_arus(waktu, lon_d, lat_d, darat, kredensial)
            print("  arus: %d bingkai per 3 jam" % len(arus))
        except Exception as e:
            print("  ARUS GAGAL: %s" % e, flush=True)

    lapis = {}
    for k in ("cape", "angin", "arus", "wave"):
        isi = dict(META[k]); isi["bounds"] = dict(BATAS)
        isi["frames"] = arus if k == "arus" else bingkai[k]
        lapis[k] = isi
    doc = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
        # `view` DIBIARKAN sama dengan domain. Frontend memang membaca bounds
        # lapisan, bukan ini, tapi versi lama masih memakainya jadi jangan
        # dihapus begitu saja.
        "view": dict(BATAS),
        "layers": lapis,
    }
    (KELUAR / "ocean.json").write_text(json.dumps(doc, indent=1))

    # hazard.json: daftar kisi kasar yang dipakai rute.js untuk menilai
    # potensi badai dan hujan di sepanjang jalur. Berkas INI yang menunjuk
    # cape_fXXX.json dan rain_fXXX.json, bukan ocean.json, jadi pembersih
    # apa pun harus membaca dua duanya sebelum menghapus.
    haz = {
        "generated": doc["generated"], "run": doc["run"], "now": doc["now"],
        "cape": {"label": "Potensi badai", "units": "J/kg", "source": "GFS CAPE",
                 "frames": [{"valid_time": f["valid_time"],
                             "grid": "cape_f%03d.json" % fs}
                            for f, fs in zip(bingkai["cape"], fsteps)]},
        "rain": {"label": "Hujan", "units": "mm/jam", "source": "GFS PRATE",
                 "frames": [{"valid_time": f["valid_time"],
                             "grid": "rain_f%03d.json" % fs}
                            for f, fs in zip(bingkai["cape"], fsteps)]},
    }
    (KELUAR / "hazard.json").write_text(json.dumps(haz, indent=1))
    print("selesai, %.0f detik, ocean.json + hazard.json ditulis" % (time.time() - t0))
    return doc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sampai", type=int, default=FSTEP_AKHIR)
    ap.add_argument("--langkah", type=int, default=FSTEP_LANGKAH)
    ap.add_argument("--kredensial", default=os.environ.get("CMEMS_INI"))
    ap.add_argument("--lewati-arus", action="store_true")
    a = ap.parse_args()
    bangun(sampai=a.sampai, langkah=a.langkah,
           kredensial=a.kredensial, lewati_arus=a.lewati_arus)

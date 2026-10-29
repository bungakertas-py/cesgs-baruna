/* ===================================================================
   fms.js — port dari model/fms.py
   Sumber kebenaran numerik tetap model/fms.py + model/vektor_emas.csv.
   Setiap perubahan di sini WAJIB lolos vektor emas.
   Rujukan: spec/metode-perhitungan.pdf versi 0.2
   =================================================================== */
(function (global) {
  "use strict";

  var KNOT = 0.5144, RHO_LAUT = 1025.0, RHO_UDARA = 1.225,
      GRAVITASI = 9.81, CF_VLSFO = 3.151;

  /* Kapal acuan — identik dengan JATRA1 dan KARGO di fms.py */
  var KAPAL = {
    feri:  { nama:"Feri ro-pax (acuan)",   L_BWL:85,  B:15.6, V0:12, FOC0:8,  SFOC:190, eta_D:0.60, A_T:200, C_X:0.8 },
    kargo: { nama:"Kargo pantai (acuan)",  L_BWL:100, B:18.0, V0:12, FOC0:22, SFOC:185, eta_D:0.62, A_T:250, C_X:0.8 }
  };

  var HARGA = { bunker: 600, kurs: 16300, sewa: 6000, rho_bahan: 0.985 };

  /* ---------- L1 ---------- */
  function dayaDinas(k) { return (k.FOC0 * 1e6 / 24) / k.SFOC; }              // kW
  function hambatanTenang(k) { return dayaDinas(k) * 1000 * k.eta_D / (k.V0 * KNOT); }  // N

  /* ---------- L2 ---------- */
  function hambatanGelombang(k, Hs) {
    return (1 / 16) * RHO_LAUT * GRAVITASI * Hs * Hs * k.B * Math.sqrt(k.B / k.L_BWL);
  }
  function hambatanAngin(k, U10) {
    var Urel = U10 + k.V0 * KNOT;
    return 0.5 * RHO_UDARA * k.C_X * k.A_T * Urel * Urel;
  }

  /* ---------- L4 ---------- */
  function lajuRelatifBebas(r) {                 // selesaikan x^3 + r x = 1
    var bawah = 0.01, atas = 1.0, tengah;
    for (var i = 0; i < 100; i++) {
      tengah = (bawah + atas) / 2;
      if (tengah * tengah * tengah + r * tengah < 1) bawah = tengah; else atas = tengah;
    }
    return (bawah + atas) / 2;
  }

  /* ---------- satu segmen ---------- */
  function segmen(k, cuaca, eta) {
    var Rt = hambatanTenang(k),
        Rg = hambatanGelombang(k, cuaca.Hs),
        Ra = hambatanAngin(k, cuaca.U10),
        r  = (Rg + Ra) / Rt,
        x  = 1 - (1 - lajuRelatifBebas(r)) * (1 - eta),
        stw = x * k.V0,
        sog = Math.max(stw + cuaca.arus, 0.1);
    return {
      r: r, x: x, R_tenang: Rt, R_gelombang: Rg, R_angin: Ra,
      stw: stw, sog: sog,
      laju_bbm: k.FOC0 * (x * x * x + r * x)     // ton/hari
    };
  }

  /* ---------- integrasi sepanjang rute (Metode v0.2 §9) ----------
     titik: [{d: jarak_kumulatif_nm, hs, angin_ms, arus_kn}, ...]      */
  function hitungRute(k, titik, eta, harga) {
    harga = harga || HARGA;
    if (!titik || titik.length < 2) return null;

    var jam = 0, bbm_ton = 0, rincian = [], i, s, d_i, jam_i;

    for (i = 1; i < titik.length; i++) {
      d_i = titik[i].d - titik[i - 1].d;
      if (!(d_i > 0)) continue;
      /* kondisi segmen = rata-rata dua ujungnya */
      s = segmen(k, {
        Hs:   (titik[i].hs + titik[i - 1].hs) / 2,
        U10:  (titik[i].angin_ms + titik[i - 1].angin_ms) / 2,
        arus: (titik[i].arus_kn + titik[i - 1].arus_kn) / 2
      }, eta);
      jam_i = d_i / s.sog;
      jam += jam_i;
      bbm_ton += s.laju_bbm * jam_i / 24;
      rincian.push({ dari: titik[i - 1].d, ke: titik[i].d, d: d_i, jam: jam_i,
                     r: s.r, sog: s.sog, bbm: s.laju_bbm * jam_i / 24 });
    }

    var D = titik[titik.length - 1].d - titik[0].d,
        jam_acuan = D / k.V0,
        dF = bbm_ton - k.FOC0 * jam_acuan / 24,
        dt = jam - jam_acuan,
        rp_bunker = dF * harga.bunker * harga.kurs,
        rp_telat  = dt * (harga.sewa / 24) * harga.kurs;

    return {
      jarak_nm: D, jam: jam, jam_acuan: jam_acuan,
      over_bunker_ton: dF,
      over_bunker_liter: dF * 1000 / harga.rho_bahan,
      telat_jam: dt,
      co2_ton: dF * CF_VLSFO,
      rp_bunker: rp_bunker, rp_telat: rp_telat, rp_total: rp_bunker + rp_telat,
      r_maks: rincian.length ? Math.max.apply(null, rincian.map(function (z) { return z.r; })) : 0,
      r_rata: rincian.length ? rincian.reduce(function (a, z) { return a + z.r; }, 0) / rincian.length : 0,
      segmen: rincian
    };
  }

  global.FMS = {
    KAPAL: KAPAL, HARGA: HARGA, KNOT: KNOT,
    dayaDinas: dayaDinas, hambatanTenang: hambatanTenang,
    hambatanGelombang: hambatanGelombang, hambatanAngin: hambatanAngin,
    lajuRelatifBebas: lajuRelatifBebas, segmen: segmen, hitungRute: hitungRute
  };
})(window);

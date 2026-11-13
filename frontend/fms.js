/* ===================================================================
   fms.js  Mesin hitung dampak finansial cuaca.

   LINGKUP DIPERSEMPIT 13 November 2026, keputusan pemilik. Rantainya
   sekarang pendek dan cuma satu:

       kondisi laut  ->  rasio hambatan tambahan r
                     ->  tambahan BBM (over-bunker, ton)
                     ->  biaya BBM (rupiah)

   Satu jenis pelayaran saja, FERI PENUMPANG, dan feri MENJAGA JADWAL.
   Itu sebabnya tidak ada lagi susut kecepatan maupun setelan strategi:
   kapal tidak melambat, mesinnya yang menambah daya.

   YANG SENGAJA DIBUANG dan jangan dihidupkan lagi tanpa aba aba:
   keterlambatan, keadaan tertahan, biaya sewa atau charter, pendapatan
   hilang, dan percabangan boleh berlayar atau tidak.

   CAPE dan ambang keselamatan BUKAN urusan berkas ini. Keduanya
   notifikasi risiko fisik di peta, tanpa angka rupiah.

   Rujukan rumus: Slide-Metode-Finansial.tex bagian Alur Metode.
   =================================================================== */
(function (global) {
  "use strict";

  var KNOT = 0.5144, RHO_LAUT = 1025.0, RHO_UDARA = 1.225,
      GRAVITASI = 9.81, CF_VLSFO = 3.151;

  /* Kapal acuan. KMP Jatra 1 dipakai sebagai contoh di dokumen metode. */
  var KAPAL = {
    feri: { nama: "Feri ro-pax (acuan)", L_BWL: 85, B: 15.6, V0: 12, FOC0: 8,
            SFOC: 190, eta_D: 0.60, A_T: 200, C_X: 0.8 }
  };

  /* Harga sewa DIBUANG bersama keterlambatan. */
  var HARGA = { bunker: 600, kurs: 16300, rho_bahan: 0.985 };

  /* ---------- hambatan air tenang ---------- */
  function dayaDinas(k) { return (k.FOC0 * 1e6 / 24) / k.SFOC; }                       // kW
  function hambatanTenang(k) { return dayaDinas(k) * 1000 * k.eta_D / (k.V0 * KNOT); } // N

  /* ---------- hambatan tambahan dari cuaca ---------- */
  function hambatanGelombang(k, Hs) {   // STAWAVE-1, naik kuadrat terhadap Hs
    return (1 / 16) * RHO_LAUT * GRAVITASI * Hs * Hs * k.B * Math.sqrt(k.B / k.L_BWL);
  }
  function hambatanAngin(k, U10) {      // angin relatif = angin sebenarnya + laju kapal
    var Urel = U10 + k.V0 * KNOT;
    return 0.5 * RHO_UDARA * k.C_X * k.A_T * Urel * Urel;
  }

  /* ---------- satu segmen ----------
     Feri menjaga jadwal, jadi laju terhadap air TETAP di kecepatan dinas.
     Arus tidak masuk rasio hambatan, dia cuma menggeser laju terhadap
     dasar laut sehingga mengubah durasi. */
  function segmen(k, cuaca) {
    var Rt = hambatanTenang(k),
        Rg = hambatanGelombang(k, cuaca.Hs),
        Ra = hambatanAngin(k, cuaca.U10),
        r  = (Rg + Ra) / Rt,
        sog = Math.max(k.V0 + cuaca.arus, 0.1);
    return {
      r: r, R_tenang: Rt, R_gelombang: Rg, R_angin: Ra,
      stw: k.V0, sog: sog,
      laju_bbm: k.FOC0 * (1 + r)      // ton/hari
    };
  }

  /* ---------- sepanjang satu pelayaran ----------
     titik: [{d: jarak_kumulatif_nm, hs, angin_ms, arus_kn}, ...] */
  function hitungRute(k, titik, harga) {
    harga = harga || HARGA;
    if (!titik || titik.length < 2) return null;

    var jam = 0, bbm_ton = 0, over_ton = 0, rincian = [], i, s, d_i, jam_i, ov_i;

    for (i = 1; i < titik.length; i++) {
      d_i = titik[i].d - titik[i - 1].d;
      if (!(d_i > 0)) continue;
      /* kondisi segmen = rata rata dua ujungnya */
      s = segmen(k, {
        Hs:   (titik[i].hs + titik[i - 1].hs) / 2,
        U10:  (titik[i].angin_ms + titik[i - 1].angin_ms) / 2,
        arus: (titik[i].arus_kn + titik[i - 1].arus_kn) / 2
      });
      jam_i = d_i / s.sog;
      /* over-bunker = konsumsi acuan x rasio hambatan x durasi/24.
         Dihitung PER SEGMEN, bukan dengan membandingkan total terhadap
         pelayaran ideal. Cara lama ikut menghitung selisih durasi akibat
         arus sebagai kalau kalau boros, padahal arus bukan hambatan. */
      ov_i = k.FOC0 * s.r * jam_i / 24;
      jam += jam_i;
      bbm_ton += s.laju_bbm * jam_i / 24;
      over_ton += ov_i;
      rincian.push({ dari: titik[i - 1].d, ke: titik[i].d, d: d_i, jam: jam_i,
                     r: s.r, sog: s.sog, bbm: s.laju_bbm * jam_i / 24, over: ov_i,
                     rp: ov_i * harga.bunker * harga.kurs });
    }

    var D = titik[titik.length - 1].d - titik[0].d,
        rp_bunker = over_ton * harga.bunker * harga.kurs;

    return {
      jarak_nm: D, jam: jam, jam_acuan: D / k.V0,
      bbm_ton: bbm_ton,
      over_bunker_ton: over_ton,
      over_bunker_liter: over_ton * 1000 / harga.rho_bahan,
      co2_ton: over_ton * CF_VLSFO,
      rp_bunker: rp_bunker,
      rp_total: rp_bunker,            // tinggal satu pos biaya
      r_maks: rincian.length ? Math.max.apply(null, rincian.map(function (z) { return z.r; })) : 0,
      r_rata: rincian.length ? rincian.reduce(function (a, z) { return a + z.r; }, 0) / rincian.length : 0,
      segmen: rincian
    };
  }

  global.FMS = {
    KAPAL: KAPAL, HARGA: HARGA, KNOT: KNOT, CF_VLSFO: CF_VLSFO,
    dayaDinas: dayaDinas, hambatanTenang: hambatanTenang,
    hambatanGelombang: hambatanGelombang, hambatanAngin: hambatanAngin,
    segmen: segmen, hitungRute: hitungRute
  };
})(window);

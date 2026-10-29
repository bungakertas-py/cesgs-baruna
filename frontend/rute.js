/* ===================================================================
   rute.js  Mode "Rute & Dampak Pelayaran" untuk CESGS Baruna (MVP)
   "Google Maps buat kapal". Pilih pelabuhan asal dan tujuan plus profil
   kapal, lalu muncul kartu tiap jalur dengan biaya total (dasar plus
   rugi cuaca). Jalur aman termurah dapat cap Rekomendasi. Kalau semua
   tak aman, status Tertahan.

   Jalur = A* di atas mask darat-laut (ujung pas di pelabuhan, ga nembus darat).
   Cuaca ASLI disampel di sepanjang jalur: ombak GFS-Wave, angin GFS, arus CMEMS
   (dari ocean.json velocity grid). Mesin hitung fms.js (tervalidasi).
   Overlay, tidak mengubah logika utama.
   =================================================================== */
(function () {
  "use strict";
  var KNOT = 0.5144;
  var map = window.BARUNA_MAP;
  var RUTEDB = null;   // database jalur laut real (data/rute/real_routes.json)
  var GRAPH = null;   // jaringan laut real (adjacency) buat pathfinding Dijkstra

  /* ---- daftar pelabuhan Indonesia (nama + koordinat) ---- */
  var PORTS = [
    { id:"batam",    nama:"Batam (Batu Ampar)",        ll:[1.08,104.03] },
    { id:"jakarta",  nama:"Jakarta (Tanjung Priok)",    ll:[-6.10,106.88] },
    { id:"surabaya", nama:"Surabaya (Tanjung Perak)",   ll:[-7.20,112.73] },
    { id:"semarang", nama:"Semarang (Tanjung Emas)",    ll:[-6.95,110.42] },
    { id:"belawan",  nama:"Medan (Belawan)",            ll:[3.79,98.68] },
    { id:"makassar", nama:"Makassar (Soekarno-Hatta)",  ll:[-5.12,119.41] },
    { id:"balikpapan",nama:"Balikpapan (Semayang)",     ll:[-1.27,116.81] },
    { id:"banjarmasin",nama:"Banjarmasin (Trisakti)",   ll:[-3.33,114.57] },
    { id:"pontianak",nama:"Pontianak (Dwikora)",        ll:[-0.02,109.34] },
    { id:"bitung",   nama:"Bitung",                     ll:[1.44,125.19] },
    { id:"ambon",    nama:"Ambon",                      ll:[-3.69,128.18] },
    { id:"sorong",   nama:"Sorong",                     ll:[-0.88,131.25] },
    { id:"jayapura", nama:"Jayapura",                   ll:[-2.53,140.72] },
    { id:"kupang",   nama:"Kupang (Tenau)",             ll:[-10.22,123.55] },
    { id:"benoa",    nama:"Benoa (Bali)",               ll:[-8.75,115.21] },
    { id:"tgpinang", nama:"Tanjung Pinang",             ll:[0.92,104.45] },
    { id:"dumai",    nama:"Dumai",                      ll:[1.67,101.45] },
    { id:"padang",   nama:"Padang (Teluk Bayur)",       ll:[-1.00,100.37] },
    { id:"palembang",nama:"Palembang (Boom Baru)",      ll:[-2.98,104.77] },
    { id:"panjang",  nama:"Lampung (Panjang)",          ll:[-5.47,105.32] },
    { id:"cirebon",  nama:"Cirebon",                    ll:[-6.71,108.57] },
    { id:"lembar",   nama:"Lombok (Lembar)",            ll:[-8.73,116.07] },
    { id:"maumere",  nama:"Maumere",                    ll:[-8.61,122.21] },
    { id:"ternate",  nama:"Ternate",                    ll:[0.79,127.38] },
    { id:"kendari",  nama:"Kendari",                    ll:[-3.97,122.57] },
    { id:"parepare", nama:"Pare-pare",                  ll:[-4.01,119.62] },
    { id:"gorontalo",nama:"Gorontalo",                  ll:[0.51,123.06] },
    { id:"tarakan",  nama:"Tarakan",                    ll:[3.29,117.59] },
    { id:"sampit",   nama:"Sampit",                     ll:[-2.53,112.95] },
    { id:"merauke",  nama:"Merauke",                    ll:[-8.49,140.40] },
    { id:"sabang",   nama:"Sabang",                     ll:[5.89,95.32] }
  ];
  function portById(id) { for (var i=0;i<PORTS.length;i++) if (PORTS[i].id===id) return PORTS[i]; return PORTS[0]; }

  /* ---- jenis kapal + nilai bawaan (taksiran kelas, boleh diedit) ---- */
  var JENIS = [
    { id:"feri",     nama:"Feri Ro-Pax (penyeberangan)", L_BWL:85,  B:15.6, T:3.8,  C_B:0.60, V0:12, FOC0:8,   SFOC:190, eta_D:0.60, A_T:200, C_X:0.8,  amb:{hs:2.5,angin:21} },
    { id:"penumpang",nama:"Kapal Penumpang (Pelni)",     L_BWL:140, B:23.0, T:6.0,  C_B:0.60, V0:18, FOC0:45,  SFOC:185, eta_D:0.64, A_T:700, C_X:0.9,  amb:{hs:2.5,angin:21} },
    { id:"kargo",    nama:"Kargo Umum",                  L_BWL:100, B:18.0, T:5.5,  C_B:0.75, V0:12, FOC0:22,  SFOC:185, eta_D:0.62, A_T:250, C_X:0.8,  amb:{hs:4.0,angin:27} },
    { id:"petikemas",nama:"Peti Kemas (feeder)",         L_BWL:140, B:23.0, T:8.0,  C_B:0.65, V0:16, FOC0:40,  SFOC:180, eta_D:0.65, A_T:500, C_X:0.9,  amb:{hs:4.0,angin:27} },
    { id:"tanker",   nama:"Tanker",                      L_BWL:160, B:27.0, T:10.0, C_B:0.80, V0:13, FOC0:35,  SFOC:180, eta_D:0.64, A_T:350, C_X:0.85, amb:{hs:4.0,angin:27} },
    { id:"curah",    nama:"Kapal Curah (bulk)",          L_BWL:170, B:27.0, T:10.0, C_B:0.82, V0:13, FOC0:32,  SFOC:180, eta_D:0.63, A_T:320, C_X:0.85, amb:{hs:4.0,angin:27} },
    { id:"tongkang", nama:"Tongkang (ditarik tunda)",    L_BWL:90,  B:24.0, T:4.0,  C_B:0.90, V0:6,  FOC0:6,   SFOC:200, eta_D:0.55, A_T:150, C_X:1.0,  amb:{hs:1.5,angin:16} },
    { id:"tunda",    nama:"Kapal Tunda (tugboat)",       L_BWL:28,  B:9.0,  T:4.0,  C_B:0.58, V0:11, FOC0:5,   SFOC:200, eta_D:0.50, A_T:60,  C_X:0.9,  amb:{hs:1.5,angin:16} },
    { id:"ikan",     nama:"Kapal Ikan",                  L_BWL:25,  B:6.0,  T:2.5,  C_B:0.55, V0:9,  FOC0:1.2, SFOC:210, eta_D:0.52, A_T:40,  C_X:0.8,  amb:{hs:1.25,angin:15} },
    { id:"lain",     nama:"Lainnya (isi manual)",        L_BWL:100, B:18.0, T:5.0,  C_B:0.70, V0:12, FOC0:15,  SFOC:190, eta_D:0.60, A_T:250, C_X:0.85, amb:{hs:2.5,angin:21} }
  ];
  function jenisById(id) { for (var i=0;i<JENIS.length;i++) if (JENIS[i].id===id) return JENIS[i]; return JENIS[0]; }

  /* ---- geo + cuaca sintetis (deterministik) ---- */
  function nm(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b[0]-a[0])*toR, dLon = (b[1]-a[1])*toR;
    var la1 = a[0]*toR, la2 = b[0]*toR;
    var h = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return (2*R*Math.asin(Math.sqrt(h))) / 1.852;
  }
  function hash01(x, y) { var s = Math.sin(x*12.9898 + y*78.233) * 43758.5453; return s - Math.floor(s); }

  /* ---- Cuaca ASLI: sampel grid velocity (wave=Hs, angin=wind, arus=current) ---- */
  var WX = { loaded: false, wave: null, angin: null, arus: null, cape: null, rain: null,
             capeFrames: [], rainFrames: [], baseT: 0, lastT: 0 };
  function frameTms(f) {
    if (f && f.valid_time) return Date.parse(f.valid_time);
    if (f && f.date) return Date.UTC(+f.date.slice(0,4), +f.date.slice(4,6)-1, +f.date.slice(6,8), 12);
    return 0;
  }
  function pickFrame(lay, nowT) {
    if (!lay || !lay.frames || !lay.frames.length) return null;
    var t = Date.parse(nowT) || Date.now(), best = lay.frames[0], bd = Infinity;
    lay.frames.forEach(function (f) { var dd = Math.abs(frameTms(f) - t); if (dd < bd) { bd = dd; best = f; } });
    return best;
  }
  function loadGrid(vec) {
    return fetch("data/output/" + vec.split("?")[0], { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (j) { var h = j[0].header; return { nx:h.nx, ny:h.ny, lo1:h.lo1, la1:h.la1, dx:h.dx, dy:h.dy, u:j[0].data, v:j[1].data }; });
  }
  function loadScalarGrid(file) {
    return fetch("data/output/" + file.split("?")[0], { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (j) { var h = j.header; return { nx:h.nx, ny:h.ny, lo1:h.lo1, la1:h.la1, dx:h.dx, dy:h.dy, data:j.data }; });
  }
  function noop() {}
  function loadWx(cb) {
    if (WX.loaded) { if (cb) cb(); return; }
    var pOcean = fetch("data/output/ocean.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (oc) {
      return Promise.all(["wave", "angin", "arus"].map(function (k) {
        var f = pickFrame(oc.layers[k], oc.now); if (!f || !f.vec) return Promise.resolve();
        return loadGrid(f.vec).then(function (g) { WX[k] = g; }).catch(function () { WX[k] = null; });
      }));
    }).catch(noop);
    /* hazard.json: potensi badai (CAPE) + hujan (mm/jam). Muat SEMUA frame (per 12 jam)
       biar bisa tahu KAPAN kapal lewat zona (ETA) -> sampel frame waktu itu. */
    var pHaz = fetch("data/output/hazard.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (hz) {
      WX.baseT = Date.parse(hz.now) || Date.now();
      function loadFrames(frames) {
        frames = (frames || []).filter(function (f) { return f && f.grid; });
        return Promise.all(frames.map(function (f) {
          return loadScalarGrid(f.grid).then(function (g) { return { t: frameTms(f), g: g }; }).catch(function () { return null; });
        })).then(function (arr) { return arr.filter(Boolean).sort(function (a, b) { return a.t - b.t; }); });
      }
      return Promise.all([
        loadFrames(hz.cape && hz.cape.frames).then(function (fr) { WX.capeFrames = fr; }),
        loadFrames(hz.rain && hz.rain.frames).then(function (fr) { WX.rainFrames = fr; })
      ]).then(function () {
        WX.lastT = Math.max(WX.capeFrames.length ? WX.capeFrames[WX.capeFrames.length-1].t : 0,
                            WX.rainFrames.length ? WX.rainFrames[WX.rainFrames.length-1].t : 0);
        WX.cape = pickFrameGrid(WX.capeFrames, WX.baseT);   // frame now buat sampel instan (kartu)
        WX.rain = pickFrameGrid(WX.rainFrames, WX.baseT);
      });
    }).catch(noop);
    Promise.all([pOcean, pHaz]).then(function () { WX.loaded = true; if (cb) cb(); });
  }
  function sampleScalar(g, lat, lon) {
    if (!g) return 0;
    var fx = (lon - g.lo1) / g.dx, fy = (g.la1 - lat) / g.dy;
    if (fx < 0 || fx > g.nx - 1 || fy < 0 || fy > g.ny - 1) return 0;
    var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0+1, g.nx-1), y1 = Math.min(y0+1, g.ny-1);
    var tx = fx - x0, ty = fy - y0, d = g.data;
    return d[y0][x0]*(1-tx)*(1-ty) + d[y0][x1]*tx*(1-ty) + d[y1][x0]*(1-tx)*ty + d[y1][x1]*tx*ty;
  }
  /* ---- time-aware: pilih frame terdekat ke waktu t, lalu sampel bilinear ---- */
  function nearestFrame(frames, t) {
    if (!frames || !frames.length) return null;
    var best = frames[0], bd = Infinity;
    for (var i = 0; i < frames.length; i++) { var dd = Math.abs(frames[i].t - t); if (dd < bd) { bd = dd; best = frames[i]; } }
    return best;
  }
  function pickFrameGrid(frames, t) { var f = nearestFrame(frames, t); return f ? f.g : null; }
  function sampleScalarAt(frames, lat, lon, t) {
    var f = nearestFrame(frames, t); return f ? sampleScalar(f.g, lat, lon) : 0;
  }
  /* zona spasial SEBENARNYA: sel grid CAPE/hujan yang >= ambang dan NYAMBUNG ke titik
     puncak (flood-fill 4-arah). Dikembalikan apa adanya (kotak per sel) -> bentuk ikut
     data, bukan lingkaran. Resolusi sel = grid (dx,dy ~0.5deg). */
  function hazZoneCells(frames, lat, lon, t, lo) {
    var f = nearestFrame(frames, t); if (!f) return null;
    var g = f.g, nx = g.nx, ny = g.ny, d = g.data;
    var cx = Math.round((lon - g.lo1) / g.dx), cy = Math.round((g.la1 - lat) / g.dy);
    var start = null;   // cari sel awal >= ambang dekat puncak
    for (var r = 0; r <= 3 && !start; r++)
      for (var ddy = -r; ddy <= r && !start; ddy++)
        for (var ddx = -r; ddx <= r; ddx++) {
          var x = cx + ddx, y = cy + ddy;
          if (x >= 0 && x < nx && y >= 0 && y < ny && d[y][x] >= lo) { start = [x, y]; break; }
        }
    if (!start) return null;
    var seen = {}, stack = [start], cells = [];
    while (stack.length && cells.length < 4000) {
      var c = stack.pop(), xx = c[0], yy = c[1], key = yy * nx + xx;
      if (seen[key]) continue; seen[key] = 1;
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || d[yy][xx] < lo) continue;
      cells.push([xx, yy]);
      stack.push([xx+1, yy], [xx-1, yy], [xx, yy+1], [xx, yy-1]);
    }
    var rects = [], area = 0, minLat = 1e9, maxLat = -1e9, minLon = 1e9, maxLon = -1e9;
    cells.forEach(function (cc) {
      var lonc = g.lo1 + cc[0] * g.dx, latc = g.la1 - cc[1] * g.dy;
      var la0 = latc - g.dy/2, la1c = latc + g.dy/2, lo0 = lonc - g.dx/2, lo1c = lonc + g.dx/2;
      rects.push([[la0, lo0], [la1c, lo1c]]);
      area += (g.dy * 111) * (g.dx * 111 * Math.cos(latc * Math.PI/180));
      if (la0 < minLat) minLat = la0; if (la1c > maxLat) maxLat = la1c;
      if (lo0 < minLon) minLon = lo0; if (lo1c > maxLon) maxLon = lo1c;
    });
    return { rects: rects, ncell: cells.length, areaKm2: area,
             widthKm: (maxLon - minLon) * 111 * Math.cos(lat * Math.PI/180), heightKm: (maxLat - minLat) * 111 };
  }
  var HARI = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"], BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  function waktuStr(ms) {   // tampil waktu lokal WIB (UTC+7)
    var d = new Date(ms + 7 * 3600 * 1000);
    var hh = ("0" + d.getUTCHours()).slice(-2), mm = ("0" + d.getUTCMinutes()).slice(-2);
    return HARI[d.getUTCDay()] + " " + d.getUTCDate() + " " + BULAN[d.getUTCMonth()] + " " + hh + "." + mm + " WIB";
  }
  function sampleVec(g, lat, lon) {
    if (!g) return { u: 0, v: 0 };
    var fx = (lon - g.lo1) / g.dx, fy = (g.la1 - lat) / g.dy;
    if (fx < 0 || fx > g.nx - 1 || fy < 0 || fy > g.ny - 1) return { u: 0, v: 0 };
    var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0+1, g.nx-1), y1 = Math.min(y0+1, g.ny-1);
    var tx = fx - x0, ty = fy - y0;
    function bil(a) {
      return a[y0*g.nx+x0]*(1-tx)*(1-ty) + a[y0*g.nx+x1]*tx*(1-ty) + a[y1*g.nx+x0]*(1-tx)*ty + a[y1*g.nx+x1]*tx*ty;
    }
    return { u: bil(g.u), v: bil(g.v) };
  }
  function headingDeg(a, b) {
    return Math.atan2((b[1]-a[1]) * Math.cos(a[0]*Math.PI/180), (b[0]-a[0])) * 180 / Math.PI;
  }
  function wxAt(lat, lon, hdg) {
    if (WX.wave || WX.angin || WX.arus) {                      // DATA ASLI
      var w = sampleVec(WX.wave, lat, lon), a = sampleVec(WX.angin, lat, lon), c = sampleVec(WX.arus, lat, lon);
      var hs = Math.hypot(w.u, w.v), angin = Math.hypot(a.u, a.v);
      var hr = (hdg || 0) * Math.PI / 180;
      var arus_kn = (c.u * Math.sin(hr) + c.v * Math.cos(hr)) * 1.94384;   // m/s arus searah haluan -> knot
      return { hs: +hs.toFixed(2), angin: +angin.toFixed(1), arus: +arus_kn.toFixed(2),
               cape: Math.round(sampleScalar(WX.cape, lat, lon)), rain: +sampleScalar(WX.rain, lat, lon).toFixed(1) };
    }
    /* fallback CONTOH kalau data gagal dimuat */
    var base = 0.9 + 1.3 * Math.abs(Math.sin(lat*0.6) * Math.cos(lon*0.45));
    var bump = 1.5 * hash01(Math.round(lat*2), Math.round(lon*2));
    var hs2 = Math.max(0.5, base + bump - 1.0);
    return { hs: +hs2.toFixed(1), angin: +(4 + hs2*2.6).toFixed(0), arus: +(-(0.15 + 0.3*hash01(lon, lat))).toFixed(2), cape: 0, rain: 0 };
  }
  function interpWP(a, b, n) {
    var pts = []; for (var i=0;i<=n;i++) { var t=i/n; pts.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); } return pts;
  }
  function offsetWP(wp, off) {
    var n = wp.length-1, a = wp[0], b = wp[n];
    var dLat = b[0]-a[0], dLon = b[1]-a[1], len = Math.hypot(dLat, dLon) || 1;
    var pLat = -dLon/len, pLon = dLat/len;
    return wp.map(function (p, i) { var t=i/n, bulge = Math.sin(Math.PI*t)*off; return [p[0]+pLat*bulge, p[1]+pLon*bulge]; });
  }
  function mkRoute(id, nama, wp) {
    var kondisi = wp.map(function (p, i) {
      var a = wp[Math.max(i-1, 0)], b = wp[Math.min(i+1, wp.length-1)];
      return wxAt(p[0], p[1], headingDeg(a, b));
    });
    return { id: id, nama: nama, wp: wp, kondisi: kondisi };
  }
  /* stopPorts = [asal, transit..., tujuan] (port objects, transit diinput user).
     Tiap ruas antar-stop dirangkai lewat jaringan real (Dijkstra). */
  function buildRoutes(stopPorts) {
    if (!GRAPH) buildGraph();
    var ids = [];
    stopPorts.forEach(function (p) { if (p && (!ids.length || ids[ids.length-1] !== p.id)) ids.push(p.id); });
    if (ids.length < 2) return [];
    var wp = [], nodes = [ids[0]];   // urutan pelabuhan LENGKAP yang dilewati (termasuk transit dari data)
    for (var i = 0; i < ids.length - 1; i++) {
      var edges = dijkstra(ids[i], ids[i+1]);
      if (!edges || !edges.length) return [];   // ada ruas yang tak nyambung
      edges.forEach(function (e, j) {
        var rec = RUTEDB.routes[e.key]; if (!rec || !rec.langsung) return;
        var seg = rec.langsung.wp.slice();
        if (e.rev) seg = seg.slice().reverse();
        wp = wp.concat(wp.length === 0 ? seg : seg.slice(1));
        nodes.push(e.to);   // tiap simpul yang dilewati Dijkstra = pelabuhan transit real
      });
    }
    if (wp.length < 2) return [];
    var nTransit = nodes.length - 2;
    var route = mkRoute("langsung", nTransit > 0 ? ("Rute via " + nTransit + " transit") : "Rute laut langsung", wp);
    route.stops = nodes;   // asal + semua pelabuhan transit real + tujuan
    return [ route ];
  }

  function siapkan(route, ambang) {
    var titik = [], d = 0, i, aman = true, titikBahaya = [];
    for (i = 0; i < route.wp.length; i++) {
      if (i > 0) d += nm(route.wp[i-1], route.wp[i]);
      var k = route.kondisi[i];
      titik.push({ d: d, hs: k.hs, angin_ms: k.angin, arus_kn: k.arus });
      if (k.hs > ambang.hs || k.angin > ambang.angin * KNOT) { aman = false; titikBahaya.push(i); }
    }
    return { titik: titik, aman: aman, titikBahaya: titikBahaya };
  }

  /* ---- STRATEGI/TAKTIK di jalur yang SAMA (laut cuma 1 jalur real) ----
     Tiap taktik (ubah kecepatan / tunda / transit lebih lama) menggeser WAKTU kapal
     lewat zona badai. Dihitung biaya operasi + risiko badai (Rp). Terendah = Rekomendasi. */
  function stopPositions(route) {   // posisi tiap pelabuhan singgah di sepanjang jalur (nm)
    var stops = route.stops || [], c = cumNm(route), out = [];
    stops.forEach(function (id) {
      var p = portById(id); if (!p) return;
      var best = 0, bd = Infinity;
      for (var i = 0; i < route.wp.length; i++) {
        var dd = (route.wp[i][0]-p.ll[0])*(route.wp[i][0]-p.ll[0]) + (route.wp[i][1]-p.ll[1])*(route.wp[i][1]-p.ll[1]);
        if (dd < bd) { bd = dd; best = i; }
      }
      out.push({ id: id, nama: p.nama, idx: best, nm: c[best] });
    });
    return out;
  }
  function evalStrategy(route, kapal, harga, eta, st) {
    var titik = route._titik, kap = {}; for (var kk in kapal) kap[kk] = kapal[kk];
    kap.V0 = st.speed;
    kap.FOC0 = kapal.FOC0 * Math.pow(st.speed / (kapal.V0 || st.speed), 3);   // laju BBM ~ pangkat tiga kecepatan
    var f = FMS.hitungRute(kap, titik, eta, harga);
    var bbm_ton = f.over_bunker_ton + kap.FOC0 * f.jam_acuan / 24;     // BBM nyata di kecepatan ini
    var rp_bbm = bbm_ton * harga.bunker * harga.kurs;
    var rp_sewa = f.jam * (harga.sewa / 24) * harga.kurs;
    var rp_tunda = (st.dwellH || 0) * (harga.sewa / 24) * harga.kurs;
    var rp_operasi = rp_bbm + rp_sewa + rp_tunda;
    var timing = { speed: st.speed, dwellH: st.dwellH, dwellNm: st.dwellNm };
    var risk = exposureRisk(route, timing, harga), hz = scanHazards(route, timing);
    var tiba = etaFn(route, timing)(route.wp.length - 1);
    return { st: st, f: f, bbm_ton: bbm_ton, rp_bbm: rp_bbm, rp_sewa: rp_sewa, rp_tunda: rp_tunda,
             rp_operasi: rp_operasi, risk: risk, rp_total: rp_operasi + risk.rp, hazards: hz,
             jam_total: f.jam + (st.dwellH || 0), tiba: tiba };
  }
  function buildStrategies(route, kapal, ambang, eta, harga) {
    cumNm(route);
    var sp = siapkan(route, ambang);
    route._sp = sp; route._titik = sp.titik;
    var V0 = kapal.V0 > 0 ? kapal.V0 : 12, cands = [];
    function add(label, kind, speed, dwellH, dwellNm, pel) {
      cands.push({ label: label, kind: kind, speed: +(speed).toFixed(1), dwellH: dwellH || 0, dwellNm: dwellNm || 0, pel: pel || "" });
    }
    add("Jalan normal " + V0.toFixed(0) + " kn", "normal", V0, 0, 0);
    [0.85, 0.7, 0.6].forEach(function (fac) { var s = V0 * fac; if (s >= 5) add("Kurangi kecepatan ke " + s.toFixed(1) + " kn", "slow", s, 0, 0); });
    if (V0 * 1.1 <= 25) add("Tambah kecepatan ke " + (V0*1.1).toFixed(1) + " kn", "fast", V0 * 1.1, 0, 0);
    [6, 12, 18, 24].forEach(function (h) { add("Tunda berangkat " + h + " jam", "delay", V0, h, 0); });
    // transit lebih lama: cari badai pertama, lalu pelabuhan singgah terakhir SEBELUM badai itu
    var hz0 = scanHazards(route, { speed: V0 }), badai0 = hz0.filter(function (z) { return z.type === "badai"; })
      .sort(function (a, b) { return a.t - b.t; })[0];
    if (badai0) {
      var c = cumNm(route), hazNm = c[badai0.i0], pos = stopPositions(route);
      var cand = null;
      pos.forEach(function (ps, k) { if (k > 0 && k < pos.length - 1 && ps.nm < hazNm - 5 && ps.nm > 0) cand = ps; });
      if (cand) [6, 12, 18].forEach(function (h) { add("Singgah " + h + " jam lebih lama di " + cand.nama, "dwell", V0, h, cand.nm, cand.nama); });
    }
    var evald = cands.map(function (st) { return evalStrategy(route, kapal, harga, eta, st); });
    evald.sort(function (a, b) { return a.rp_total - b.rp_total; });
    var maxRisk = Math.max.apply(null, evald.map(function (e) { return e.risk.rp; }));
    var normal = evald.filter(function (e) { return e.st.kind === "normal"; })[0];
    var best = evald[0];
    // rekomendasi = yang termurah, TAPI kalau hemat vs normal cuma tipis (<2%) ambil normal saja
    var rec = (best !== normal && (normal.rp_total - best.rp_total) < normal.rp_total * 0.02) ? normal : best;
    evald.forEach(function (e) { e.rekomendasi = (e === rec); });
    var display;
    if (!badai0 || maxRisk < normal.rp_operasi * 0.01) { display = [normal]; }
    else {
      display = [rec];
      if (normal !== rec) display.push(normal);
      if (best !== rec && best !== normal) display.push(best);
      evald.forEach(function (e) { if (display.length < 5 && display.indexOf(e) < 0) display.push(e); });
    }
    return { list: display, semua: evald, best: rec, badaAda: !!badai0 };
  }

  /* ---- format ---- */
  function rp(x) {
    var v = Math.round(x);
    if (Math.abs(v) >= 1e9) return "Rp " + (v/1e9).toFixed(2) + " M";
    if (Math.abs(v) >= 1e6) return "Rp " + (v/1e6).toFixed(1) + " jt";
    return "Rp " + v.toLocaleString("id-ID");
  }
  function jamStr(j) { return j >= 24 ? j.toFixed(0) + " jam (" + (j/24).toFixed(1) + " hari)" : j.toFixed(1) + " jam"; }

  var KIND_ICON = { normal: "sailing", slow: "slow_motion_video", fast: "speed", delay: "schedule", dwell: "anchor" };
  function kartuHtml(e, base) {
    var st = e.st, cls = "rute-card" + (e.rekomendasi ? " rec" : "");
    var badge = e.rekomendasi ? '<span class="badge rt-rec">Rekomendasi</span>'
              : '<span class="badge rt-ok">Alternatif</span>';
    var ic = KIND_ICON[st.kind] || "sailing";
    var badaiMax = e.risk.maxCape >= HZ.badai.lo
        ? (e.risk.maxCape + " J/kg · " + e.risk.nStorm + " titik")
        : "aman";
    // penjelasan
    var stat;
    if (st.kind === "normal") {
      stat = e.risk.rp < 1000 ? "Cuaca aman sepanjang jalur. Jalan normal saja."
           : e.rekomendasi ? "Ada badai di jalur, tapi ubah kecepatan atau jadwal cuma hemat sedikit. Jalan normal sambil tetap waspada."
           : "Lewat zona badai tanpa ubah jadwal. Ini patokan risiko tertinggi.";
    } else {
      var dRisk = (base ? base.risk.rp : 0) - e.risk.rp, dCost = e.rp_operasi - (base ? base.rp_operasi : 0);
      var net = dRisk - dCost;
      var aksi = st.kind === "slow" ? "Pelan-pelan" : st.kind === "fast" ? "Ngebut"
               : st.kind === "delay" ? "Tunda berangkat" : "Singgah lebih lama";
      stat = aksi + " bikin kapal lewat badai pas lebih reda. Risiko turun " + rp(Math.max(dRisk,0)) +
             ", tambahan biaya " + rp(Math.max(dCost,0)) + ". " +
             (net > 0 ? "Net hemat " + rp(net) + "." : "Belum sepadan, net " + rp(net) + ".");
    }
    return '<div class="' + cls + '">' +
        '<div class="rc-top"><strong><span class="material-symbols-outlined rc-kind">' + ic + '</span>' + st.label + '</strong>' + badge + '</div>' +
        '<div class="rc-rugi">' + rp(e.rp_total) + '<span>perkiraan biaya operasi + risiko badai</span></div>' +
        '<div class="rc-grid">' +
          cel("Biaya operasi", rp(e.rp_operasi)) + cel("Risiko badai", rp(e.risk.rp)) +
          cel("Waktu total", jamStr(e.jam_total)) + cel("Tiba", e.tiba > WX.lastT + 1 ? "di luar prakiraan" : waktuStr(e.tiba)) +
          cel("Badai maks", badaiMax) + cel("Emisi CO2", e.f.co2_ton.toFixed(1) + " ton") +
        '</div>' +
        hazardHtml(e.hazards) +
        '<div class="rc-stat">' + stat + '</div></div>';
  }
  function routeHeaderHtml(route, jarakNm) {
    return '<div class="rc-routehead"><div class="rc-routehead-top"><span class="material-symbols-outlined">route</span>' +
      '<strong>' + route.nama + '</strong><span class="rc-routehead-km">' + jarakNm.toFixed(0) + ' nm</span></div>' +
      transitHtml(route) +
      '<div class="rc-routehead-note">Di laut jalurnya satu. Yang bisa diatur taktiknya kecepatan dan jadwal, biar lewat badai pas sudah reda.</div></div>';
  }
  function cel(k, v) { return '<div class="rc-cel"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function hazardHtml(hz) {
    if (!hz || !hz.length) return '<div class="rc-haz rc-haz-clear"><span class="material-symbols-outlined">check_circle</span>Tidak ada zona badai atau hujan di jalur</div>';
    var rows = hz.slice().sort(function (a, b) { return a.t - b.t; }).map(function (h) {
      var isB = h.type === "badai", ic = isB ? "bolt" : "rainy", cls = isB ? "rc-haz-badai" : "rc-haz-hujan";
      var jam = h.lewatPrakira ? "di luar jangkauan prakiraan" : h.waktu;
      return '<div class="rc-haz-row ' + cls + '">' +
        '<span class="material-symbols-outlined">' + ic + '</span>' +
        '<div class="rc-haz-txt"><b>' + h.label + ' <i>' + hazValStr(h) + '</i></b>' +
        '<span class="rc-haz-when"><span class="material-symbols-outlined">schedule</span>' + jam +
        '<span class="material-symbols-outlined">resize</span>' + hazSizeStr(h) + '</span></div></div>';
    }).join("");
    return '<div class="rc-haz"><span class="label-caps">Cuaca sepanjang jalur (perkiraan waktu tiba)</span>' +
           '<div class="rc-haz-rows">' + rows + '</div></div>';
  }
  function transitHtml(r) {
    var s = r.stops || [];
    if (s.length <= 2) return '';
    var mid = s.slice(1, -1).map(function (id) { return portById(id).nama; });
    return '<div class="rc-transit"><span class="label-caps">Singgah ' + mid.length + ' pelabuhan</span><div class="rc-transit-list">' +
      portById(s[0]).nama + ' <b>›</b> ' + mid.join(' <b>›</b> ') + ' <b>›</b> ' + portById(s[s.length-1]).nama + '</div></div>';
  }

  /* ---- marker pelabuhan (asal/tujuan = jangkar emas, transit = kapal + badge).
     SVG sementara; ganti ke icon isometric asli kalau zip-nya sudah ada (ICON_SHIP/ICON_ANCHOR). ---- */
  var ICON_SHIP = '<svg class="rm-svg" viewBox="0 0 64 44" width="42" height="29"><path d="M5 26h54l-7 12H12z" fill="#e05545"/><path d="M5 26h54l-2 4H7z" fill="#b93325"/><rect x="18" y="11" width="24" height="15" fill="#2d6cdf"/><rect x="18" y="11" width="24" height="3.5" fill="#4a86ff"/><rect x="22" y="5" width="11" height="7" fill="#eef2f7"/><rect x="43" y="16" width="10" height="10" fill="#5b9bf0"/></svg>';
  var ICON_ANCHOR = '<svg class="rm-svg" viewBox="0 0 24 24" width="30" height="30"><g fill="none" stroke="#f3c13a" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2.2"/><line x1="12" y1="6.2" x2="12" y2="20.5"/><line x1="7.4" y1="10" x2="16.6" y2="10"/><path d="M4.5 13A7.5 7.5 0 0 0 12 20.5 7.5 7.5 0 0 0 19.5 13"/><path d="M4.5 13 2.8 11M19.5 13 21.2 11"/></g></svg>';
  function portMarker(p, kind) {
    var isT = kind === "transit";
    var badge = isT ? '<span class="rm-badge">TRANSIT</span>'
                    : '<span class="rm-badge rm-badge-gold">' + (kind === "asal" ? "ASAL" : "TUJUAN") + '</span>';
    var html = '<div class="rm ' + (isT ? "rm-t" : "rm-e") + '">' + badge + '<span class="rm-name">' + p.nama + '</span>' + (isT ? ICON_SHIP : ICON_ANCHOR) + '</div>';
    var ic = L.divIcon({ className: "rm-wrap", html: html, iconSize: [160, 58], iconAnchor: [80, isT ? 55 : 52] });
    return L.marker(p.ll, { icon: ic, interactive: true, riseOnHover: true });
  }

  /* ---- fenomena cuaca sepanjang jalur: potensi badai (CAPE) + hujan (mm/jam) ---- */
  var HZ = {
    badai: { field: "cape", lo: 1000, hi: 2500, unit: "J/kg",
             lbl: function (v) { return v >= 2500 ? "Badai kuat" : "Potensi badai"; } },
    hujan: { field: "rain", lo: 2, hi: 10, unit: "mm/jam",
             lbl: function (v) { return v >= 20 ? "Hujan sangat lebat" : (v >= 10 ? "Hujan lebat" : "Hujan"); } }
  };
  function ICON_BADAI(strong) {
    var cloud = strong ? "#5b6472" : "#8a94a6";
    return '<svg class="hz-svg" viewBox="0 0 48 48" width="34" height="34">' +
      '<path d="M14 31a8 8 0 0 1 .6-15.9A11 11 0 0 1 36 17a7 7 0 0 1-1 14H14z" fill="' + cloud + '"/>' +
      '<path d="M26 20l-9 13h6l-2 10 11-15h-6l3-8z" fill="#ffd21a" stroke="#9a5a00" stroke-width="1" stroke-linejoin="round"/></svg>';
  }
  function ICON_HUJAN(strong) {
    var drop = strong ? "#1f7ae0" : "#4aa3f0";
    return '<svg class="hz-svg" viewBox="0 0 48 48" width="34" height="34">' +
      '<path d="M14 27a8 8 0 0 1 .6-15.9A11 11 0 0 1 36 13a7 7 0 0 1-1 14H14z" fill="#aeb9c6"/>' +
      '<g fill="' + drop + '" stroke="' + drop + '" stroke-width="1"><path d="M16 31l-2.4 6.5h4.8z"/><path d="M24 32l-2.4 6.5h4.8z"/><path d="M32 31l-2.4 6.5h4.8z"/></g></svg>';
  }
  function hzFrames(type) { return type === "badai" ? WX.capeFrames : WX.rainFrames; }
  /* jarak kumulatif (nm) tiap titik rute, di-cache di route._cum */
  function cumNm(route) {
    if (route._cum) return route._cum;
    var c = [0]; for (var i = 1; i < route.wp.length; i++) c[i] = c[i-1] + nm(route.wp[i-1], route.wp[i]);
    route._cum = c; return c;
  }
  /* ETA tiap titik (ms) untuk satu taktik: berangkat baseT, kecepatan speed, plus
     jeda dwellH jam yang mulai berlaku setelah melewati titik dwellNm (nm). */
  function etaFn(route, timing) {
    var c = cumNm(route), v = (timing && timing.speed) > 0 ? timing.speed : 12;
    var dh = ((timing && timing.dwellH) || 0) * 3600 * 1000, dn = (timing && timing.dwellNm) || 0;
    return function (i) { return WX.baseT + (c[i] / v) * 3600 * 1000 + (c[i] > dn ? dh : 0); };
  }
  /* time-aware: sampel badai/hujan di SETIAP titik pada WAKTU kapal lewat titik itu.
     Lalu kelompokkan jadi zona kontigu, tiap zona dapat puncak, waktu tiba, panjang,
     dan footprint spasial (sel grid). timing = {speed, dwellH, dwellNm}. */
  function scanHazards(route, timing) {
    if (typeof timing === "number") timing = { speed: timing };   // kompat lama
    var out = [], wp = route.wp, n = wp.length, c = cumNm(route), eta = etaFn(route, timing || { speed: 12 });
    Object.keys(HZ).forEach(function (type) {
      var cfg = HZ[type], frames = hzFrames(type);
      if (!frames || !frames.length) return;
      var vals = wp.map(function (p, i) { return sampleScalarAt(frames, p[0], p[1], eta(i)); });
      var i = 0;
      while (i < n) {
        if (vals[i] >= cfg.lo) {
          var j = i, peak = i;
          while (j < n && vals[j] >= cfg.lo) { if (vals[j] > vals[peak]) peak = j; j++; }
          var i1 = j - 1, tPeak = eta(peak);
          var spanKm = (c[i1] - c[i]) * 1.852;
          var zone = hazZoneCells(frames, wp[peak][0], wp[peak][1], tPeak, cfg.lo);
          out.push({ type: type, val: vals[peak], ll: wp[peak], strong: vals[peak] >= cfg.hi,
                     label: cfg.lbl(vals[peak]), unit: cfg.unit,
                     i0: i, i1: i1, spanKm: spanKm, zone: zone,
                     t: tPeak, waktu: waktuStr(tPeak), lewatPrakira: tPeak > WX.lastT + 1,
                     seg: wp.slice(i, j) });
          i = j;
        } else i++;
      }
    });
    return out;
  }
  /* RISIKO BADAI (Rp): makin kuat CAPE + makin lama di dalamnya, makin besar risiko.
     Patokan biaya = kelipatan sewa kapal per jam (K). Jujur ini PERKIRAAN, bukan klaim pasti. */
  var RISK_K = 3;   // 1 jam di badai penuh ~ K jam sewa kapal (bisa disetel)
  function exposureRisk(route, timing, harga) {
    var wp = route.wp, c = cumNm(route), eta = etaFn(route, timing), v = timing.speed || 12;
    var hourly = (harga.sewa / 24) * harga.kurs, rpv = 0, maxCape = 0, maxT = 0, nStorm = 0, nRain = 0, jamBadai = 0;
    for (var i = 1; i < wp.length; i++) {
      var segNm = c[i] - c[i-1]; if (!(segNm > 0)) continue;
      var tmid = (eta(i-1) + eta(i)) / 2, lat = (wp[i][0] + wp[i-1][0]) / 2, lon = (wp[i][1] + wp[i-1][1]) / 2;
      var cape = sampleScalarAt(WX.capeFrames, lat, lon, tmid), rain = sampleScalarAt(WX.rainFrames, lat, lon, tmid);
      var sevC = Math.max(0, Math.min((cape - HZ.badai.lo) / (HZ.badai.hi - HZ.badai.lo), 1.5));
      var sevR = Math.max(0, Math.min((rain - HZ.hujan.lo) / 18, 1)) * 0.5;
      var hours = segNm / v;
      rpv += (sevC + sevR) * hours * hourly * RISK_K;
      if (cape >= HZ.badai.lo) { nStorm++; jamBadai += hours; }
      if (rain >= HZ.hujan.lo) nRain++;
      if (cape > maxCape) { maxCape = cape; maxT = tmid; }
    }
    return { rp: rpv, maxCape: Math.round(maxCape), maxT: maxT, nStorm: nStorm, nRain: nRain, jamBadai: jamBadai };
  }
  function hazValStr(h) { return h.type === "badai" ? Math.round(h.val) + " J/kg" : h.val.toFixed(1) + " mm/jam"; }
  function hazSizeStr(h) {   // ukuran zona SPASIAL asli: luas area + panjang jalur yang kena
    var pj = Math.round(h.spanKm || 0), z = h.zone, s = "";
    if (z && z.areaKm2 > 0) {
      var area = z.areaKm2 >= 1000 ? Math.round(z.areaKm2 / 100) * 100 : Math.round(z.areaKm2 / 10) * 10;
      s = "luas ~" + area.toLocaleString("id-ID") + " km²";
    }
    if (pj >= 10) s += (s ? " · " : "") + "lewat ~" + pj + " km";
    return s || "zona kecil";
  }
  function hazMarker(h) {
    var isB = h.type === "badai";
    var svg = isB ? ICON_BADAI(h.strong) : ICON_HUJAN(h.strong);
    var jam = h.lewatPrakira ? "di luar jangkauan prakiraan" : ("~" + h.waktu);
    var html = '<div class="hz hz-' + h.type + (h.strong ? " hz-strong" : "") + '">' + svg +
               '<span class="hz-lbl">' + h.label + '<b>' + hazValStr(h) + '</b>' +
               '<em class="hz-meta">' + jam + ' · ' + hazSizeStr(h) + '</em></span></div>';
    var ic = L.divIcon({ className: "hz-wrap", html: html, iconSize: [150, 60], iconAnchor: [17, 54] });
    var tip = h.label + " " + hazValStr(h) + "<br>Perkiraan tiba " + (h.lewatPrakira ? "di luar prakiraan" : h.waktu) +
              "<br>Zona " + hazSizeStr(h);
    return L.marker(h.ll, { icon: ic, interactive: true, riseOnHover: true })
      .bindTooltip(tip, { direction: "top", sticky: true });
  }

  /* ---- peta ---- */
  var lines = [], marks = [];
  function bersihPeta() {
    lines.forEach(function (l) { map.removeLayer(l); }); marks.forEach(function (m) { map.removeLayer(m); });
    lines = []; marks = [];
  }
  /* gambar SATU jalur (laut cuma 1 rute real) + zona badai menurut timing strategi REKOMENDASI */
  function gambarPeta(route, best, aPort, bPort) {
    bersihPeta();
    var warna = "#51cf66";
    var line = L.polyline(route.wp, { color: warna, weight: 6, opacity: 0.95, dashArray: "8 7", lineCap: "round" }).addTo(map);
    line.bindTooltip(route.nama, { sticky: true }); lines.push(line);
    (route.stops || []).slice(1, -1).forEach(function (id) {
      marks.push(portMarker(portById(id), "transit").addTo(map));
    });
    (best && best.hazards || []).forEach(function (hz) {
      var warnaZ = hz.type === "badai" ? "#ff2d2d" : "#4aa3f0";
      var tip = hz.label + " " + hazValStr(hz) + "<br>Zona " + hazSizeStr(hz) +
                "<br>Tiba " + (hz.lewatPrakira ? "di luar prakiraan" : hz.waktu);
      if (hz.zone && hz.zone.rects && hz.zone.rects.length) {
        var zlyr = L.layerGroup();
        hz.zone.rects.forEach(function (rc) {
          L.rectangle(rc, { color: warnaZ, weight: 0, fillColor: warnaZ,
            fillOpacity: hz.strong ? 0.3 : 0.18, interactive: false }).addTo(zlyr);
        });
        zlyr.addTo(map); marks.push(zlyr);
      }
      if (hz.seg && hz.seg.length > 1)
        marks.push(L.polyline(hz.seg, { color: warnaZ, weight: 9, opacity: 0.45, lineCap: "round" })
          .addTo(map).bindTooltip(tip, { sticky: true }));
      marks.push(hazMarker(hz).addTo(map));
    });
    marks.push(portMarker(aPort, "asal").addTo(map));
    marks.push(portMarker(bPort, "tujuan").addTo(map));
    if (route.wp.length) {
      var cover = panelCoverPx();   // sisakan ruang buat panel bawah biar rute ga ketutup
      map.fitBounds(L.latLngBounds(route.wp).pad(0.12), { paddingBottomRight: L.point(0, cover), animate: false });
    }
  }

  /* ---- Timeline rute (gaya peta kereta): satu rel mendatar, sumbu X = WAKTU.
     Stasiun = pelabuhan (dot di posisi jam lewat), badai/hujan = RENTANG bar
     (dari jam masuk zona sampai jam keluar). Pakai timing strategi REKOMENDASI. ---- */
  function jamShort(ms) {
    var d = new Date(ms + 7 * 3600 * 1000);
    return HARI[d.getUTCDay()] + " " + ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
  }
  function renderTimeline(route, best, aPort, bPort) {
    var el = document.getElementById("rt-timeline"); if (!el || !best) return;
    var timing = best.st, eta = etaFn(route, timing), last = route.wp.length - 1;
    var t0 = eta(0), tEnd = eta(last), span = Math.max(tEnd - t0, 1);
    function X(t) { var f = Math.max(0, Math.min(1, (t - t0) / span)); return 2 + f * 96; }   // sisakan tepi buat label
    var sp = stopPositions(route);
    var stops = sp.map(function (s, k) {
      var x = X(eta(s.idx)), edge = k === 0 ? " edge-l" : (k === sp.length - 1 ? " edge-r" : "");
      var kind = k === 0 ? "asal" : (k === sp.length - 1 ? "tujuan" : "transit");
      var pos = (k % 2 === 0) ? "up" : "dn";
      return '<div class="rt-tl-stop rt-tl-' + kind + edge + '" style="left:' + x.toFixed(2) + '%">' +
        '<div class="rt-tl-dot"></div>' +
        '<div class="rt-tl-stoplbl ' + pos + '"><b>' + esc(s.nama) + '</b><i>' + jamShort(eta(s.idx)) + '</i></div></div>';
    }).join("");
    var storms = (best.hazards || []).slice().sort(function (a, b) { return a.t - b.t; }).map(function (h) {
      var xa = X(eta(h.i0)), xb = X(eta(h.i1)), w = Math.max(xb - xa, 1.4);
      var jam = h.lewatPrakira ? "di luar prakiraan" : jamShort(h.t);
      return '<div class="rt-tl-storm ' + (h.type === "badai" ? "badai" : "hujan") + (h.strong ? " strong" : "") +
        '" style="left:' + xa.toFixed(2) + '%;width:' + w.toFixed(2) + '%" title="' +
        esc(h.label + " " + hazValStr(h) + " · " + jam + " · " + hazSizeStr(h)) + '">' +
        '<span class="rt-tl-storm-lbl"><b>' + esc(h.label) + '</b>' + esc(hazValStr(h)) + ' · ' + jam + '</span></div>';
    }).join("");
    var N = 5, ticks = "";
    for (var i = 0; i <= N; i++) { var tt = t0 + span * i / N; ticks += '<div class="rt-tl-tick" style="left:' + (2 + 96 * i / N).toFixed(2) + '%"><span>' + jamShort(tt) + '</span></div>'; }
    var tiba = best.tiba > WX.lastT + 1 ? "di luar prakiraan" : jamShort(best.tiba);
    var nmTot = cumNm(route); nmTot = nmTot[nmTot.length - 1] || 0;
    el.innerHTML = '<div class="rt-tl">' +
      '<div class="rt-tl-head"><strong>' + esc(aPort.nama) + ' › ' + esc(bPort.nama) + '</strong>' +
        '<span class="rt-tl-sub">' + nmTot.toFixed(0) + ' nm · ' + timing.speed.toFixed(1) + ' kn · tiba ' + tiba + '</span>' +
        '<div class="rt-tl-rec"><span class="rt-tl-reclbl">Rekomendasi ' + esc(best.st.label) + ' · ' + rp(best.rp_total) + '</span>' +
        '<button type="button" id="rt-open-cards" class="rt-tl-open"><span class="material-symbols-outlined">dashboard</span> Taktik & biaya</button></div></div>' +
      '<div class="rt-tl-track"><div class="rt-tl-rail"></div>' + storms + stops +
        '<div class="rt-tl-axis">' + ticks + '</div></div></div>';
  }

  function tlMsg(html) {   // pesan/peringatan tampil di area timeline (kelihatan), kosongkan modal kartu
    var el = document.getElementById("rt-timeline"); if (el) el.innerHTML = html;
    var c = document.getElementById("rt-cards"); if (c) c.innerHTML = "";
    closeCards();
  }

  /* ---- baca form ---- */
  function num(id) { var el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  function bacaForm() {
    return {
      kapal: { nama:(document.getElementById("rt-nama").value||"Kapal"), L_BWL:num("rt-L"), B:num("rt-B"), T:num("rt-T"),
               C_B:num("rt-CB"), V0:num("rt-V0"), FOC0:num("rt-FOC0"), SFOC:num("rt-SFOC"), eta_D:num("rt-etaD"), A_T:num("rt-AT"), C_X:num("rt-CX") },
      ambang: { hs:num("rt-ambHs"), angin:num("rt-ambAngin") },
      harga: { bunker:num("rt-bunker"), kurs:num("rt-kurs"), sewa:num("rt-sewa"), rho_bahan:0.985 },
      eta: num("rt-eta")
    };
  }

  function jalankan() {
    if (!WX.loaded) { loadWx(jalankan); return; }   // muat cuaca asli sekali, lalu hitung
    document.getElementById("rt-eta-val").textContent = num("rt-eta").toFixed(2);
    var aPort = portByIdN(comboPort(asalCombo())), bPort = portByIdN(comboPort(tujuanCombo()));
    if (!aPort || !bPort) {
      tlMsg('<div class="rute-tertahan"><span class="material-symbols-outlined">info</span><div><strong>Lengkapi pelabuhan</strong>Ketik dan pilih pelabuhan asal dan tujuan dulu.</div></div>');
      bersihPeta(); return;
    }
    var transits = readTransits();
    if (aPort.id === bPort.id && !transits.length) { tlMsg('<div class="rute-tertahan"><span class="material-symbols-outlined">info</span><div><strong>Asal dan tujuan sama</strong>Pilih pelabuhan berbeda, atau tambah transit.</div></div>'); bersihPeta(); return; }
    var stops = [aPort].concat(transits).concat([bPort]);
    var routes = buildRoutes(stops);
    if (!routes.length) {   // ada ruas yang tak nyambung di jaringan real
      tlMsg('<div class="rute-tertahan"><span class="material-symbols-outlined">block</span><div><strong>Belum ada rute</strong>Salah satu ruas belum punya jalur real yang nyambung. Coba ubah pelabuhan atau transitnya.</div></div>');
      bersihPeta(); return;
    }
    var fm = bacaForm();
    var route = routes[0];
    var strat = buildStrategies(route, fm.kapal, fm.ambang, fm.eta, fm.harga);
    var base = strat.semua.filter(function (e) { return e.st.kind === "normal"; })[0];
    var html = routeHeaderHtml(route, route._sp.titik[route._sp.titik.length - 1].d);
    html += strat.list.map(function (e) { return kartuHtml(e, base); }).join("");
    document.getElementById("rt-cards").innerHTML = html;   // kartu taktik -> modal (dibuka tombol)
    renderTimeline(route, strat.best, aPort, bPort);         // timeline rute di dok bawah
    gambarPeta(route, strat.best, aPort, bPort);
    fillTransitList(route.stops);   // isi daftar transit dari pelabuhan yang dilewati rute
  }

  /* ---- isi field dari jenis kapal ---- */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  function isiDariJenis(id) {
    var j = jenisById(id);
    setVal("rt-L", j.L_BWL); setVal("rt-B", j.B); setVal("rt-T", j.T); setVal("rt-CB", j.C_B);
    setVal("rt-V0", j.V0); setVal("rt-FOC0", j.FOC0); setVal("rt-SFOC", j.SFOC);
    setVal("rt-etaD", j.eta_D); setVal("rt-AT", j.A_T); setVal("rt-CX", j.C_X);
    setVal("rt-ambHs", j.amb.hs); setVal("rt-ambAngin", j.amb.angin);
    var wrap = document.getElementById("rt-nama-wrap"), nama = document.getElementById("rt-nama");
    if (id === "lain") { wrap.style.display = ""; nama.value = ""; nama.focus(); }
    else { wrap.style.display = "none"; nama.value = j.nama; }
  }

  /* Penjelasan tiap parameter inputan (bahasa awam) -> popup #param-overlay */
  var NF_INFO = {
    "rt-L": { title: "Panjang garis air", body: "Panjang badan kapal yang kena air waktu mengapung. Dipakai menghitung hambatan air. Makin panjang biasanya makin efisien di laju tinggi." },
    "rt-B": { title: "Lebar", body: "Lebar badan kapal. Makin lebar makin stabil, tapi hambatan airnya juga naik." },
    "rt-V0": { title: "Kecepatan dinas", body: "Kecepatan jalan normal kapal ini. Satu knot kira-kira 1,85 km per jam." },
    "rt-FOC0": { title: "Konsumsi BBM", body: "Berapa ton bahan bakar dipakai per hari saat jalan di kecepatan dinas." },
    "rt-SFOC": { title: "Konsumsi spesifik mesin", body: "Berapa gram bahan bakar yang diminum mesin untuk tiap satu kWh tenaga. Makin kecil makin irit mesinnya." },
    "rt-etaD": { title: "Efisiensi propulsi", body: "Seberapa besar tenaga mesin benar-benar jadi dorongan maju, dari 0 sampai 1. Makin dekat ke 1 makin sedikit tenaga yang terbuang." },
    "rt-AT": { title: "Luas kena angin", body: "Luas badan kapal di atas air yang ditiup angin, dalam meter persegi. Makin besar makin kuat angin mendorong kapal." },
    "rt-CX": { title: "Koefisien angin", body: "Angka seberapa gampang bentuk kapal didorong angin. Makin besar makin terasa efek anginnya." },
    "rt-ambHs": { title: "Batas tinggi ombak", body: "Tinggi ombak paling tinggi yang masih dianggap aman buat kapal ini. Lewat dari ini, jalur ditandai bahaya." },
    "rt-ambAngin": { title: "Batas angin", body: "Kecepatan angin paling tinggi yang masih dianggap aman. Lewat dari ini, jalur ditandai bahaya." },
    "rt-bunker": { title: "Harga bunker", body: "Harga bahan bakar kapal per ton dalam dolar. Dipakai menghitung biaya BBM." },
    "rt-kurs": { title: "Kurs", body: "Nilai tukar satu dolar ke rupiah. Dipakai mengubah biaya dolar jadi rupiah." },
    "rt-sewa": { title: "Sewa harian", body: "Biaya sewa kapal per hari dalam dolar. Makin lama perjalanan makin besar biaya sewanya." },
    "rt-eta": { title: "Kompensasi laju", body: "Pengatur condong ke hemat BBM atau kejar jadwal, dari 0 sampai 1. Makin ke 0 kapal pelan biar irit bahan bakar. Makin ke 1 kapal ngebut biar cepat sampai walau lebih boros." },
  };
  function showParam(id) {
    var d = NF_INFO[id], ov = document.getElementById("param-overlay"); if (!d || !ov) return;
    document.getElementById("param-title").textContent = d.title;
    document.getElementById("param-body").textContent = d.body;
    ov.classList.add("show"); ov.setAttribute("aria-hidden", "false");
  }
  function nf(id, label, unit, step) {
    var info = NF_INFO[id] ? '<span class="rt-nf-info" data-info="' + id + '" role="button" tabindex="0" aria-label="Apa itu ' + label + '">!</span>' : '';
    return '<label class="rt-nf"><span class="rt-nf-lbl">' + label + info + '</span>' +
           '<span class="rt-nf-in"><input type="number" id="' + id + '" step="' + step + '" /><i>' + unit + '</i></span></label>';
  }
  /* ---- jaringan laut real -> pathfinding Dijkstra (asal bebas, tujuan bebas) ---- */
  function buildGraph() {
    GRAPH = {};
    if (!RUTEDB || !RUTEDB.routes) return;
    Object.keys(RUTEDB.routes).forEach(function (k) {
      var r = RUTEDB.routes[k], p = k.split("__"); if (p.length !== 2) return;
      var w = (r.langsung && r.langsung.km) || 1;
      (GRAPH[p[0]] = GRAPH[p[0]] || []).push({ to: p[1], key: k, w: w, rev: false });
      (GRAPH[p[1]] = GRAPH[p[1]] || []).push({ to: p[0], key: k, w: w, rev: true });
    });
  }
  function dijkstra(src, dst) {
    if (!GRAPH || !GRAPH[src] || !GRAPH[dst]) return null;
    var dist = {}, prev = {}, done = {}, pq = [[0, src]];
    dist[src] = 0;
    while (pq.length) {
      pq.sort(function (a, b) { return a[0] - b[0]; });
      var top = pq.shift(), d = top[0], u = top[1];
      if (done[u]) continue; done[u] = true;
      if (u === dst) break;
      (GRAPH[u] || []).forEach(function (e) {
        var nd = d + e.w;
        if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { from: u, edge: e }; pq.push([nd, e.to]); }
      });
    }
    if (dist[dst] === undefined) return null;
    var edges = [], cur = dst;
    while (cur !== src) { var pe = prev[cur]; edges.unshift(pe.edge); cur = pe.from; }
    return edges;
  }
  function hasPort(id) { for (var i = 0; i < PORTS.length; i++) if (PORTS[i].id === id) return true; return false; }
  function asalCombo() { var i = document.querySelector(".rt-asal-in"); return i ? i.closest(".rt-combo") : null; }
  function tujuanCombo() { var i = document.querySelector(".rt-tujuan-in"); return i ? i.closest(".rt-combo") : null; }
  function setDefaultPair() {
    var ca = asalCombo(), ct = tujuanCombo();
    if (!ca || !ct) return;
    var a = portByIdN("surabaya") || PORTS[0] || null;
    var b = portByIdN("ujungpandang") || portByIdN("makassar") || null;
    if (!b && a) for (var i = 0; i < PORTS.length; i++) if (PORTS[i].id !== a.id) { b = PORTS[i]; break; }
    if (a) setCombo(ca, a); if (b) setCombo(ct, b);
  }

  /* =============================================================
     Combobox pelabuhan: ketik -> muncul yang mendekati (cari di
     seluruh database PORTS). Dipakai asal, tujuan, dan tiap transit.
     Transit = sistem tambah item (daftar yang bisa ditambah/hapus).
     ============================================================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[c]; }); }
  function portByIdN(id) { for (var i = 0; i < PORTS.length; i++) if (PORTS[i].id === id) return PORTS[i]; return null; }
  function byNama(a, b) { return a.nama.localeCompare(b.nama); }
  function normPort(p) { return (p.nama || "").toLowerCase(); }
  function searchPorts(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return PORTS.slice().sort(byNama).slice(0, 50);
    var starts = [], has = [];
    for (var i = 0; i < PORTS.length; i++) {
      var p = PORTS[i], n = normPort(p), idx = n.indexOf(q);
      if (idx === 0) starts.push(p); else if (idx > 0) has.push(p);
    }
    starts.sort(byNama); has.sort(byNama);
    return starts.concat(has).slice(0, 50);
  }

  var comboSeq = 0, openCombo = null, activeIdx = -1;
  function makeComboHtml(extraCls, ph) {
    var id = "cmb" + (++comboSeq);
    return '<div class="rt-combo" data-combo="' + id + '" data-port="">' +
             '<span class="material-symbols-outlined rt-combo-ic">anchor</span>' +
             '<input type="text" class="rt-combo-input ' + (extraCls || "") + '" placeholder="' + esc(ph) + '" autocomplete="off" spellcheck="false" />' +
             '<div class="rt-combo-list" hidden></div>' +
           '</div>';
  }
  function comboPort(combo) { return combo ? combo.getAttribute("data-port") : ""; }
  function setCombo(combo, port) {
    if (!combo) return;
    combo.setAttribute("data-port", port ? port.id : "");
    var inp = combo.querySelector(".rt-combo-input");
    if (inp) inp.value = port ? port.nama : "";
  }
  function syncInput(combo) {
    var inp = combo.querySelector(".rt-combo-input"), p = portByIdN(comboPort(combo));
    if (inp) inp.value = p ? p.nama : "";
  }
  function listOpts(combo) { return combo ? [].slice.call(combo.querySelectorAll(".rt-combo-opt")) : []; }
  function renderList(combo, q) {
    var box = combo.querySelector(".rt-combo-list"), items = searchPorts(q);
    if (!items.length) { box.innerHTML = '<div class="rt-combo-empty">Tidak ada pelabuhan cocok</div>'; }
    else box.innerHTML = items.map(function (p, i) {
      return '<div class="rt-combo-opt' + (i === 0 ? " active" : "") + '" data-id="' + esc(p.id) + '">' +
               '<span class="rt-opt-nm">' + esc(p.nama) + '</span>' +
               (p.tipe ? '<span class="rt-opt-tp">' + esc(p.tipe) + '</span>' : '') + '</div>';
    }).join("");
    box.hidden = false; openCombo = combo; activeIdx = items.length ? 0 : -1;
  }
  function closeList(combo) {
    var box = combo && combo.querySelector(".rt-combo-list");
    if (box) { box.hidden = true; box.innerHTML = ""; }
    if (openCombo === combo) { openCombo = null; activeIdx = -1; }
  }
  function setActive(combo, idx) {
    var opts = listOpts(combo); if (!opts.length) return;
    activeIdx = (idx + opts.length) % opts.length;
    opts.forEach(function (o, i) { o.classList.toggle("active", i === activeIdx); });
    opts[activeIdx].scrollIntoView({ block: "nearest" });
  }
  function pickCombo(combo, id) {
    var p = portByIdN(id); if (!p) return;
    setCombo(combo, p); closeList(combo);
    var row = combo.closest(".rt-transit-row");
    if (row) { row.removeAttribute("data-auto"); row.classList.remove("rt-auto"); }   // transit dipilih user -> manual
    else dropAutoTransits();   // asal/tujuan ganti -> buang transit otomatis lama, biar dihitung ulang
    jalankan();
  }

  /* ---- transit: tambah/hapus baris, baca daftarnya ---- */
  function transitRowHtml() {
    return '<div class="rt-transit-row">' + makeComboHtml("rt-transit", "ketik pelabuhan transit") +
           '<button type="button" class="rt-transit-del" title="Hapus transit"><span class="material-symbols-outlined">close</span></button></div>';
  }
  function makeTransitRow(port, auto) {
    var list = document.getElementById("rt-transit-list"); if (!list) return null;
    var tmp = document.createElement("div"); tmp.innerHTML = transitRowHtml();
    var row = tmp.firstChild;
    if (auto) row.setAttribute("data-auto", "1"), row.classList.add("rt-auto");
    list.appendChild(row);
    if (port) setCombo(row.querySelector(".rt-combo"), port);
    return row;
  }
  function addTransitRow(focus) {
    var row = makeTransitRow(null, false);   // baris manual kosong
    if (row && focus) { var inp = row.querySelector(".rt-combo-input"); if (inp) inp.focus(); }
  }
  function dropAutoTransits() {
    var list = document.getElementById("rt-transit-list"); if (!list) return;
    [].slice.call(list.querySelectorAll('.rt-transit-row[data-auto="1"]')).forEach(function (r) { r.remove(); });
  }
  /* isi daftar transit = pelabuhan yang DILEWATI rute real (urut jalur).
     Yang user tambah/edit (manual) dipertahankan flag-nya; sisanya otomatis. */
  function fillTransitList(stops) {
    var list = document.getElementById("rt-transit-list"); if (!list || !stops) return;
    var a = document.activeElement;   // jangan ganggu kalau user lagi ngetik transit baru yang belum dipilih
    if (a && a.classList && a.classList.contains("rt-combo-input") && a.closest("#rt-transit-list") && !comboPort(a.closest(".rt-combo"))) return;
    var manual = {};
    [].slice.call(list.querySelectorAll(".rt-transit-row")).forEach(function (r) {
      var pid = comboPort(r.querySelector(".rt-combo"));
      if (pid && r.getAttribute("data-auto") !== "1") manual[pid] = 1;
    });
    var mids = stops.slice(1, -1);
    list.innerHTML = "";
    mids.forEach(function (id) { var p = portByIdN(id); if (p) makeTransitRow(p, !manual[id]); });
  }
  /* cuma transit MANUAL (yang user tambah/edit) jadi kendala rute.
     Transit otomatis cuma tampilan jalur, bukan batasan -> rute ga oscillate. */
  function readTransits() {
    var out = [], list = document.getElementById("rt-transit-list");
    if (!list) return out;
    [].slice.call(list.querySelectorAll(".rt-transit-row")).forEach(function (r) {
      if (r.getAttribute("data-auto") === "1") return;
      var p = portByIdN(comboPort(r.querySelector(".rt-combo"))); if (p) out.push(p);
    });
    return out;
  }

  function buildPanel() {
    var aside = document.createElement("aside");
    aside.id = "rute-panel"; aside.className = "panel";
    var jenisOpts = JENIS.map(function (j) { return '<option value="' + j.id + '">' + j.nama + '</option>'; }).join("");
    aside.innerHTML =
      '<div class="rt-head"><div><span class="label-caps">Rute Pelayaran</span><div class="rt-title">Dampak tiap jalur</div></div>' +
        '<button id="rt-close" class="rt-x" title="Tutup"><span class="material-symbols-outlined">close</span></button></div>' +
      '<div class="rt-scroll"><div class="rt-form">' +
        '<div class="rt-field"><span class="label-caps">Asal</span>' + makeComboHtml("rt-asal-in", "ketik nama pelabuhan asal") + '</div>' +

        '<div class="rt-field" id="rt-transit-field"><span class="label-caps">Transit <b class="rt-opsional">otomatis dari rute</b></span>' +
          '<div id="rt-transit-list"></div>' +
          '<button type="button" id="rt-add-transit" class="rt-add-transit"><span class="material-symbols-outlined">add</span> Tambah pelabuhan transit</button></div>' +

        '<div class="rt-field"><span class="label-caps">Tujuan</span>' + makeComboHtml("rt-tujuan-in", "ketik nama pelabuhan tujuan") + '</div>' +

        '<div class="rt-field"><span class="label-caps">Jenis kapal</span><div class="select-wrap"><select id="rt-jenis">' + jenisOpts + '</select><span class="material-symbols-outlined">arrow_drop_down</span></div></div>' +
        '<div class="rt-field" id="rt-nama-wrap" style="display:none"><span class="label-caps">Nama atau tipe kapal</span><div class="rt-nf-in"><input type="text" id="rt-nama" placeholder="ketik tipe kapal" /></div></div>' +

        '<div class="rt-grp-ttl">Dimensi dan operasi</div>' +
        nf("rt-L","Panjang garis air","m","1") + nf("rt-B","Lebar","m","0.1") +
        nf("rt-V0","Kecepatan dinas","knot","0.5") + nf("rt-FOC0","Konsumsi BBM","ton/hari","0.1") +

        '<button id="rt-adv" class="rt-adv-btn" type="button"><span class="material-symbols-outlined">expand_more</span> Parameter lanjutan</button>' +
        '<div id="rt-adv-box" class="rt-adv" hidden>' +
          nf("rt-SFOC","Konsumsi spesifik mesin","g/kWh","1") + nf("rt-etaD","Efisiensi propulsi","0-1","0.01") +
          nf("rt-AT","Luas kena angin","m2","10") + nf("rt-CX","Koefisien angin","","0.05") +
          '<div class="rt-grp-ttl">Ambang keselamatan</div>' + nf("rt-ambHs","Batas tinggi ombak","m","0.1") + nf("rt-ambAngin","Batas angin","knot","1") +
          '<div class="rt-grp-ttl">Harga</div>' + nf("rt-bunker","Harga bunker","USD/ton","10") + nf("rt-kurs","Kurs","Rp/USD","100") + nf("rt-sewa","Sewa harian","USD/hari","100") +
        '</div>' +

        '<div class="rt-field"><span class="label-caps">Kompensasi laju (eta) <b id="rt-eta-val">0.50</b><span class="rt-nf-info" data-info="rt-eta" role="button" tabindex="0" aria-label="Apa itu kompensasi laju">!</span></span>' +
          '<input type="range" id="rt-eta" min="0" max="1" step="0.05" value="0.5" /><div class="rt-eta-cap"><span>santai hemat BBM</span><span>kejar jadwal</span></div></div>' +

        '<button id="rt-hitung" class="rt-go">Hitung rute</button>' +
        '<div class="rt-note">Pilih asal dan tujuan bebas. Jalur dirangkai dari jaringan laut REAL (rute feri + Pelni + penyeberangan BMKG, pelabuhan World Port Index). Kalau nggak ada rute langsung, disambung lewat beberapa ruas real (kayak transit). Cuaca dari data model: ombak GFS-Wave, angin GFS, arus CMEMS, disampel sepanjang jalur. Jenis kapal cuma ngatur angka teknis, boleh diedit.</div>' +
      '</div><div id="rt-timeline"></div></div>';
    document.getElementById("stage").appendChild(aside);

    /* modal kartu taktik (tengah layar), dibuka tombol "Taktik & biaya" di timeline */
    var modal = document.createElement("div");
    modal.id = "rt-cards-modal"; modal.className = "rt-modal"; modal.hidden = true;
    modal.innerHTML = '<div class="rt-modal-back"></div><div class="rt-modal-box">' +
      '<button type="button" class="rt-modal-x" id="rt-cards-x"><span class="material-symbols-outlined">close</span></button>' +
      '<div class="rt-cards" id="rt-cards"></div></div>';
    document.getElementById("stage").appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target.closest(".rt-modal-x") || e.target.classList.contains("rt-modal-back")) closeCards();
    });

    buildGraph(); setDefaultPair();   // asal/tujuan bebas, isi default yang nyambung
    setVal("rt-bunker", FMS.HARGA.bunker); setVal("rt-kurs", FMS.HARGA.kurs); setVal("rt-sewa", FMS.HARGA.sewa);
    isiDariJenis("feri");

    aside.querySelector("#rt-jenis").addEventListener("change", function () { isiDariJenis(this.value); jalankan(); });
    aside.querySelector("#rt-adv").addEventListener("click", function () { var box = document.getElementById("rt-adv-box"); box.hidden = !box.hidden; this.classList.toggle("open", !box.hidden); });
    aside.addEventListener("click", function (e) { var b = e.target.closest(".rt-nf-info"); if (!b) return; e.preventDefault(); e.stopPropagation(); showParam(b.dataset.info); });
    aside.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("rt-nf-info")) { e.preventDefault(); showParam(e.target.dataset.info); } });
    aside.querySelector("#rt-hitung").addEventListener("click", jalankan);
    aside.querySelector("#rt-eta").addEventListener("input", function () { document.getElementById("rt-eta-val").textContent = parseFloat(this.value).toFixed(2); });
    aside.querySelector("#rt-close").addEventListener("click", tutup);

    /* ---- combobox pelabuhan + transit (delegasi, berlaku juga buat baris transit baru) ---- */
    aside.addEventListener("input", function (e) {
      var inp = e.target; if (!inp.classList || !inp.classList.contains("rt-combo-input")) return;
      renderList(inp.closest(".rt-combo"), inp.value);
    });
    aside.addEventListener("focusin", function (e) {
      var inp = e.target; if (!inp.classList || !inp.classList.contains("rt-combo-input")) return;
      renderList(inp.closest(".rt-combo"), ""); setTimeout(function () { try { inp.select(); } catch (x) {} }, 0);
    });
    aside.addEventListener("focusout", function (e) {
      var inp = e.target; if (!inp.classList || !inp.classList.contains("rt-combo-input")) return;
      var combo = inp.closest(".rt-combo");
      setTimeout(function () { closeList(combo); syncInput(combo); }, 160);
    });
    aside.addEventListener("keydown", function (e) {
      var inp = e.target; if (!inp.classList || !inp.classList.contains("rt-combo-input")) return;
      var combo = inp.closest(".rt-combo");
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(combo, activeIdx + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(combo, activeIdx - 1); }
      else if (e.key === "Enter") { e.preventDefault(); var o = listOpts(combo)[activeIdx]; if (o) pickCombo(combo, o.getAttribute("data-id")); }
      else if (e.key === "Escape") { closeList(combo); syncInput(combo); inp.blur(); }
    });
    aside.addEventListener("mousedown", function (e) {
      var opt = e.target.closest && e.target.closest(".rt-combo-opt");
      if (!opt) return;
      e.preventDefault();   // jangan sampai input kehilangan fokus sebelum klik kebaca
      pickCombo(opt.closest(".rt-combo"), opt.getAttribute("data-id"));
    });
    aside.addEventListener("click", function (e) {
      if (e.target.closest("#rt-open-cards")) { openCards(); return; }
      if (e.target.closest("#rt-add-transit")) { addTransitRow(true); return; }
      var del = e.target.closest(".rt-transit-del");
      if (del) { var row = del.closest(".rt-transit-row"); if (row) row.remove(); jalankan(); }
    });
    return aside;
  }
  function openCards() { var m = document.getElementById("rt-cards-modal"); if (m) m.hidden = false; }
  function closeCards() { var m = document.getElementById("rt-cards-modal"); if (m) m.hidden = true; }

  var panel = null, aktif = false;
  /* tinggi panel bawah yg nutup peta (0 kalau tutup) -> buat reframe + padding fitBounds */
  function panelCoverPx() { return (panel && panel.classList.contains("show")) ? Math.round(panel.getBoundingClientRect().height) : 0; }
  function setInset(px) { if (window.BARUNA_setInset) window.BARUNA_setInset(px); }
  function buka() {
    if (!panel) panel = buildPanel();
    panel.classList.add("show"); document.getElementById("rute-btn").classList.add("active"); aktif = true;
    setInset(panelCoverPx());
    if (window.BARUNA_reframe) window.BARUNA_reframe();   // kalau nanti ga ada rute, view domain ikut naik ke atas panel
    jalankan();                                          // ada rute -> gambarPeta fit rute dgn padding bawah (view final)
    setInset(panelCoverPx());                            // inset final stlh timeline (tanpa reframe, biar fit rute kejaga)
  }
  function tutup() {
    if (panel) panel.classList.remove("show");
    var b = document.getElementById("rute-btn"); if (b) b.classList.remove("active");
    aktif = false; bersihPeta(); closeCards();
    setInset(0); if (window.BARUNA_reframe) window.BARUNA_reframe();
  }
  function toggle() { aktif ? tutup() : buka(); }
  window.addEventListener("resize", function () {
    if (!aktif) return;
    setInset(panelCoverPx()); if (window.BARUNA_reframe) window.BARUNA_reframe();
  });

  function init() {
    if (!map) map = window.BARUNA_MAP;
    if (!map || typeof FMS === "undefined") { console.warn("rute.js: map atau FMS belum siap"); return; }
    /* muat database jalur laut; kalau gagal, fallback garis lurus */
    fetch("data/rute/real_routes.json", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (d) { RUTEDB = d; if (d.ports && d.ports.length) PORTS = d.ports; buildGraph(); if (panel) setDefaultPair(); if (aktif) jalankan(); })
      .catch(function () { console.warn("rute.js: real_routes.json tidak ada, pakai garis lurus"); });
    var btn = document.getElementById("rute-btn");
    if (btn) btn.addEventListener("click", toggle);
    if ((location.hash || "").indexOf("rute") >= 0) setTimeout(buka, 400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

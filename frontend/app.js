/* ===== CESGS Baruna v3 — Laut: Angin / Arus / Gelombang =====
   Tiap parameter = kontur (imageOverlay) + velocity (partikel).
   Domain kecil + frame dikunci ala CESGS Nimbus. Data dari ocean.json.
   SST/anomali/klimatologi/indeks DIBUANG (ada di versi v2 app.js.bak). */
"use strict";

const DATA = "data/output/ocean.json";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const $ = (id) => document.getElementById(id);
const toWIB = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3);
const nlng = (l) => ((l % 360) + 360) % 360;

/* Legenda per parameter (angka, warna, teks-gelap?) */
const SPEED_CELLS = [["0", "#008000", 1], ["0.25", "#005020", 1], ["0.5", "#002040", 1], ["0.75", "#001060", 1],
  ["1", "#004080", 1], ["1.5", "#42a0c0", 1], ["2", "#ffffff", 0]];
const WAVE_CELLS = [["0", "#10204a", 1], ["1", "#1d5c91", 1], ["2", "#1e9c8a", 1],
  ["3", "#95cc5b", 0], ["4", "#ecc317", 0], ["5", "#ef780d", 1]];
const CAPE_CELLS = [["1000", "#fcab8f", 0], ["1800", "#fb7252", 0],
  ["2600", "#e83429", 1], ["3400", "#b31218", 1], ["4200", "#67000d", 1]];
const LEGEND = {
  cape: { head: "J/kg", cells: CAPE_CELLS },
  arus: { head: "m/s", cells: SPEED_CELLS },
  wave: { head: "m", cells: WAVE_CELLS },
};
const LAYER_ORDER = ["arus", "wave"];   // param dasar; CAPE jadi overlay tetap di atasnya
const LAYER_LABEL = { cape: "Potensi badai", arus: "Arus", wave: "Gelombang" };

let OC = null;
let activeLayer = "arus";
let frames = [];
let frameIdx = 0;
let dataBounds = null;      // batas pan (domain kecil)
let VIEW_CORE = null;
let overlay = null;         // kontur (imageOverlay)
let velLayer = null;        // partikel (leaflet-velocity)
let velCache = {};
let playing = false, playTimer = null;

/* ---- Peta ---- */
const map = L.map("map", {
  zoomControl: false, attributionControl: false,
  minZoom: 2, maxZoom: 9, zoomSnap: 0.25, worldCopyJump: false,
  maxBoundsViscosity: 1.0,
}).setView([-2, 118], 4);
map.createPane("basemap"); map.getPane("basemap").style.zIndex = 380;
map.createPane("data"); map.getPane("data").style.zIndex = 390;   // kontur; partikel velocity (overlayPane 400) di atasnya
map.createPane("storm"); map.getPane("storm").style.zIndex = 420; map.getPane("storm").style.pointerEvents = "none";   // CAPE overlay di atas kontur + partikel arus/wave
map.createPane("admin"); map.getPane("admin").style.zIndex = 450; map.getPane("admin").style.pointerEvents = "none";   // batas negara/provinsi di atas partikel

const BASE_DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
/* Kontrol atribusi Leaflet DIBUANG 5 November 2026. Dia duduk di pojok
   kanan bawah, tepat di belakang legenda, dan tulisannya gelap di atas
   bilah putih jadi tidak terbaca. Kreditnya pindah ke kartu .kredit di
   atas legenda, sama dengan envirocircle. String attribution di
   tileLayer sengaja DIBIARKAN walau tidak lagi dirender, supaya sumber
   alasnya tetap tercatat di kode. */
L.tileLayer(BASE_DARK, { pane: "basemap", crossOrigin: true, maxZoom: 16,
  attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS" }).addTo(map);

let bottomInset = 0;   // tinggi panel bawah (rute) yg nutup peta -> framing naik ke area kelihatan
/* Lebar sidebar KANAN (form rute). Ditambah 5 November 2026 waktu panel rute
   dipecah jadi sidebar kanan + panel bawah. Tanpa ini peta dibingkai seolah
   lebarnya penuh, lalu separuh Papua hilang di balik sidebar. */
let rightInset = 0;
const ZOOM_MIN_DASAR = 2;   // sama dengan minZoom di opsi peta, lihat frameRegion
function frameRegion() {
  if (!dataBounds || !VIEW_CORE) return;
  const size = map.getSize();
  const inset = Math.min(Math.max(0, bottomInset), Math.max(0, size.y - 140));   // sisakan min 140px peta
  const insetX = Math.min(Math.max(0, rightInset), Math.max(0, size.x - 240));   // sisakan min 240px peta
  const pad = L.point(insetX, inset);

  /* MUAT PENUH, bukan isi penuh. Diubah 5 November 2026, diminta pemilik.
     Zoom paling jauh sekarang memperlihatkan SELURUH domain sekaligus, sebab
     selama rutenya belum diisi tidak ada bagian peta yang lebih penting dari
     bagian lain.

     Hitungan tangan yang dulu ada di sini DIBUANG. Dia memperlebar kotak ke
     rasio layar, mencari zoom, memasang view di tengah kotak penuh, lalu
     menggesernya lagi dengan panBy. Tiga langkah yang masing masing benar
     tapi gesernya dihitung dua kali, jadi hasilnya domain tergeser ke selatan
     dan tepi utaranya hilang. Terukur: peta berhenti di 25,2 LU padahal
     datanya sampai 33 LU.

     fitBounds dengan paddingBottomRight mengerjakan ketiganya sekaligus, dan
     itu memang gunanya: muat kotak ini ke dalam layar DIKURANGI panel kanan
     dan panel bawah. */
  /* REM LAMA DILEPAS DULU. getBoundsZoom memotong hasilnya ke minZoom yang
     sedang berlaku, jadi begitu minZoom pernah naik dia tidak pernah bisa
     turun lagi, berapa pun lebar layarnya. Panggilan pertama terjadi sebelum
     tata letak mapan, hasilnya ketinggian, dan angka itu mengunci semua
     panggilan berikutnya. Terukur: minZoom macet di 4,00 padahal domainnya
     muat di 3,50. */
  map.setMinZoom(ZOOM_MIN_DASAR);
  /* MENGISI, bukan memuat. Diubah lagi 5 November 2026 sesudah datanya
     diperlebar jadi 36..200 BT.

     Dulu "memuat penuh" dipakai supaya seluruh domain kelihatan, dan itu
     benar waktu domainnya masih sempit. Sekarang domainnya sengaja dibuat
     lebih lebar dari bingkai mana pun, jadi memuat penuh malah menyisakan
     ruang kosong yang besarnya ikut ukuran jendela: pas di satu laptop,
     bersisa di laptop lain.

     Dengan mengisi, bingkai SELALU penuh di jendela berapa pun, dan yang
     terpotong cuma tepi domain yang memang kelebihan. Titik tengah domain
     118 BT sama dengan titik tengah Indonesia, dan mengisi itu memusat,
     jadi Indonesia tetap di tengah. */
  const z = map.getBoundsZoom(dataBounds, true, pad);
  map.setMinZoom(z);

  /* Rem dilepas DULU, posisinya dipasang BELAKANGAN. fitBounds saja tidak
     cukup: batas geser yang masih terpasang dari panggilan sebelumnya
     menjepit hasilnya, dan domain terdorong mentok ke timur sampai seluruh
     ruang kosong menumpuk di barat. Terukur: peta mulai dari 37 BT, Afrika
     ikut kelihatan, padahal datanya baru mulai di 60 BT. */
  map.setMaxBounds(null);
  map.setView(dataBounds.getCenter(), z, { animate: false });
  /* Titik tengah domain digeser dari tengah JENDELA ke tengah BAGIAN PETA,
     yaitu jendela dikurangi sidebar kanan dan panel bawah. Diminta pemilik:
     Indonesia di tengah bingkai peta, bukan di tengah layar. */
  if (insetX || inset) map.panBy([insetX / 2, inset / 2], { animate: false });

  /* Batas geser diperluas sebanyak ukuran panel, supaya tepi data yang
     tertutup panel masih bisa ditarik ke bagian yang kelihatan. */
  const dLat = Math.abs(map.containerPointToLatLng([0, 0]).lat - map.containerPointToLatLng([0, inset]).lat);
  const dLon = Math.abs(map.containerPointToLatLng([0, 0]).lng - map.containerPointToLatLng([insetX, 0]).lng);
  /* Diperluas KE DUA SISI, bukan cuma ke timur. Domainnya lebih jangkung
     daripada ruang yang tersedia, jadi selalu ada sisa ruang mendatar. Kalau
     batas geser cuma dilonggarkan ke timur, rem di sisi barat mendorong
     seluruh sisa itu menumpuk di kanan dan peta terlihat seperti ditempel
     miring. Dilonggarkan dua duanya, sisanya terbagi rata. */
  /* Batas geser WAJIB mencakup tampilan yang baru saja dipasang. Kalau tidak,
     dia menarik balik geseran yang barusan dikerjakan dan hasilnya domain
     terdorong mentok ke timur lagi. Itu yang terjadi kemarin: geseran 166 px
     dibatalkan diam diam oleh batas yang ditetapkan sesudahnya, tanpa galat,
     dan kelihatannya seperti panBy tidak jalan padahal jalan. */
  const longgar = L.latLngBounds(L.latLng(dataBounds.getSouth() - dLat, dataBounds.getWest() - dLon),
                                 L.latLng(dataBounds.getNorth(), dataBounds.getEast() + dLon));
  longgar.extend(map.getBounds());
  map.setMaxBounds(longgar);
}

/* ---- Batas administrasi (negara solid, provinsi putus-putus) ala Nimbus ---- */
function loadAdmin() {
  const styleCountry = { color: "#ffffff", weight: 1.0, opacity: 0.8, fill: false, lineJoin: "round", lineCap: "round", interactive: false };
  const styleProv = { color: "#ffffff", weight: 1.0, opacity: 0.8, fill: false, dashArray: "3 2", lineJoin: "round", interactive: false };
  const renderer = L.canvas({ pane: "admin", padding: 0.5 });
  Promise.all([
    fetch("data/world_countries.geojson").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/idn_provinces.geojson").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([world, prov]) => {
    if (world) L.geoJSON(world, { pane: "admin", renderer, style: styleCountry,
      filter: (f) => !f.properties || f.properties.name !== "Indonesia" }).addTo(map);   // Indonesia pakai garis provinsi
    if (prov) L.geoJSON(prov, { pane: "admin", renderer, style: styleProv }).addTo(map);
  }).catch((e) => console.warn("Batas administrasi gagal:", e));
}

/* ---- Legenda ---- */
function cellsHtml(cells) {
  return cells.map(([label, bg, dark]) =>
    `<div class="legend-cell${dark ? " dark" : ""}" style="background:${bg}">${label}</div>`).join("");
}
function renderLegend(key) {   // legenda param dasar (arus/wave) di bawah
  const def = LEGEND[key]; if (!def) return;
  $("legend-head").textContent = (LAYER_LABEL[key] || "") + " · " + def.head;
  $("legend-cells").innerHTML = cellsHtml(def.cells);
}
function renderCapeLegend() {   // legenda CAPE (overlay) selalu tampil, di atas legenda param
  const def = LEGEND.cape;
  $("cape-legend-head").textContent = LAYER_LABEL.cape + " · " + def.head;
  $("cape-legend-cells").innerHTML = cellsHtml(def.cells);
}

/* ---- Frame helpers ---- */
function frameT(f) {
  if (f && f.valid_time) return Date.parse(f.valid_time);
  if (f && f.date) return Date.UTC(+f.date.slice(0, 4), +f.date.slice(4, 6) - 1, +f.date.slice(6, 8), 12);
  return 0;
}
function nowIndex() {
  if (!frames.length) return 0;
  const target = OC && OC.now ? Date.parse(OC.now) : Date.now();
  let best = 0, bd = Infinity;
  frames.forEach((f, i) => { const d = Math.abs(frameT(f) - target); if (d < bd) { bd = d; best = i; } });
  return best;
}
function frameTimeLabel(f) {
  if (!f) return "—";
  if (f.valid_time) { const w = toWIB(f.valid_time); return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}, ${String(w.getUTCHours()).padStart(2, "0")}:00 WIB`; }
  if (f.date) { const d = f.date; return `${+d.slice(6, 8)} ${MONTHS[+d.slice(4, 6) - 1]} ${d.slice(0, 4)}`; }
  return "—";
}
function buildTicks() {
  const wrap = $("tl-ticks"), n = frames.length;
  if (!n) { wrap.innerHTML = ""; return; }
  let prev = null;
  wrap.innerHTML = frames.map((f, i) => {
    const pos = n === 1 ? 0 : (i / (n - 1)) * 100;
    const edge = i === 0 ? " edge-start" : (i === n - 1 ? " edge-end" : "");
    let lbl = "", isDay = false;
    if (f.valid_time) { const w = toWIB(f.valid_time), day = w.getUTCDate(); isDay = i === 0 || day !== prev; prev = day; lbl = isDay ? `${day} ${MONTHS[w.getUTCMonth()]}` : ""; }
    else if (f.date) { lbl = `${+f.date.slice(6, 8)} ${MONTHS[+f.date.slice(4, 6) - 1]}`; isDay = true; }
    return `<div class="tl-tick${isDay ? " day" : ""}${edge}" style="left:${pos}%"><span class="tl-tick-mark"></span>${lbl ? `<span class="tl-tick-lbl">${lbl}</span>` : ""}</div>`;
  }).join("");
}
function updateRangeFill() {
  const sl = $("time-slider"), pct = sl.max > 0 ? (sl.value / sl.max) * 100 : 0;
  // Dipasang di INDUKNYA, bukan di slidernya. Label jam .tl-cur itu saudara
  // slider, bukan anaknya, dan variabel CSS cuma menurun ke bawah. Dari induk
  // dua duanya kebagian.
  sl.parentElement.style.setProperty("--fill", pct.toFixed(2) + "%");
}

/* ---- Velocity (partikel) ---- */
function clearVel() { if (velLayer && map.hasLayer(velLayer)) map.removeLayer(velLayer); velLayer = null; }
async function updateVel(f) {
  const lay = OC.layers[activeLayer];
  if (!f || !f.vec) { clearVel(); return; }
  let data = velCache[f.vec];
  if (!data) { data = await fetch("data/output/" + f.vec, { cache: "no-store" }).then((r) => r.json()).catch(() => null); if (!data) return; velCache[f.vec] = data; }
  if (!velLayer) {
    velLayer = L.velocityLayer({
      displayValues: false, data,
      velocityScale: lay.velScale || 0.05, maxVelocity: lay.maxVel || 20, minVelocity: 0,
      particleAge: 90, particleMultiplier: 0.006, lineWidth: 1.6, frameRate: 20,
      colorScale: lay.colors || ["#ffffff"],
    });
    velLayer.addTo(map);
  } else { velLayer.setData(data); if (!map.hasLayer(velLayer)) velLayer.addTo(map); }
}

/* ---- Kontur ---- */
function clearOverlay() { if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay); overlay = null; }

/* ---- Overlay CAPE (potensi badai): selalu nempel di atas param dasar ---- */
let stormOverlay = null;
function updateStorm(t) {
  const cl = OC && OC.layers.cape;
  if (!cl || !cl.frames || !cl.frames.length) return;
  let best = cl.frames[0], bd = Infinity;   // frame CAPE terdekat waktunya ke frame dasar
  cl.frames.forEach((f) => { const d = Math.abs(frameT(f) - t); if (d < bd) { bd = d; best = f; } });
  const b = cl.bounds, bounds = [[b.latS, b.lonW], [b.latN, b.lonE]];
  const url = "data/output/" + best.png;
  if (stormOverlay) { stormOverlay.setUrl(url); stormOverlay.setBounds(bounds); }
  else stormOverlay = L.imageOverlay(url, bounds, { opacity: 0.60, interactive: false, pane: "storm" }).addTo(map);
}

function showFrame(i) {
  frameIdx = Math.max(0, Math.min(frames.length - 1, i));
  const f = frames[frameIdx]; if (!f) return;
  const lay = OC.layers[activeLayer], b = lay.bounds;
  const bounds = [[b.latS, b.lonW], [b.latN, b.lonE]];
  const url = "data/output/" + f.png;
  if (overlay) { overlay.setUrl(url); overlay.setBounds(bounds); }
  else overlay = L.imageOverlay(url, bounds, { opacity: 0.9, interactive: false, pane: "data" }).addTo(map);
  $("valid-time").textContent = frameTimeLabel(f);
  $("time-slider").value = frameIdx;
  updateRangeFill();
  updateVel(f);
  updateStorm(frameT(f));   // sinkronkan overlay CAPE ke waktu frame dasar
}

/* ---- Ganti parameter ---- */
function setLayer(key) {
  const lay = OC.layers[key]; if (!lay) return;
  activeLayer = key;
  document.querySelectorAll(".layer-btn").forEach((b) => b.classList.toggle("active", b.dataset.layer === key));
  renderLegend(key);
  frameRegion();   // reframe konsisten tiap ganti parameter (angin = arus = wave)
  if (lay.soon || !lay.frames || !lay.frames.length) {   // wave: segera hadir
    frames = []; clearOverlay(); clearVel();
    $("valid-time").textContent = "Segera hadir";
    $("tl-ticks").innerHTML = ""; $("time-slider").max = "0"; $("time-slider").value = "0"; updateRangeFill();
    toast(lay.label + " belum tersedia, segera hadir");
    return;
  }
  frames = lay.frames;
  clearVel();   // recreate partikel biar velScale/warna ikut parameter baru
  $("time-slider").max = String(Math.max(0, frames.length - 1));
  buildTicks();
  showFrame(nowIndex());
}

/* ---- Timeline ---- */
$("time-slider").addEventListener("input", (e) => { if (playing) togglePlay(); showFrame(+e.target.value); });
function togglePlay() {
  if (!frames.length) return;
  playing = !playing;
  $("play-icon").textContent = playing ? "pause" : "play_arrow";
  if (playing) playTimer = setInterval(() => showFrame((frameIdx + 1) % frames.length), 900);
  else clearInterval(playTimer);
}
$("play-btn").addEventListener("click", togglePlay);
document.querySelectorAll(".layer-btn").forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer)));

/* ---- Kontrol ---- */
$("zoom-in").addEventListener("click", () => map.zoomIn());
$("zoom-out").addEventListener("click", () => map.zoomOut());
$("fs-btn").addEventListener("click", () => {
  $("stage").classList.toggle("immersive");
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
  setTimeout(() => map.invalidateSize(), 60);
});
$("share-btn")?.addEventListener("click", async () => {
  try { if (navigator.share) await navigator.share({ title: "CESGS Baruna", url: location.href }); else { await navigator.clipboard.writeText(location.href); toast("Link disalin"); } } catch (_) {}
});
function toast(m) { const t = $("toast"); if (!t) return; t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
/* ---- Penjelasan tiap parameter (bahasa awam) ---- */
const PARAM_INFO = {
  cape: { title: "Potensi badai", body: "Ukuran seberapa gampang awan badai tumbuh. Makin tinggi angkanya, makin besar peluang hujan deras, petir, dan angin kencang yang datang tiba-tiba. Titik warna yang bergerak di atas peta itu arah dan kecepatan angin." },
  arus: { title: "Arus laut", body: "Aliran air laut, ke mana dan sekencang apa airnya bergerak. Kalau arahnya searah tujuan kapal, laju kapal terbantu dan bahan bakar lebih irit. Kalau berlawanan, kapal jadi lebih berat dan boros." },
  wave: { title: "Gelombang", body: "Tinggi ombak dari lembah ke puncaknya. Makin tinggi ombak, makin kencang kapal terguncang dan makin besar risikonya, apalagi buat kapal kecil." },
};
{
  const box = $("param-overlay");
  const setP = (on) => { if (!box) return; box.classList.toggle("show", on); box.setAttribute("aria-hidden", on ? "false" : "true"); };
  document.querySelectorAll(".lb-info").forEach((el) => {
    const open = (e) => {
      e.stopPropagation(); e.preventDefault();
      const d = PARAM_INFO[el.dataset.info]; if (!d) return;
      $("param-title").textContent = d.title; $("param-body").textContent = d.body; setP(true);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
  });
  $("param-close")?.addEventListener("click", () => setP(false));
  box?.addEventListener("click", (e) => { if (e.target === box) setP(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setP(false); });
}
{
  const aboutBox = $("about-overlay");
  const setAbout = (on) => { if (!aboutBox) return; aboutBox.classList.toggle("show", on); aboutBox.setAttribute("aria-hidden", on ? "false" : "true"); };
  $("about-btn")?.addEventListener("click", () => setAbout(true));
  $("about-close")?.addEventListener("click", () => setAbout(false));
  aboutBox?.addEventListener("click", (e) => { if (e.target === aboutBox) setAbout(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setAbout(false); });
}

/* ---- Init ---- */
fetch(DATA, { cache: "no-store" }).then((r) => r.json()).then((doc) => {
  OC = doc;
  /* BINGKAI = SELURUH DOMAIN DATA, bukan kotak sempit `view`.
     Diubah 5 November 2026 supaya sama dengan Atmosight di data GFS.
     `view` dulu memangkasnya jadi 72..168 BT dan 22 LU/LS, padahal
     datanya sendiri sampai 60..180 BT dan 33 derajat. Yang terpangkas
     itu justru tempat siklon tropis lahir, di utara Filipina dan di
     barat laut Australia, jadi lapisan siklon yang akan ditambahkan
     tidak akan pernah terlihat utuh.
     Diambil dari bounds lapisan, bukan diketik, supaya kalau backend
     memperluas domainnya bingkai ini ikut sendiri. */
  const lb = (OC.layers && (OC.layers.arus || OC.layers.angin)) ? (OC.layers.arus || OC.layers.angin).bounds : null;
  const v = lb || OC.view;
  VIEW_CORE = L.latLngBounds([v.latS, v.lonW], [v.latN, v.lonE]);
  dataBounds = VIEW_CORE;   // pan dikunci ke domain penuh
  frameRegion();
  loadAdmin();
  map.on("resize", frameRegion);
  if (OC.run) { const w = toWIB(OC.run); const ft = $("fresh-text"); if (ft) ft.textContent = `Update: ${String(w.getUTCHours()).padStart(2, "0")}:00 WIB, ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`; }
  renderCapeLegend();   // legenda CAPE statis (overlay selalu tampil)
  setLayer("arus");
  const ld = $("loading"); if (ld) ld.style.display = "none";
  setTimeout(() => { map.invalidateSize(); frameRegion(); }, 120);   // reframe setelah layout settle
}).catch((err) => { const ld = $("loading"); if (ld) { ld.style.display = "block"; ld.textContent = "Gagal memuat data: " + err; } console.error(err); });

/* Ekspos objek peta untuk modul Rute (rute.js). */
window.BARUNA_MAP = map;
/* Dipanggil rute.js: setInset simpan tinggi panel (dipakai frameRegion); reframe jalankan ulang
   framing domain. Dipisah biar fit-rute (gambarPeta) nggak ketimpa reframe domain. */
window.BARUNA_setInset = function (px) { bottomInset = Math.max(0, px || 0); };
window.BARUNA_setInsetX = function (px) { rightInset = Math.max(0, px || 0); };
window.BARUNA_reframe = function () { frameRegion(); };

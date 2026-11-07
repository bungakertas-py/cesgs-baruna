/* ===================================================================
   gerbang.js  Gerbang passcode sebelum masuk peta.

   INI BUKAN KEAMANAN, dan jangan pernah disebut begitu. Passcodenya ada
   di dalam berkas ini yang bisa dibaca siapa saja, dan seluruh isi
   data/output tetap bisa diambil langsung lewat alamatnya tanpa melewati
   gerbang ini sama sekali. Gunanya menghalangi orang yang nyasar dan
   membuat situsnya terasa tertutup, tidak lebih.

   Kalau datanya memang harus terkunci, yang dibutuhkan pemeriksaan di
   sisi peladen, dan situs ini harus berhenti jadi statis.
   =================================================================== */
(function () {
  "use strict";

  var PASSCODE = "baruna123!";
  var KUNCI = "baruna-gerbang";

  /* Disimpan sebagai cap, bukan passcodenya sendiri. Bukan demi aman,
     tapi supaya passcode tidak tergeletak terbaca di alat pengembang
     peramban orang yang kebetulan membukanya. */
  var CAP = "v1:" + PASSCODE.length + ":" + PASSCODE.charCodeAt(0);

  function sudahMasuk() {
    try { return localStorage.getItem(KUNCI) === CAP; } catch (e) { return false; }
  }
  function simpan() {
    try { localStorage.setItem(KUNCI, CAP); } catch (e) { /* mode privat, abaikan */ }
  }

  function buka(gb) {
    gb.classList.remove("show");
    document.getElementById("stage").classList.remove("terkunci");
    setTimeout(function () { gb.remove(); }, 320);
  }

  function pasang() {
    var stage = document.getElementById("stage");
    if (!stage) return;
    if (sudahMasuk()) return;

    stage.classList.add("terkunci");

    var gb = document.createElement("div");
    gb.id = "gerbang";
    gb.className = "gerbang";
    gb.innerHTML =
      '<form class="gerbang-kartu" autocomplete="off">' +
        '<img class="gerbang-logo" src="cesgs-mark.png" width="52" height="52" alt="CESGS" />' +
        '<label class="gerbang-label" for="gerbang-in">Masukkan passcode</label>' +
        '<input class="gerbang-in" id="gerbang-in" type="password" inputmode="text" ' +
               'autocomplete="off" spellcheck="false" aria-label="Passcode" />' +
        '<button class="gerbang-go" type="submit">Masuk</button>' +
        '<span class="gerbang-salah" aria-live="polite"></span>' +
      '</form>';
    stage.appendChild(gb);

    var form = gb.querySelector("form");
    var inp = gb.querySelector("#gerbang-in");
    var salah = gb.querySelector(".gerbang-salah");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (inp.value === PASSCODE) { simpan(); buka(gb); return; }
      salah.textContent = "Passcode salah";
      gb.querySelector(".gerbang-kartu").classList.remove("goyang");
      /* Memaksa peramban menghitung ulang tata letak. Tanpa ini, kelas yang
         baru dicabut lalu dipasang lagi dalam satu giliran tidak memicu
         animasi apa pun, dan goyangannya cuma jalan sekali seumur halaman. */
      void gb.offsetWidth;
      gb.querySelector(".gerbang-kartu").classList.add("goyang");
      inp.select();
    });
    inp.addEventListener("input", function () { salah.textContent = ""; });

    requestAnimationFrame(function () { gb.classList.add("show"); inp.focus(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pasang);
  } else { pasang(); }
})();

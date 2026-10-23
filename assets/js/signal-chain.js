/* =========================================================
   signal-chain.js — "Signal Chain" scroll section (index.html #chain)

   A code-built equipment rack. Scrolling moves the camera down the
   signal chain (ingest -> QC -> playout -> delivery), lights each zone,
   and shows that stage's project links.

   - Progressive enhancement: without WebGL, with reduced motion, or if a
     library fails to load, the section stays a plain card grid.
   - Libraries (self-hosted in assets/vendor) load after the page has
     finished loading and the browser is idle, so the hero is never delayed
     and the 3D is ready before the visitor reaches the section.
   - A still poster of the opening shot fills the stage until the 3D's
     first frame is drawn.
   - Debug: add ?chaindebug to the URL for a frame counter overlay, or
     ?chaindebug=raw to also bypass GSAP smoothing.
   - Renders on demand: the GPU works only while the camera moves.
   ========================================================= */
(function () {
  "use strict";

  /* ===== PARAM: SIGNAL_CHAIN CONFIG — see PARAMETERS.md ===== */
  var CONFIG = {
    VENDOR_THREE: "assets/vendor/three.min.js",
    VENDOR_GSAP: ["assets/vendor/gsap.min.js", "assets/vendor/ScrollTrigger.min.js"],
    PRELOAD_MARGIN: "1500px 0px",    // load at once if the visitor gets this close before the idle load starts
    IDLE_TIMEOUT: 2500,              // ms after page load to start loading even if the browser never goes idle
    MAX_DPR: 1.75,                   // pixel-density cap for the renderer
    SCRUB_SMOOTHING: 0.5,            // seconds of lag between scroll and camera (0 = locked)
    FOV: 30,                         // camera field of view, degrees
    HOLD: 0.045,                     // how long the camera rests at each stop (fraction of scroll)
    SHIFT_WIDE: 0.15,                // wide screens: push rack right to clear the card
    SHIFT_TALL: 0.17,                // tall screens: push rack up to clear the card
    STAGE_COLOR: 0x0D1118,           // must match --stage-bg in signal-chain.css
    ZONE_NAMES: ["Ingest", "QC", "Playout", "Delivery"],
    // One key per card: intro, 4 stops, final. t = scroll position 0..1, ty = look-at height.
    CAMERA_KEYS: [
      { t: 0.00, az: -28, el: 12, dist: 11.5, ty: 2.45 },
      { t: 0.20, az: -8,  el: 8,  dist: 5.4,  ty: 3.75 },
      { t: 0.40, az: 30,  el: 5,  dist: 5.4,  ty: 2.95 },
      { t: 0.60, az: -24, el: 3,  dist: 5.8,  ty: 1.85 },
      { t: 0.80, az: 22,  el: 12, dist: 5.4,  ty: 0.90 },
      { t: 1.00, az: 155, el: 26, dist: 11.5, ty: 2.50 }
    ],
    LED: { idle: 0x2E384A, active: 0xFFB020, done: 0x4FE3A6 }
  };
  /* ========================================================== */

  var section = document.getElementById("chain");
  if (!section) return;
  var pin = section.querySelector(".chain-pin");
  var stage = section.querySelector(".chain-stage");
  var canvas = section.querySelector(".chain-canvas");
  var cards = Array.prototype.slice.call(section.querySelectorAll(".chain-card"));
  var ticks = Array.prototype.slice.call(section.querySelectorAll(".chain-tick"));
  var hudStop = document.getElementById("chainStop");
  var hudZone = document.getElementById("chainZone");
  var statusEl = section.querySelector(".chain-status");
  var rail = document.querySelector(".rail");

  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, v)); };
  var smooth = function (u) { return u * u * (3 - 2 * u); };
  var lerp = function (a, b, u) { return a + (b - a) * u; };

  function webglAvailable() {
    try {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return false;
      var ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
      return true;
    } catch (e) { return false; }
  }

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !webglAvailable() || cards.length !== CONFIG.CAMERA_KEYS.length) return; // card grid stays

  /* ---------- Live layout (cheap; the 3D comes later) ---------- */
  section.classList.add("is-live");
  var railH = 52;
  function measureRail() {
    railH = rail ? rail.offsetHeight : 0;
    section.style.setProperty("--rail-h", railH + "px");
  }
  measureRail();
  var stickyTop = function () { return railH + 12; };
  var scrollSpan = function () { return Math.max(1, pin.offsetHeight - stage.offsetHeight); };
  var rawProgress = function () { return clamp((stickyTop() - pin.getBoundingClientRect().top) / scrollSpan()); };

  /* ---------- Camera path: hold at each key, smoothstep between ---------- */
  var path = [];
  CONFIG.CAMERA_KEYS.forEach(function (k) {
    path.push({ t: clamp(k.t - CONFIG.HOLD), k: k });
    path.push({ t: clamp(k.t + CONFIG.HOLD), k: k });
  });
  function camAt(p) {
    if (p <= path[0].t) return path[0].k;
    var last = path[path.length - 1];
    if (p >= last.t) return last.k;
    var i = 0;
    while (p > path[i + 1].t) i++;
    var a = path[i], b = path[i + 1];
    if (a.k === b.k || b.t === a.t) return a.k;
    var u = smooth((p - a.t) / (b.t - a.t));
    return { az: lerp(a.k.az, b.k.az, u), el: lerp(a.k.el, b.k.el, u), dist: lerp(a.k.dist, b.k.dist, u), ty: lerp(a.k.ty, b.k.ty, u) };
  }
  function stopAt(p) {
    var best = 0, bd = Infinity;
    CONFIG.CAMERA_KEYS.forEach(function (k, i) { var d = Math.abs(p - k.t); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  /* ---------- Debug overlay (?chaindebug) ---------- */
  var dbgMatch = location.search.match(/[?&]chaindebug(?:=([^&]*))?(?:&|$)/);
  var dbgParam = dbgMatch ? (dbgMatch[1] || "on") : null;
  var dbg = null;
  if (dbgParam) {
    dbg = { el: document.createElement("div"), renders: 0, gpu: "-", mode: "raw" };
    dbg.el.className = "chain-debug";
    dbg.el.setAttribute("aria-hidden", "true");
    stage.appendChild(dbg.el);
  }
  function showDebug() {
    if (!dbg) return;
    dbg.el.textContent = "renders " + dbg.renders + " | p " + state.p.toFixed(3) + " | stop " + currentStop +
      " | " + dbg.mode + " | dpr " + Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR).toFixed(2) + "\n" + dbg.gpu;
  }

  /* ---------- UI state (cards, ticks, HUD) ---------- */
  var state = { p: 0 };
  var currentStop = -1;
  var three = null;            // set once the 3D view is running

  function applyStop(stop) {
    if (stop === currentStop) return;
    currentStop = stop;
    var last = CONFIG.CAMERA_KEYS.length - 1;
    cards.forEach(function (c, i) {
      if (i === stop) c.setAttribute("aria-current", "step"); else c.removeAttribute("aria-current");
    });
    ticks.forEach(function (t, i) {
      var z = i + 1;
      t.dataset.state = stop === last || stop > z ? "done" : stop === z ? "active" : "idle";
    });
    if (stop === 0) { hudStop.textContent = "Standby"; hudZone.textContent = "Scroll to start"; }
    else if (stop === last) { hudStop.textContent = "All stages"; hudZone.textContent = "On air"; }
    else { hudStop.textContent = "Stop " + stop + "/4"; hudZone.textContent = CONFIG.ZONE_NAMES[stop - 1]; }
    hudZone.classList.toggle("on", stop === last);
    if (three) three.setZones(stop);
  }
  function update() {
    applyStop(stopAt(state.p));
    if (three) three.requestRender();
    showDebug();
  }

  // Raw scroll drives the UI until (or unless) GSAP takes over.
  var rawQueued = false;
  function onRawScroll() {
    if (rawQueued) return;
    rawQueued = true;
    requestAnimationFrame(function () { rawQueued = false; state.p = rawProgress(); update(); });
  }
  addEventListener("scroll", onRawScroll, { passive: true });
  addEventListener("resize", measureRail, { passive: true });
  state.p = rawProgress(); update();

  function scrollToStop(i, smoothly) {
    var top = window.scrollY + pin.getBoundingClientRect().top - stickyTop() + CONFIG.CAMERA_KEYS[i].t * scrollSpan();
    window.scrollTo({ top: Math.round(top), behavior: smoothly ? "smooth" : "auto" });
  }
  ticks.forEach(function (t, i) { t.addEventListener("click", function () { scrollToStop(i + 1, true); }); });
  // Keyboard users tabbing into a hidden card's link get scrolled to that stop.
  section.addEventListener("focusin", function (e) {
    var card = e.target.closest && e.target.closest(".chain-card");
    if (!card || !section.classList.contains("is-live")) return;
    var i = cards.indexOf(card);
    if (i > -1 && i !== currentStop) scrollToStop(i, false);
  });

  function fallBack(msg) {
    removeEventListener("scroll", onRawScroll);
    section.classList.remove("is-live");
    if (msg && window.console) console.warn("[signal-chain] " + msg);
  }

  /* ---------- Lazy load the libraries ---------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    statusEl.textContent = "Loading 3D view";
    loadScript(CONFIG.VENDOR_THREE)
      .then(function () {
        // GSAP is optional: without it the camera follows the scrollbar directly.
        return CONFIG.VENDOR_GSAP.reduce(function (pr, src) { return pr.then(function () { return loadScript(src); }); }, Promise.resolve())
          .catch(function () { return null; });
      })
      .then(start3D)
      .catch(function (e) { fallBack(e && e.message); });
  }
  // Load when the page is done and the browser is idle; earlier if the visitor jumps close first.
  function bootWhenIdle() {
    if (window.requestIdleCallback) requestIdleCallback(boot, { timeout: CONFIG.IDLE_TIMEOUT });
    else setTimeout(boot, 300);
  }
  if (document.readyState === "complete") bootWhenIdle();
  else addEventListener("load", bootWhenIdle, { once: true });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); boot(); }
    }, { rootMargin: CONFIG.PRELOAD_MARGIN });
    io.observe(section);
  }

  /* =========================================================
     3D view
     ========================================================= */
  function start3D() {
    var T = window.THREE;
    if (!T) throw new Error("three.js missing");
    var renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "default" });
    } catch (e) { throw new Error("WebGL could not start"); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    var built = buildRack(T);
    var scene = built.scene;
    var cam = new T.PerspectiveCamera(CONFIG.FOV, 1, 0.1, 100);
    var vw = 1, vh = 1, queued = false, alive = true;

    function frame(w, h) {
      // Shift the rack away from the card using a view offset on a larger virtual frame.
      var wide = w / h >= 1.05 && w >= 760;
      var sx = wide ? CONFIG.SHIFT_WIDE : 0, sy = wide ? 0 : CONFIG.SHIFT_TALL;
      var fw = w * (1 + 2 * sx), fh = h * (1 + 2 * sy);
      cam.fov = 2 * Math.atan(Math.tan(CONFIG.FOV * Math.PI / 360) * fh / h) * 180 / Math.PI;
      cam.aspect = fw / fh;
      cam.setViewOffset(fw, fh, 0, 2 * sy * h, w, h);
    }
    function place(c) {
      var aspect = vw / vh;
      var d = c.dist * (aspect < 1 ? 1 + (1 - aspect) * 0.9 : 1);
      var az = c.az * Math.PI / 180, el = c.el * Math.PI / 180;
      cam.position.set(d * Math.cos(el) * Math.sin(az), c.ty + d * Math.sin(el), d * Math.cos(el) * Math.cos(az));
      cam.lookAt(0, c.ty, 0);
    }
    function render() {
      queued = false;
      if (!alive) return;
      place(camAt(state.p));
      renderer.render(scene, cam);
      if (dbg) { dbg.renders++; showDebug(); }
    }
    function requestRender() { if (!queued && alive) { queued = true; requestAnimationFrame(render); } }
    function resize() {
      vw = stage.clientWidth; vh = stage.clientHeight;
      if (!vw || !vh) return;
      renderer.setSize(vw, vh, false);
      frame(vw, vh);
      requestRender();
    }
    var ro = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(stage); else addEventListener("resize", resize);

    three = { requestRender: requestRender, setZones: function (s) { built.setZones(s); requestRender(); } };
    built.setZones(currentStop < 0 ? 0 : currentStop);

    // GSAP takes over progress with smoothing, if it loaded.
    var tween = null;
    if (window.gsap && window.ScrollTrigger && dbgParam !== "raw") {
      gsap.registerPlugin(ScrollTrigger);
      removeEventListener("scroll", onRawScroll);
      state.p = rawProgress();
      tween = gsap.to(state, {
        p: 1, ease: "none",
        scrollTrigger: {
          trigger: pin,
          start: function () { return "top " + stickyTop() + "px"; },
          end: function () { return "bottom " + (stickyTop() + stage.offsetHeight) + "px"; },
          scrub: CONFIG.SCRUB_SMOOTHING,
          invalidateOnRefresh: true
        },
        onUpdate: update
      });
      ScrollTrigger.refresh();
      if (dbg) dbg.mode = "gsap";
    }
    if (dbg) {
      try {
        var gl = renderer.getContext(), ri = gl.getExtension("WEBGL_debug_renderer_info");
        dbg.gpu = ri ? gl.getParameter(ri.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch (e) { dbg.gpu = "gpu unknown"; }
    }

    // Compile all shaders now so the first scroll doesn't stall, then draw and reveal.
    resize(); place(camAt(state.p));
    try { renderer.compile(scene, cam); } catch (e) {}
    update(); render();
    requestAnimationFrame(function () { stage.classList.add("is-ready"); });
    statusEl.textContent = ""; statusEl.hidden = true;

    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault(); alive = false; fallBack("WebGL context lost");
    }, { once: true });

    addEventListener("pagehide", function () {
      alive = false;
      if (tween) { if (tween.scrollTrigger) tween.scrollTrigger.kill(); tween.kill(); }
      if (ro) ro.disconnect(); else removeEventListener("resize", resize);
      removeEventListener("scroll", onRawScroll);
      built.dispose(); renderer.dispose();
    }, { once: true });
  }

  /* =========================================================
     Rack model — built from primitives, no model files
     Units: 1U = 0.1. Rack interior runs from y 0.2 to 4.2.
     ========================================================= */
  function buildRack(T) {
    var U = 0.1;
    var keep = [];                       // everything to dispose
    var K = function (o) { keep.push(o); return o; };
    var scene = new T.Scene();
    scene.background = new T.Color(CONFIG.STAGE_COLOR);

    // Hex colours are written as sRGB; convert to linear so they render as specified.
    var lin = function (m) { if (m.color) m.color.convertSRGBToLinear(); return m; };
    var std = function (p) { return K(lin(new T.MeshStandardMaterial(p))); };
    var M = {
      frame:   std({ color: 0x1A1F27, roughness: 0.6, metalness: 0.35 }),
      side:    std({ color: 0x151A21, roughness: 0.75, metalness: 0.2 }),
      rail:    std({ color: 0x6C7584, roughness: 0.35, metalness: 0.8 }),
      chassis: std({ color: 0x20262F, roughness: 0.6, metalness: 0.3 }),
      faceA:   std({ color: 0x2A313C, roughness: 0.5, metalness: 0.35 }),
      faceB:   std({ color: 0x1E242D, roughness: 0.55, metalness: 0.3 }),
      faceC:   std({ color: 0x343C48, roughness: 0.45, metalness: 0.4 }),
      handle:  std({ color: 0x8E97A5, roughness: 0.3, metalness: 0.85 }),
      dark:    std({ color: 0x07090C, roughness: 0.9 }),
      bay:     std({ color: 0x3B4452, roughness: 0.5, metalness: 0.3 }),
      bnc:     std({ color: 0xB9C0CA, roughness: 0.28, metalness: 0.9 })
    };
    var basic = function (c) { return K(lin(new T.MeshBasicMaterial({ color: c, toneMapped: false }))); };
    var zoneMats = [0, 1, 2, 3].map(function () { return basic(CONFIG.LED.idle); });
    var lcdMat = basic(0x2A86A8);

    var box = function (w, h, d) { return K(new T.BoxGeometry(w, h, d)); };
    var add = function (geo, mat, x, y, z, parent) {
      var m = new T.Mesh(geo, mat); m.position.set(x, y, z); (parent || scene).add(m); return m;
    };

    // Instance lists, flushed into InstancedMeshes at the end
    var inst = { port: [], bay: [], bnc: [], btn: [], led: [[], [], [], []] };
    var btnColors = [];
    var BTN_PALETTE = [0x3B4452, 0x3B4452, 0x3B4452, 0x2A86A8, 0xC9A227, 0x3AA878];

    /* ---- Canvas textures for the screens ---- */
    function tex(w, h, draw) {
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      draw(c.getContext("2d"), w, h);
      var t = K(new T.CanvasTexture(c)); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
      return t;
    }
    var MONO = "500 {s}px 'IBM Plex Mono', ui-monospace, monospace";
    var font = function (s) { return MONO.replace("{s}", s); };
    function picture(g, x, y, w, h, hue) {
      var gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, "hsl(" + hue + ",38%,30%)"); gr.addColorStop(1, "hsl(" + (hue + 40) + ",45%,14%)");
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = "hsla(" + (hue + 180) + ",40%,60%,.25)";
      g.beginPath(); g.arc(x + w * 0.65, y + h * 0.45, h * 0.22, 0, Math.PI * 2); g.fill();
    }
    var mvTex = tex(768, 288, function (g, w, h) {
      g.fillStyle = "#05070B"; g.fillRect(0, 0, w, h);
      var cols = 4, rows = 2, pad = 6, tw = (w - pad * (cols + 1)) / cols, th = (h - pad * (rows + 1)) / rows;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var i = r * cols + c, x = pad + c * (tw + pad), y = pad + r * (th + pad);
        picture(g, x, y, tw, th, (i * 47) % 360);
        g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x, y + th - 22, tw, 22);
        g.fillStyle = "#E6EAF0"; g.font = font(13); g.fillText("CH " + String(i + 1).padStart(2, "0"), x + 7, y + th - 7);
        for (var b = 0; b < 2; b++) { g.fillStyle = "#4FE3A6"; var bh = th * (0.35 + ((i * 13 + b * 7) % 10) / 20); g.fillRect(x + tw - 14 + b * 6, y + th - 24 - bh * 0.6, 4, bh * 0.6); }
        var alarm = i === 6;
        g.strokeStyle = alarm ? "#FFB020" : "#4FE3A6"; g.lineWidth = alarm ? 3 : 1.5; g.strokeRect(x + 1, y + 1, tw - 2, th - 2);
        if (alarm) { g.fillStyle = "#FFB020"; g.font = font(12); g.fillText("AUDIO SILENCE", x + 7, y + 18); }
      }
    });
    var ccTex = tex(640, 288, function (g, w, h) {
      picture(g, 0, 0, w, h, 205);
      g.fillStyle = "rgba(0,0,0,.82)"; g.fillRect(w * 0.18, h * 0.7, w * 0.64, 40);
      g.fillStyle = "#FFFFFF"; g.font = font(20); g.textAlign = "center"; g.fillText("CAPTION DATA PRESENT", w / 2, h * 0.7 + 27);
      g.textAlign = "left"; g.fillStyle = "#4FE3A6"; g.font = font(15); g.fillText("608 · CC1 · OK", 14, 26);
    });
    var wfTex = tex(384, 160, function (g, w, h) {
      g.fillStyle = "#020403"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(79,227,166,.18)"; g.lineWidth = 1;
      for (var i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, h * i / 5); g.lineTo(w, h * i / 5); g.stroke(); }
      g.fillStyle = "rgba(79,227,166,.55)";
      for (var x = 0; x < w; x += 1) for (var k = 0; k < 6; k++) {
        var y = h * (0.35 + 0.25 * Math.sin(x / 23 + k) * Math.cos(x / 61) + (k - 3) * 0.035);
        g.fillRect(x, y, 1, 1.4);
      }
    });
    var tallyTex = tex(256, 72, function (g, w, h) {
      g.fillStyle = "#FF3B30"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#FFFFFF"; g.font = "700 40px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("ON AIR", w / 2, h / 2 + 2);
    });
    var screenMat = function (t) { return K(new T.MeshBasicMaterial({ map: t, toneMapped: false })); };

    /* ---- Rack frame ---- */
    var post = box(0.05, 4.3, 0.05);
    [[-0.5, 0.6], [0.5, 0.6], [-0.5, -0.6], [0.5, -0.6]].forEach(function (p) { add(post, M.frame, p[0], 2.15, p[1]); });
    add(box(1.05, 0.18, 1.25), M.frame, 0, 0.09, 0);            // plinth
    add(box(1.05, 0.08, 1.25), M.frame, 0, 4.34, 0);            // top cap
    var sidePanel = box(0.02, 4.12, 1.15);
    add(sidePanel, M.side, -0.515, 2.24, 0); add(sidePanel, M.side, 0.515, 2.24, 0);
    var railGeo = box(0.035, 4.06, 0.03);
    add(railGeo, M.rail, -0.465, 2.2, 0.535); add(railGeo, M.rail, 0.465, 2.2, 0.535);
    add(railGeo, M.rail, -0.465, 2.2, -0.54); add(railGeo, M.rail, 0.465, 2.2, -0.54);

    // ON AIR lamp on the top cap
    var lampMat = screenMat(tallyTex);
    add(box(0.4, 0.12, 0.08), M.dark, 0, 4.44, 0.38);
    var lampFace = K(new T.PlaneGeometry(0.36, 0.1));
    add(lampFace, lampMat, 0, 4.44, 0.421);
    add(lampFace, lampMat, 0, 4.44, 0.339).rotation.y = Math.PI;   // readable from the rear shot too

    /* ---- Equipment, top to bottom (zone, units, kind) ---- */
    var LAYOUT = [
      [0, 1, "ird"], [0, 1, "ird"], [0, 1, "fiber"], [0, 2, "server"], [0, 2, "server"], [0, 1, "blank"],
      [1, 4, "ccmon"], [1, 2, "scope"], [1, 2, "server"], [1, 1, "blank"],
      [2, 3, "server"], [2, 2, "server"], [2, 5, "router"], [2, 2, "recorder"], [2, 1, "blank"],
      [3, 1, "encoder"], [3, 1, "encoder"], [3, 1, "switch"], [3, 4, "mv"], [3, 2, "blank"]
    ];
    var FZ = 0.5;                                  // faceplate z
    var cablePoints = [];                          // [zone, y] rear exits
    var yTop = 4.2;
    var mtx = new T.Matrix4();
    var at = function (list, x, y, z) { list.push(new T.Vector3(x, y, z)); };

    LAYOUT.forEach(function (row, n) {
      var zone = row[0], units = row[1], kind = row[2];
      var h = units * U - 0.008, cy = yTop - units * U / 2;
      yTop -= units * U;
      var face = kind === "blank" ? M.faceB : kind === "router" || kind === "mv" || kind === "ccmon" ? M.faceC : M.faceA;
      if (kind !== "blank") add(box(0.86, h, 1.0), M.chassis, 0, cy, -0.02);
      add(box(0.96, h, 0.025), face, 0, cy, FZ);
      if (units >= 2 && kind !== "mv" && kind !== "ccmon") {
        var hg = box(0.025, h * 0.6, 0.035);
        add(hg, M.handle, -0.43, cy, FZ + 0.03); add(hg, M.handle, 0.43, cy, FZ + 0.03);
      }
      var zf = FZ + 0.014, i;
      if (kind !== "blank") {
        at(inst.led[zone], 0.36, cy + h * 0.22, zf); at(inst.led[zone], 0.39, cy + h * 0.22, zf);
        at(inst.led[zone], 0.3, cy, -0.526); at(inst.led[zone], 0.33, cy, -0.526);   // rear status LEDs
      }

      switch (kind) {
        case "ird":
        case "encoder":
          add(box(0.2, 0.045, 0.004), lcdMat, -0.22, cy, zf);
          for (i = 0; i < 4; i++) { at(inst.btn, -0.05 + i * 0.045, cy, zf); btnColors.push(BTN_PALETTE[0]); }
          if (kind === "encoder") for (i = 0; i < 2; i++) at(inst.port, 0.18 + i * 0.05, cy, zf);
          break;
        case "fiber":
          for (i = 0; i < 8; i++) { at(inst.port, -0.32 + i * 0.07, cy, zf); at(inst.led[zone], -0.32 + i * 0.07, cy + 0.03, zf); }
          break;
        case "server":
          var rowsB = Math.max(1, units - (units > 2 ? 1 : 0)), bh = (h - 0.02) / rowsB;
          for (var r = 0; r < rowsB; r++) for (i = 0; i < 6; i++) {
            at(inst.bay, -0.33 + i * 0.105, cy + h / 2 - 0.01 - bh * (r + 0.5), zf);
            if (i % 2 === 0) at(inst.led[zone], -0.3 + i * 0.105, cy + h / 2 - 0.01 - bh * (r + 0.5) - bh * 0.25, zf + 0.008);
          }
          break;
        case "ccmon":
          add(K(new T.PlaneGeometry(0.78, h - 0.06)), screenMat(ccTex), 0, cy, zf);
          break;
        case "mv":
          add(K(new T.PlaneGeometry(0.86, h - 0.05)), screenMat(mvTex), 0, cy, zf);
          break;
        case "scope":
          add(K(new T.PlaneGeometry(0.34, h - 0.04)), screenMat(wfTex), -0.2, cy, zf);
          for (i = 0; i < 6; i++) { at(inst.btn, 0.06 + (i % 3) * 0.06, cy + (i < 3 ? 0.03 : -0.03), zf); btnColors.push(BTN_PALETTE[0]); }
          break;
        case "router":
          for (var rr = 0; rr < 3; rr++) for (i = 0; i < 16; i++) {
            at(inst.btn, -0.4 + i * 0.05, cy + 0.11 - rr * 0.06, zf);
            btnColors.push(BTN_PALETTE[(i * 7 + rr * 3) % BTN_PALETTE.length]);
          }
          add(box(0.3, 0.05, 0.004), lcdMat, -0.25, cy - 0.15, zf);
          break;
        case "recorder":
          for (i = 0; i < 8; i++) at(inst.bnc, -0.3 + i * 0.075, cy + 0.02, zf + 0.01);
          break;
        case "switch":
          for (i = 0; i < 24; i++) {
            var px = -0.38 + (i % 12) * 0.055, py = cy + (i < 12 ? 0.018 : -0.018);
            at(inst.port, px, py, zf);
            if (i % 3 !== 1) at(inst.led[zone], px + 0.016, py + 0.012, zf + 0.004);
          }
          break;
      }
      if (kind !== "blank") { cablePoints.push([zone, cy]); if (units >= 2) cablePoints.push([zone, cy - h * 0.25]); }
    });

    /* ---- Flush instances ---- */
    function instanced(list, geo, mat, colors) {
      if (!list.length) return null;
      var im = new T.InstancedMesh(geo, mat, list.length);
      list.forEach(function (v, i) {
        mtx.makeTranslation(v.x, v.y, v.z); im.setMatrixAt(i, mtx);
        if (colors) im.setColorAt(i, new T.Color(colors[i]).convertSRGBToLinear());
      });
      im.instanceMatrix.needsUpdate = true;
      if (colors && im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im); return im;
    }
    instanced(inst.port, box(0.032, 0.026, 0.012), M.dark);
    instanced(inst.bay, box(0.095, 0.06, 0.012), M.bay);
    var bncGeo = K(new T.CylinderGeometry(0.014, 0.014, 0.03, 16)); bncGeo.rotateX(Math.PI / 2);
    instanced(inst.bnc, bncGeo, M.bnc);
    instanced(inst.btn, box(0.03, 0.022, 0.012), std({ color: 0xFFFFFF, roughness: 0.5 }), btnColors);
    var ledGeo = box(0.012, 0.012, 0.006);
    inst.led.forEach(function (list, z) { instanced(list, ledGeo, zoneMats[z]); });

    /* ---- Rear cabling ---- */
    var CABLE = [0x2A8FB5, 0xC9A227, 0x3AA878, 0x6B7586].map(function (c) { return std({ color: c, roughness: 0.55, metalness: 0.05 }); });
    cablePoints.forEach(function (cp, i) {
      var side = i % 2 ? 0.4 : -0.4, x0 = ((i * 37) % 60) / 100 - 0.3, y = cp[1];
      var curve = new T.CatmullRomCurve3([
        new T.Vector3(x0, y, -0.52), new T.Vector3(x0 * 0.7, y - 0.02, -0.6),
        new T.Vector3(side, y - 0.08, -0.62), new T.Vector3(side + (i % 3 - 1) * 0.015, 0.45, -0.6),
        new T.Vector3(side * 0.85, 0.2, -0.45)
      ]);
      add(K(new T.TubeGeometry(curve, 48, 0.011, 6, false)), CABLE[(cp[0] + i) % CABLE.length], 0, 0, 0);
    });

    /* ---- Floor, shadow, light ---- */
    var grid = new T.GridHelper(14, 28, 0x232B38, 0x161B23);
    keep.push(grid.geometry, grid.material); scene.add(grid);
    var sc = document.createElement("canvas"); sc.width = sc.height = 256;
    var sg = sc.getContext("2d"), rg = sg.createRadialGradient(128, 128, 8, 128, 128, 128);
    rg.addColorStop(0, "rgba(0,0,0,.7)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = rg; sg.fillRect(0, 0, 256, 256);
    var shGeo = K(new T.PlaneGeometry(3.2, 3.2)); shGeo.rotateX(-Math.PI / 2);
    add(shGeo, K(new T.MeshBasicMaterial({ map: K(new T.CanvasTexture(sc)), transparent: true, depthWrite: false })), 0, 0.002, 0);

    scene.add(new T.HemisphereLight(0xDFE7F0, 0x0B0E14, 0.6));
    var key = new T.DirectionalLight(0xFFFFFF, 1.0); key.position.set(4, 7, 6); scene.add(key);
    var rim = new T.DirectionalLight(0x9FC4DD, 0.8); rim.position.set(-5, 4, -5); scene.add(rim);
    var fill = new T.DirectionalLight(0xFFE2B8, 0.25); fill.position.set(-4, 2, 4); scene.add(fill);

    /* ---- Zone state: 0 = intro, 1..4 = stops, 5 = final ---- */
    var lampOff = new T.Color(0x1A1414), lampOn = new T.Color(0xFFFFFF);
    function setZones(stop) {
      var last = CONFIG.CAMERA_KEYS.length - 1;
      zoneMats.forEach(function (m, z) {
        var s = stop === last || stop - 1 > z ? "done" : stop - 1 === z ? "active" : "idle";
        m.color.setHex(CONFIG.LED[s]).convertSRGBToLinear();
      });
      lampMat.color.copy(stop === last ? lampOn : lampOff);
    }

    return {
      scene: scene,
      setZones: setZones,
      dispose: function () {
        keep.forEach(function (o) { if (o && o.dispose) o.dispose(); });
        scene.traverse(function (o) { if (o.isInstancedMesh) o.dispose && o.dispose(); });
      }
    };
  }
})();

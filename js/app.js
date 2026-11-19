(() => {
  const DEFAULTS = {
    cover: "#f4b8a8", bg: "#fbeee9", pages: "#ffffff",
    title: "My Cards", sub: "Vol. I", sound: "typewriter", volume: 0.5,
  };
  const LIMITS = { title: 20, sub: 22 };
  // text shrinks as it gets longer so it always fits on one line: [chars at full size, smallest scale]
  const FIT = { title: [10, 0.5], sub: [14, 0.65] };

  const COVER_COLORS = ["#f4b8a8", "#f2a9c0", "#cdb8ee", "#a9cdf0", "#a8dfc8", "#bcd6a8", "#f5e0a0", "#f7c99a"];
  const BG_COLORS    = ["#fbeee9", "#fcebf2", "#f0eafc", "#e8f1fb", "#e6f6ef", "#f1f6e4", "#fcf6e0", "#f4f1ee"];
  const PAGE_COLORS  = ["#ffffff", "#f3ecdc", "#fbd9e0", "#d6e6f7", "#d4efe1", "#e4daf5", "#3a3744", "#16141a"];

  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  let state = load();

  function load() {
    let s;
    try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("sleeve.settings")) }; }
    catch { s = { ...DEFAULTS }; }
    // older saves stored sound as a boolean
    if (s.sound === true) s.sound = "typewriter";
    if (s.sound === false) s.sound = "off";
    if (s.sound === "soft") s.sound = "typewriter";
    return s;
  }
  function save() {
    try { localStorage.setItem("sleeve.settings", JSON.stringify(state)); } catch {}
  }

  /* ---------------- appearance ---------------- */
  const isDark = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110;
  };

  const COLOR_SETS = [
    { wrap: "coverSwatches", pick: "coverPick", key: "cover", colors: COVER_COLORS },
    { wrap: "bgSwatches",    pick: "bgPick",    key: "bg",    colors: BG_COLORS },
    { wrap: "pagesSwatches", pick: "pagesPick", key: "pages", colors: PAGE_COLORS },
  ];

  function apply() {
    root.style.setProperty("--cover", state.cover);
    root.style.setProperty("--bg", state.bg);
    root.style.setProperty("--pages", state.pages);
    // lines and sleeves flip to light on dark pages so they stay visible
    const dark = isDark(state.pages);
    root.style.setProperty("--seam", dark ? "rgba(255,255,255,.32)" : "rgba(91,74,112,.32)");
    root.style.setProperty("--thread", dark ? "rgba(255,255,255,.45)" : "rgba(91,74,112,.45)");
    root.style.setProperty("--sleeve-bg", dark ? "rgba(255,255,255,.06)" : "rgba(91,74,112,.05)");
    root.style.setProperty("--sleeve-edge", dark ? "rgba(255,255,255,.26)" : "rgba(91,74,112,.2)");

    for (const { wrap, pick, key } of COLOR_SETS) {
      $(pick).value = state[key];
      $(wrap).querySelectorAll(".swatch").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.c.toLowerCase() === state[key].toLowerCase())));
    }
    $("soundSeg").querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.v === state.sound)));
    $("volume").value = Math.round(state.volume * 100);
  }

  for (const { wrap, pick, key, colors } of COLOR_SETS) {
    colors.forEach((c) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.setProperty("--c", c);
      b.dataset.c = c;
      b.setAttribute("aria-label", c);
      b.addEventListener("click", () => { state[key] = c; apply(); save(); });
      $(wrap).append(b);
    });
    $(pick).addEventListener("input", (e) => { state[key] = e.target.value; apply(); save(); });
  }

  $("soundSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.sound = b.dataset.v;
    apply(); save();
    if (state.sound !== "off") loadSounds().then(() => play("key"));   // preview
  });

  // volume: moving the slider is silent; letting go plays one gentle sample at the new level
  $("volume").addEventListener("input", (e) => {
    state.volume = e.target.value / 100;
    setVolume(); save();
  });
  $("volume").addEventListener("change", () => {
    if (state.sound !== "off") loadSounds().then(() => play("key"));
  });

  $("reset").addEventListener("click", () => {
    state.cover = DEFAULTS.cover; state.bg = DEFAULTS.bg; state.pages = DEFAULTS.pages;
    apply(); save();
  });

  /* ---------------- settings panel ---------------- */
  const cog = $("cog"), panel = $("panel");
  let closeT = 0;
  const panelOpen = () => !panel.hidden && !panel.classList.contains("closing");
  function setOpen(open) {
    clearTimeout(closeT);
    cog.setAttribute("aria-expanded", String(open));
    if (open) {
      panel.classList.remove("closing");
      panel.hidden = false;
    } else if (!panel.hidden) {
      // play the closing animation, then hide
      panel.classList.add("closing");
      closeT = setTimeout(() => { panel.hidden = true; panel.classList.remove("closing"); }, reduceMotion ? 0 : 180);
    }
  }
  cog.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!panelOpen()); });
  document.addEventListener("click", (e) => {
    if (panelOpen() && !panel.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || cropOpen) return;
    if (panelOpen()) setOpen(false);
    else if (panel.classList.contains("closing")) return;
    else if (document.activeElement.classList.contains("edit")) return;   // Esc cancels the edit instead
    else setAlbumOpen(false);
  });

  /* ---------------- typing sounds ----------------
     Real recordings of a manual typewriter, sliced into single strikes (see /sounds).
     Each press picks a random strike, never the same twice in a row, with a tiny
     pitch and volume variation so fast typing doesn't sound like a loop.        */
  const SOUND_FILES = {
    key:   [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `sounds/key${n}.wav`),
    space: ["sounds/space.wav"],
    back:  ["sounds/back.wav"],
    page:  ["sounds/page.wav"],
  };
  let ac, bus, bank = null, loading = null;
  const lastPick = {};
  const rand = (a, b) => a + Math.random() * (b - a);

  function audio() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // a limiter on the output means nothing can ever spike, whatever the volume
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      limiter.connect(ac.destination);
      bus = ac.createGain();
      bus.connect(limiter);
      setVolume();
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }

  // squared curve so the low end of the slider is genuinely quiet; max is still moderate
  function setVolume() {
    if (bus) bus.gain.value = 0.6 * state.volume * state.volume;
  }

  function loadSounds() {
    if (loading) return loading;
    const a = audio();
    loading = (async () => {
      const out = {};
      for (const [kind, files] of Object.entries(SOUND_FILES)) {
        out[kind] = await Promise.all(files.map(async (f) => {
          const res = await fetch(f);
          return a.decodeAudioData(await res.arrayBuffer());
        }));
      }
      bank = out;
    })().catch(() => { loading = null; });   // silent if the files can't be loaded
    return loading;
  }

  function sample(buffer, rate, gain) {
    const a = audio();
    const src = a.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start();
  }

  function play(kind) {
    if (state.sound === "off") return;
    if (!bank) { loadSounds(); return; }
    const list = bank[kind === "enter" ? "space" : kind];
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[kind]) i = (i + 1) % list.length;
    lastPick[kind] = i;

    sample(list[i], (kind === "enter" ? 0.9 : 1) * rand(0.96, 1.04), rand(0.82, 1));
  }

  function keySound(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") play("enter");
    else if (e.key === " ") play("space");
    else if (e.key === "Backspace" || e.key === "Delete") play("back");
    else if (e.key.length === 1) play("key");
  }

  // page turn: a real recording, played the same way every time (only a hair of variation) so
  // turns sound consistent, and always started the moment the page lifts
  function playPage() {
    if (state.sound === "off") return;
    if (!bank) { loadSounds(); return; }
    sample(bank.page[0], rand(0.99, 1.01), rand(0.95, 1));
  }

  // a card slipping into its sleeve: a soft, dry slide of plastic that fades away. Made on the
  // fly (no file) from filtered noise.
  let noise = null;
  function slideGraph(a, out, t) {
    if (!noise || noise.sampleRate !== a.sampleRate) {
      noise = a.createBuffer(1, Math.round(a.sampleRate * 0.7), a.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource();
    src.buffer = noise;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(2000, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.6);
  }
  function playSlide() {
    if (state.sound === "off") return;
    const a = audio();
    slideGraph(a, bus, a.currentTime + 0.01);
  }

  /* ---------------- editable label ---------------- */
  const binder = $("binder");
  const lines = {};
  binder.querySelectorAll(".line").forEach((line) => {
    const key = line.dataset.key;
    lines[key] = { line, text: line.querySelector(".text") };
    line.querySelector(".pencil").addEventListener("click", (e) => { e.stopPropagation(); startEdit(key); });
  });

  function fit(key, value) {
    const [full, min] = FIT[key];
    lines[key].line.style.setProperty("--fit", Math.max(min, Math.min(1, full / Math.max(value.length, 1))));
  }

  function renderLabel() {
    for (const key of ["title", "sub"]) {
      lines[key].text.textContent = state[key];
      lines[key].line.classList.toggle("empty", !state[key]);
      fit(key, state[key]);
    }
  }

  function startEdit(key) {
    const { line, text } = lines[key];
    if (line.classList.contains("editing")) return;
    if (state.sound !== "off") loadSounds();

    const input = document.createElement("input");
    input.className = "edit";
    input.type = "text";
    input.value = state[key];
    input.maxLength = LIMITS[key];
    input.placeholder = key === "title" ? "Title" : "Add a subtitle";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", key === "title" ? "Album title" : "Album subtitle");

    line.classList.add("editing");
    binder.classList.add("editing");
    text.hidden = true;
    line.insertBefore(input, text);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    let cancelled = false;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { cancelled = true; input.blur(); return; }
      keySound(e);
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });

    // the title may never be empty
    input.addEventListener("input", () => {
      fit(key, input.value);
      input.classList.toggle("invalid", key === "title" && !input.value.trim());
    });

    input.addEventListener("blur", () => {
      const v = input.value.trim();
      if (!cancelled && !(key === "title" && !v)) {
        state[key] = v;
        save();
      }
      input.remove();
      text.hidden = false;
      line.classList.remove("editing");
      binder.classList.remove("editing");
      renderLabel();
    });
  }

  /* ---------------- the album: cover, pages and page turning ---------------- */
  const scene = document.querySelector(".scene");
  const stage = document.querySelector(".stage");
  const front = binder.querySelector(".face.front");
  const cover = $("cover");
  const pageLabel = $("pageLabel"), prevBtn = $("prevBtn"), nextBtn = $("nextBtn");

  const SHEETS = 3;                                  // each sheet has a page on each side
  const TOTAL_PAGES = SHEETS * 2 + 2;                // + one inside the front cover, one on the back board

  const TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h7.2a1.5 1.5 0 0 0 1.5-1.4L18 7"/><path d="M10 11v5.5M14 11v5.5"/></svg>';
  const EYE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const UPLOAD_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>';

  // ----- build the pages: 9 pockets (each with a sleeve) plus a shadow layer -----
  function fillPage(page, index) {
    page.dataset.page = index;
    for (let i = 0; i < 9; i++) {
      const pocket = document.createElement("div");
      pocket.className = "pocket";
      const sleeve = document.createElement("div");
      sleeve.className = "sleeve";
      const add = document.createElement("button");
      add.className = "upload";
      add.type = "button";
      add.setAttribute("aria-label", "Add a card");
      add.innerHTML = UPLOAD_ICON;
      pocket.append(sleeve, add);
      page.append(pocket);
    }
    const cast = document.createElement("div");
    cast.className = "cast";
    page.append(cast);
    return cast;
  }
  const makePage = (side) => {
    const p = document.createElement("div");
    p.className = `page page-${side}`;
    return p;
  };
  const face = (kind, page) => {
    const f = document.createElement("div");
    f.className = `face ${kind}`;
    f.append(page);
    return f;
  };

  // page 0 is inside the front cover (left); the last page is on the back board (right)
  const coverCast = fillPage(binder.querySelector(".face.back .page-l"), 0);
  const boardCast = fillPage(binder.querySelector(".binder > .page-r"), TOTAL_PAGES - 1);

  // sheet i: front = page 2i+1 (right side), back = page 2i+2 (left side once turned)
  const sheets = [];
  for (let i = 0; i < SHEETS; i++) {
    const el = document.createElement("div");
    el.className = "sheet";
    const pr = makePage("r"), pl = makePage("l");
    el.append(face("front", pr), face("back", pl));
    binder.insertBefore(el, cover);
    sheets.push({ el, p: 0, raf: 0, moving: false, dir: 1,
                  frontCast: fillPage(pr, 2 * i + 1), backCast: fillPage(pl, 2 * i + 2) });
  }

  let flipped = 0;               // how many sheets are (heading) turned over to the left

  // ----- drawing: z-order and soft shadows follow each sheet's progress -----
  // Everything per-frame is written straight onto the few elements that change, and only when
  // the value actually changed. (Setting a CSS variable on the sheet would make the browser
  // re-resolve every element inside it, hundreds of them, on every frame.)
  const setOpacity = (el, v) => {
    v = Math.round(v * 1000) / 1000;
    if (el._o !== v) { el._o = v; el.style.opacity = v; }
  };

  function render() {
    const n = sheets.length;
    const onRight = new Array(n + 1).fill(0);    // shadow cast on the right-hand page under sheet j
    const onLeft = new Array(n + 1).fill(0);     // shadow cast on the left-hand page under sheet j
    sheets.forEach((s, j) => {
      const sh = Math.sin(Math.PI * s.p) * 0.13;
      onRight[j + 1] = Math.max(onRight[j + 1], sh);
      onLeft[j] = Math.max(onLeft[j], sh);
      // by position, not direction, so two pages turning at once pass each other correctly: on the
      // right the lower sheet number is on top, on the left the higher one is
      const z = (s.moving ? 300 : 0) + (s.p < 0.5 ? 100 - j : 10 + j);
      if (s.z !== z) { s.z = z; s.el.style.zIndex = z; }
    });
    sheets.forEach((s, j) => {
      const own = Math.sin(Math.PI * s.p) * 0.06;  // a page dims a little as it lifts
      setOpacity(s.frontCast, Math.max(onRight[j], own));
      setOpacity(s.backCast, Math.max(onLeft[j + 1], own));
      if (s.curl) s.shades.forEach((el) => setOpacity(el, own));
    });
    setOpacity(boardCast, onRight[n]);
    setOpacity(coverCast, onLeft[0]);
  }

  const STRIPS = 10;                       // slices a turning page is cut into
  const BEND = 31;                         // degrees of bend across the whole page

  function setP(s, p) {
    s.p = p;
    const past = p >= 0.5;
    if (s.past !== past) { s.past = past; s.el.classList.toggle("past", past); }
    s.el.style.transform = `rotateY(${(-p * 180).toFixed(3)}deg)`;
    if (s.curl) {
      // each strip tilts a little more than the one before it, so the paper bends. Early in the
      // turn the outer edge leads, late in the turn it trails; flat at both ends. The lean toward
      // the pointer builds up strip by strip, so the edge at the spine never moves.
      // The tip leads the turn for its first half and is straight for the second half, in either
      // direction. (It used to be keyed to the page's angle, which is only "the first half" when
      // turning right-to-left: turning back, the bend was still there as the page landed, and the
      // strips and the flat page ended up a few pixels apart, so the edge slid as they swapped.)
      const dir = s.dir;                                // 1 = turning left, -1 = turning back
      const t = dir > 0 ? p : 1 - p;                    // how far through this turn, 0..1
      const wave = t < 0.5 ? Math.sin(t * 2 * Math.PI) : 0;
      const bend = (-dir * wave * BEND) / (STRIPS - 1);
      // The lean is a shear (skewY), which keeps every strip's edges vertical, so neighbouring
      // strips always stay joined. (Rotating each strip up or down would crack the page open.)
      const lean = (-Math.sin(p * Math.PI) * (s.tilt || 0) * 0.5) / (STRIPS - 1);
      const tf = `rotateY(${bend.toFixed(3)}deg) skewY(${lean.toFixed(3)}deg)`;
      for (let k = 1; k < STRIPS; k++) s.strips[k].style.transform = tf;
    }
    render();
  }

  // ----- curl: while a page is turning it is swapped for a row of thin strips -----
  function slice(kind, page, offset, w, h) {
    const f = document.createElement("div");
    f.className = `sface ${kind}`;
    const holder = document.createElement("div");
    holder.className = "clone";
    holder.style.cssText = `left:${offset}px;width:${w}px;height:${h}px`;
    const copy = page.cloneNode(true);
    copy.querySelectorAll(".cast").forEach((c) => c.remove());
    holder.append(copy);
    const shade = document.createElement("div");
    shade.className = "shade";
    f.append(holder, shade);
    return f;
  }

  // built once per sheet and then reused
  function buildCurl(s) {
    const w = s.el.offsetWidth, h = s.el.offsetHeight, sw = w / STRIPS;
    const fp = s.el.querySelector(":scope > .face.front > .page");
    const bp = s.el.querySelector(":scope > .face.back > .page");
    const curl = document.createElement("div");
    curl.className = "curl";
    s.strips = []; s.shades = []; s.sfaces = [];
    let parent = curl;
    for (let k = 0; k < STRIPS; k++) {
      const strip = document.createElement("div");
      strip.className = "strip" + (k === STRIPS - 1 ? " edge" : "");
      // 1px overlap hides hairline gaps, except on the last strip, which must end exactly
      // where the flat page ends or the page appears to shift when it lands
      const sw2 = k < STRIPS - 1 ? sw + 1 : sw;
      strip.style.width = `${sw2}px`;
      if (k > 0) strip.style.left = `${sw}px`;
      // the back face is seen mirrored (flipped about the middle of this strip, which is
      // sw2 wide), so strip k shows column (STRIPS-1-k) of it, offset to stay exactly registered
      const fr = slice("front", fp, -k * sw, w, h), bk = slice("back", bp, sw2 - (STRIPS - k) * sw, w, h);
      strip.append(fr, bk);
      s.strips.push(strip);
      s.shades.push(fr.lastChild, bk.lastChild);
      s.sfaces.push(fr, bk);
      parent.append(strip);
      parent = strip;
    }
    curl.style.display = "none";
    s.el.append(curl);
    s.curlEl = curl;
  }

  // The fade is on each strip's faces, never on the .curl itself: anything less than fully opaque
  // on a 3D group flattens it, and then the strips' back sides stop being hidden, so the other
  // side's cards flashed through for the duration of the fade.
  function fadeCurl(s, to, seconds) {
    for (const f of s.sfaces) {
      f.style.transition = seconds ? `opacity ${seconds}s linear` : "none";
      f.style.opacity = to;
    }
  }

  function enterCurl(s) {
    if (s.curl || reduceMotion) return;
    if (!s.curlEl) buildCurl(s);
    const curl = s.curlEl;
    clearTimeout(s.hideT);
    // fade the strips in over the flat page rather than swapping instantly: the two are drawn
    // by different paths and differ by a few pixels, which would otherwise show as a pop
    fadeCurl(s, 0, 0);
    curl.style.display = "";
    s.curl = curl;
    setP(s, s.p);                                   // pose the strips before they appear
    curl.getBoundingClientRect();
    fadeCurl(s, 1, 0.09);
    clearTimeout(s.curlT);
    s.curlT = setTimeout(() => s.el.classList.add("curling"), 100);
  }

  function exitCurl(s) {
    if (!s.curl) return;
    // ...and fade them back out over the flat page as it lands
    const old = s.curl;
    s.curl = null;
    clearTimeout(s.curlT);
    s.el.classList.remove("curling");
    fadeCurl(s, 0, 0.14);
    s.hideT = setTimeout(() => { old.style.display = "none"; }, 180);
  }

  // ----- animation -----
  // A page doesn't ease gently into place: it lifts off slowly and then falls, arriving with some
  // speed and stopping dead. Easing the angle to a standstill (a classic ease-in-out) is wrong
  // here: near the end the page is almost edge-on to the eye, so the last few degrees are a few
  // pixels of sideways travel, and a slow tail turns them into a visible creep after the page
  // already looks landed. Arriving with speed finishes that in a few frames instead.
  const easeInOut = (u) => 1 - Math.cos((Math.PI * u) / 2);      // slow lift-off, arrives at speed
  const easeOut = (u) => 1 - Math.pow(1 - u, 1.25);              // a flick: fast start, nearly steady finish

  // ----- the pointer: the page leans toward wherever the mouse is vertically -----
  let pointerY = 0;
  let tiltNow = 0, rectAt = -1e9, binderRect = null;
  function tiltTarget(now) {
    if (now - rectAt > 300) { binderRect = binder.getBoundingClientRect(); rectAt = now; }  // not every frame
    const r = binderRect;
    const ny = Math.max(-1, Math.min(1, (pointerY - r.top - r.height / 2) / (r.height / 2)));
    return ny * -7;                                    // degrees
  }

  // ----- motion of a turning page: position and lean -----
  function motion(s, p, landing = false) {
    // The page leans toward the pointer only while you are dragging it. In an automatic turn (a
    // click, a key, or the finish of a flick) the lean fades out instead: it makes the far edge
    // swing up or down and then settle, which reads as the page overshooting its landing.
    tiltNow += ((landing ? 0 : tiltTarget(performance.now())) - tiltNow) * (landing ? 0.25 : 0.2);
    s.tilt = tiltNow;
    setP(s, p);
    // Hand over from the strips to the flat page a hair BEFORE the page lands, while it is
    // barely moving, not on the final frame. Doing it on the landing frame meant any hitch from
    // the swap showed up as the page jerking at the very end of a click or a flick.
    if (landing && s.curl && ((s.dir > 0 && p >= 0.985) || (s.dir < 0 && p <= 0.015))) exitCurl(s);
  }

  function animateTo(s, to, opts = {}) {
    const { out = false, delay = 0 } = opts;
    cancelAnimationFrame(s.raf);
    stopPeel(s);
    s.dir = to > s.p ? 1 : -1;
    s.moving = true;
    enterCurl(s);
    render();
    const from = s.p;
    const dur = reduceMotion ? 1 : (out ? 300 : 420) + 560 * Math.abs(to - from);
    if (!opts.silent && Math.abs(to - from) > 0.05) setTimeout(playPage, delay);
    return new Promise((resolve) => {
      let t0 = null;
      const tick = (t) => {
        if (t0 === null) t0 = t + delay;
        const u = Math.min(1, Math.max(0, (t - t0) / dur));
        motion(s, from + (to - from) * (out ? easeOut(u) : easeInOut(u)), true);
        if (u < 1) s.raf = requestAnimationFrame(tick);
        else {
          s.raf = 0; s.moving = false;
          exitCurl(s); render(); resolve();
        }
      };
      s.raf = requestAnimationFrame(tick);
    });
  }

  // ----- peek: near a page's outer edge the page lifts a little and can be clicked to turn -----
  const HOT = 0.1, PEEK = 0.05;                       // hot-zone width (of a page), max lift (p)
  function stopPeel(s) { cancelAnimationFrame(s.peelRaf); s.peelRaf = 0; s.peel = 0; s.peelGoal = 0; }
  function peelStep(s, side) {                         // side: 1 = on the right, 0 = on the left
    const cur = s.peel || 0, goal = s.peelGoal || 0;
    const next = Math.abs(goal - cur) < 0.0004 ? goal : cur + (goal - cur) * 0.25;
    s.peel = next;
    setP(s, side ? next : 1 - next);
    s.peelRaf = next === goal ? 0 : requestAnimationFrame(() => peelStep(s, side));
  }
  function peelSheet(s, side, goal) {
    if (!s || s.moving || (s.peelGoal || 0) === goal) return;
    s.peelGoal = goal;
    cancelAnimationFrame(s.peelRaf);
    s.peelRaf = requestAnimationFrame(() => peelStep(s, side));
  }
  // where is the pointer relative to the spread? returns { side, depth } or null
  function hotZone(x, y) {
    if (!isOpen() || closing || dragging || cropOpen) return null;
    const r = binder.getBoundingClientRect();
    if (y < r.top + r.height * 0.03 || y > r.bottom - r.height * 0.03) return null;
    const w = r.width * 0.965;
    if (x > r.left && x <= r.left + w) {
      const d = (x - (r.left + w * (1 - HOT))) / (w * HOT);
      return flipped < SHEETS && d > 0 ? { side: 1, depth: Math.min(1, d) } : null;
    }
    if (x < r.left && x >= r.left - w) {
      const d = ((r.left - w * (1 - HOT)) - x) / (w * HOT);
      return flipped > 0 && d > 0 ? { side: 0, depth: Math.min(1, d) } : null;
    }
    return null;
  }
  // After a page turns, the pointer is usually still sitting on the page edge it just turned.
  // The next page must not start lifting underneath it (it looks like the page slides after
  // landing), so peeking stays off until the pointer has left the edge and come back.
  let peelLock = false;
  function updatePeek(e) {
    let z = e.pointerType === "touch" ? null : hotZone(e.clientX, e.clientY);
    if (!z) peelLock = false;
    else if (peelLock) z = null;
    binder.classList.toggle("peeking", !!z);
    const right = flipped < SHEETS ? sheets[flipped] : null;
    const left = flipped > 0 ? sheets[flipped - 1] : null;
    peelSheet(right, 1, z && z.side === 1 ? PEEK * z.depth : 0);
    peelSheet(left, 0, z && z.side === 0 ? PEEK * z.depth : 0);
  }
  binder.addEventListener("pointermove", updatePeek);
  binder.addEventListener("pointerleave", () => {
    binder.classList.remove("peeking");
    sheets.forEach((s, j) => peelSheet(s, j < flipped ? 0 : 1, 0));
  });

  // ----- paging -----
  function updatePager() {
    pageLabel.textContent = `${2 * flipped + 1}–${2 * flipped + 2} of ${TOTAL_PAGES}`;
    prevBtn.disabled = flipped <= 0;
    nextBtn.disabled = flipped >= SHEETS;
  }
  const isOpen = () => binder.classList.contains("open");
  let closing = false, dragging = false;

  function next() {
    if (!isOpen() || closing || dragging || flipped >= SHEETS) return;
    peelLock = true;
    animateTo(sheets[flipped], 1);
    flipped++;
    updatePager();
  }
  function prev() {
    if (!isOpen() || closing || dragging || flipped <= 0) return;
    flipped--;
    peelLock = true;
    animateTo(sheets[flipped], 0);
    updatePager();
  }
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);
  document.addEventListener("keydown", (e) => {
    if (cropOpen || (document.activeElement && document.activeElement.classList.contains("edit"))) return;
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  });

  // ----- drag a page: its edge follows the pointer -----
  let drag = null, suppressClick = false;

  binder.addEventListener("pointerdown", (e) => {
    if (!isOpen() || closing || e.button !== 0) return;
    const rect = binder.getBoundingClientRect();        // left edge = the spine
    const onRightSide = e.clientX > rect.left;
    if (onRightSide ? flipped >= SHEETS : flipped <= 0) return;
    const width = rect.width * 0.965;                   // one page, as it appears on screen
    const grab = Math.max(0.25, Math.abs(e.clientX - rect.left) / width);  // where on the page it was grabbed
    drag = { id: e.pointerId, startX: e.clientX, spine: rect.left, width, grab, right: onRightSide,
             active: false, sheet: sheets[onRightSide ? flipped : flipped - 1], samples: [] };
  });

  window.addEventListener("pointermove", (e) => {
    pointerY = e.clientY;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(dx) < 8 || (drag.right ? dx > 0 : dx < 0)) return;   // must pull the page the right way
      drag.active = true; dragging = true;
      cancelAnimationFrame(drag.sheet.raf);
      stopPeel(drag.sheet);
      binder.classList.remove("peeking");
      drag.sheet.moving = true; drag.sheet.dir = drag.right ? 1 : -1;
      enterCurl(drag.sheet);
      playPage();                                  // the sound belongs to the moment the page lifts
      try { binder.setPointerCapture(e.pointerId); } catch {}
    }
    // keep the grabbed point under the pointer: x = spine + grab*width*cos(angle)
    const c = Math.max(-1, Math.min(1, (e.clientX - drag.spine) / (drag.grab * drag.width)));
    motion(drag.sheet, Math.acos(c) / Math.PI);
    drag.samples.push({ p: drag.sheet.p, t: performance.now() });
    if (drag.samples.length > 6) drag.samples.shift();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.active) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = a && b && b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;      // progress per ms
    const p = d.sheet.p;
    const goLeft = v > 0.0008 ? true : v < -0.0008 ? false : p > 0.5;   // a flick wins over position
    dragging = false;
    peelLock = true;
    if (goLeft && d.right) flipped++;
    if (!goLeft && !d.right) flipped--;
    animateTo(d.sheet, goLeft ? 1 : 0, { out: true, silent: true });
    updatePager();
  }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  // a drag must not count as a click on whatever pocket it ended over
  binder.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  // clicking the lifted outer edge turns the page
  binder.addEventListener("click", (e) => {
    // the click that opens the cover lands on the cover, which is now "open" and over a page's
    // edge: it must not also turn that page
    if (e.target.closest(".cover > .face.front, .upload, .cardbtn") || performance.now() - openedAt < 700) return;
    const z = hotZone(e.clientX, e.clientY);
    if (z) (z.side ? next : prev)();
  });

  // ----- cards: pick a file, crop it to card shape, drop it into the pocket -----
  const CARD_W = 63, CARD_H = 88, OUT_W = 630, OUT_H = Math.round((OUT_W * CARD_H) / CARD_W);
  const cropper = $("cropper"), cropFrame = $("cropFrame"), cropCanvas = $("cropCanvas");
  const cropZoom = $("cropZoom"), fileInput = $("fileInput");
  let cropOpen = false, crop = null, pendingPocket = null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ----- saving: each cropped card is kept in the browser (IndexedDB) under the pocket it sits in -----
  // key = "<page number>:<pocket number>", value = the card's JPEG. If the browser won't give us
  // storage (some private windows), the album still works, it just forgets the cards on reload.
  const cardDB = new Promise((resolve) => {
    try {
      const req = indexedDB.open("sleeve", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("cards");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  const cardKey = (pocket) => `${pocket.parentNode.dataset.page}:${[...pocket.parentNode.children].indexOf(pocket)}`;
  async function dbRun(mode, fn) {
    const db = await cardDB;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction("cards", mode);
        const out = fn(tx.objectStore("cards"));
        tx.oncomplete = () => resolve(out && "result" in out ? out.result : true);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function saveCard(pocket, blob) {
    dbRun("readwrite", (st) => st.put(blob, cardKey(pocket)));
    // ask the browser not to clear the cards when it is short of space
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // put saved cards back into their pockets (no animation: they were already there)
  async function restoreCards() {
    const saved = await dbRun("readonly", (st) => st.getAll());
    const keys = await dbRun("readonly", (st) => st.getAllKeys());
    if (!saved || !keys) return;
    keys.forEach((key, n) => {
      const [page, i] = String(key).split(":");
      const holder = document.querySelector(`.page[data-page="${page}"]`);
      const pocket = holder && holder.children[+i];
      if (pocket && pocket.classList.contains("pocket")) showCard(pocket, URL.createObjectURL(saved[n]));
    });
  }

  binder.addEventListener("click", (e) => {
    const b = e.target.closest(".upload");
    if (b) {
      pendingPocket = b.closest(".pocket");
      fileInput.click();
      return;
    }
    const del = e.target.closest(".del");
    if (del) askDelete(del.closest(".pocket"));
    // (.view, the eye, doesn't do anything yet)
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try { openCropper(await createImageBitmap(file)); }
    catch { alert("Sorry, that file couldn't be read as an image."); }
  });

  // the part of the picture inside the frame: the biggest card-shaped area at zoom 1, smaller as you zoom
  function cropView() {
    const { bmp, z } = crop, ar = CARD_W / CARD_H;
    let sw, sh;
    if (bmp.width / bmp.height > ar) { sh = bmp.height; sw = sh * ar; } else { sw = bmp.width; sh = sw / ar; }
    sw /= z; sh /= z;
    crop.cx = clamp(crop.cx, sw / 2, bmp.width - sw / 2);
    crop.cy = clamp(crop.cy, sh / 2, bmp.height - sh / 2);
    return { sx: crop.cx - sw / 2, sy: crop.cy - sh / 2, sw, sh };
  }
  function drawCrop(ctx, w, h) {
    const v = cropView();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(crop.bmp, v.sx, v.sy, v.sw, v.sh, 0, 0, w, h);
  }
  function paintCrop() {
    if (!crop) return;
    const r = cropFrame.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cropCanvas.width !== w || cropCanvas.height !== h) { cropCanvas.width = w; cropCanvas.height = h; }
    drawCrop(cropCanvas.getContext("2d"), w, h);
  }
  const setZoom = (v) => { cropZoom.value = clamp(v, 0, 100); crop.z = 1 + cropZoom.value / 100 * 3; paintCrop(); };

  function openCropper(bmp) {
    crop = { bmp, cx: bmp.width / 2, cy: bmp.height / 2, z: 1 };
    cropZoom.value = 0;
    cropper.hidden = false;
    cropOpen = true;
    binder.classList.remove("peeking");
    paintCrop();
    $("cropDone").focus();
  }
  function closeCropper() {
    cropper.hidden = true;
    cropOpen = false;
    if (crop) crop.bmp.close();
    crop = null;
  }

  // the dialog fades away while the card flies out of it; input stays locked until the card lands
  function leaveCropper() {
    cropper.classList.add("leaving");
    setTimeout(() => { cropper.hidden = true; cropper.classList.remove("leaving"); }, 320);
    if (crop) crop.bmp.close();
    crop = null;
  }

  cropZoom.addEventListener("input", () => setZoom(+cropZoom.value));
  cropFrame.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(+cropZoom.value - e.deltaY / 12); }, { passive: false });
  let panFrom = null;
  cropFrame.addEventListener("pointerdown", (e) => { panFrom = { x: e.clientX, y: e.clientY }; cropFrame.setPointerCapture(e.pointerId); });
  cropFrame.addEventListener("pointermove", (e) => {
    if (!panFrom) return;
    const k = cropView().sw / cropFrame.clientWidth;      // source pixels per screen pixel
    crop.cx -= (e.clientX - panFrom.x) * k;
    crop.cy -= (e.clientY - panFrom.y) * k;
    panFrom = { x: e.clientX, y: e.clientY };
    paintCrop();
  });
  cropFrame.addEventListener("pointerup", () => { panFrom = null; });
  cropFrame.addEventListener("pointercancel", () => { panFrom = null; });

  $("cropCancel").addEventListener("click", closeCropper);
  cropper.addEventListener("click", (e) => { if (e.target === cropper) closeCropper(); });
  $("cropDone").addEventListener("click", () => {
    const out = document.createElement("canvas");
    out.width = OUT_W; out.height = OUT_H;
    drawCrop(out.getContext("2d"), OUT_W, OUT_H);
    const pocket = pendingPocket;
    const from = cropFrame.getBoundingClientRect();      // where the card starts its flight
    out.toBlob((blob) => {
      saveCard(pocket, blob);
      leaveCropper();
      setCard(pocket, URL.createObjectURL(blob), from);
    }, "image/jpeg", 0.9);
  });
  document.addEventListener("keydown", (e) => {
    if (cropper.hidden || cropper.classList.contains("leaving")) return;
    if (e.key === "Escape") closeCropper();
    else if (e.key === "Enter" && e.target.tagName !== "BUTTON") $("cropDone").click();
  });
  window.addEventListener("resize", paintCrop);

  // which way a sleeve opens, in the page's own frame: +1 = to the right, -1 = to the left. Sleeves
  // open toward the outer edge, except the outermost column, which opens toward the centre.
  function openSide(pocket) {
    const page = pocket.parentNode;
    const i = [...page.children].indexOf(pocket);
    const rightPage = page.classList.contains("page-r");
    const outermost = rightPage ? i % 3 === 2 : i % 3 === 0;
    return (rightPage ? 1 : -1) * (outermost ? -1 : 1);
  }

  // The card leaves the crop dialog, falls onto the page and comes to rest just outside the
  // sleeve's open edge; from there it slides in. It starts out of the dialog lifting a little,
  // then accelerates as it falls, so it arrives at speed and the slide carries on from it.
  const FLIGHT = 640;
  const SLIDE_IN = { duration: 560, easing: "cubic-bezier(.1, .6, .25, 1)" };
  const SLIDE_OUT = { duration: 420, easing: "cubic-bezier(.4, 0, .7, .7)", fill: "forwards" };

  async function fly(url, from, to, dir) {
    const f = document.createElement("img");
    f.className = "flyer";
    f.src = url;
    f.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
    document.body.append(f);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const k = to.width / from.width;
    const lift = "0 14px 26px -8px rgba(74, 63, 88, .45)", rest = "0 1px 3px rgba(74, 63, 88, .25)";
    await f.animate([
      { transform: "translate(0, 0) scale(1) rotate(0deg)", boxShadow: lift },
      { transform: `translate(${dx * 0.04}px, ${-14}px) scale(1.05) rotate(${dir * -2}deg)`, boxShadow: lift,
        offset: 0.2, easing: "cubic-bezier(.5, 0, .8, .6)" },
      { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(0deg)`, boxShadow: rest },
    ], { duration: FLIGHT, easing: "cubic-bezier(.3, 0, .3, 1)", fill: "forwards" }).finished;
    return f;
  }

  // whatever happens, the lock comes off and no flyer is left behind
  async function setCard(pocket, url, from) {
    try { await placeCard(pocket, url, from); }
    finally {
      cropOpen = false;
      document.querySelectorAll(".flyer").forEach((f) => f.remove());
    }
  }

  // the sleeve's inside, made the first time a pocket gets a card
  function slotOf(pocket) {
    let slot = pocket.querySelector(".slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "slot";
      pocket.querySelector(".sleeve").after(slot);
      pocket.classList.add("has-card");
    }
    return slot;
  }
  function cardImage(url) {
    const img = document.createElement("img");
    img.className = "card";
    img.alt = "";
    img.draggable = false;
    img.src = url;
    return img;
  }
  // a card simply there, with no animation
  function showCard(pocket, url) {
    const slot = slotOf(pocket);
    const old = slot.querySelector(".card");
    if (old) { URL.revokeObjectURL(old.src); old.remove(); }
    slot.append(cardImage(url));
    addTools(pocket);
  }

  async function placeCard(pocket, url, from) {
    const dir = openSide(pocket);
    const away = `translateX(${dir * 105}%)`;
    const slot = slotOf(pocket);
    const img = cardImage(url);
    await img.decode().catch(() => {});
    img.style.transform = away;                       // where it waits, just outside the open edge
    img.style.visibility = "hidden";
    slot.append(img);

    let flyer = null;
    if (!reduceMotion && from) {
      pocket.style.zIndex = 5;
      flyer = await fly(url, from, img.getBoundingClientRect(), dir);
    }
    img.style.transform = "";
    img.style.visibility = "";
    if (!reduceMotion) {
      img.animate([{ transform: away }, { transform: "none" }], SLIDE_IN)
        .finished.then(() => { pocket.style.zIndex = ""; addTools(pocket); }, () => {});
      playSlide();
    } else { pocket.style.zIndex = ""; addTools(pocket); }
    if (flyer) flyer.remove();                        // the real card is in exactly the same place

    refreshCurl(pocket, SLIDE_IN.duration + 100);
  }

  // a sheet's turning strips are copies of its pages, so they are remade when a card comes or goes
  function refreshCurl(pocket, delay) {
    const s = sheets.find((sh) => sh.el.contains(pocket));
    if (s && s.curlEl) {
      s.curlEl.remove();
      s.curlEl = null;
      if (!reduceMotion) setTimeout(() => { if (!s.curlEl) buildCurl(s); }, delay);
    }
  }

  // the little buttons over a card: delete (top left) and view (bottom middle, not wired up yet)
  function addTools(pocket) {
    const slot = pocket.querySelector(".slot");
    if (!slot || slot.querySelector(".tools")) return;
    const tools = document.createElement("div");
    tools.className = "tools";
    tools.innerHTML =
      `<button class="cardbtn del" type="button" aria-label="Delete card">${TRASH_ICON}</button>` +
      `<button class="cardbtn view" type="button" aria-label="View card">${EYE_ICON}</button>`;
    slot.append(tools);
  }

  // deleting can't be undone, so ask first. Cancel has the focus, so a stray Enter is safe.
  const confirmBox = $("confirm");
  let deleting = null;
  function askDelete(pocket) {
    deleting = pocket;
    confirmBox.hidden = false;
    cropOpen = true;                                    // the album is locked while the question is up
    binder.classList.remove("peeking");
    $("confirmNo").focus();
  }
  function answerDelete(yes) {
    const pocket = deleting;
    deleting = null;
    confirmBox.hidden = true;
    cropOpen = false;
    if (yes && pocket) deleteCard(pocket);
  }
  $("confirmNo").addEventListener("click", () => answerDelete(false));
  $("confirmYes").addEventListener("click", () => answerDelete(true));
  confirmBox.addEventListener("click", (e) => { if (e.target === confirmBox) answerDelete(false); });
  document.addEventListener("keydown", (e) => { if (!confirmBox.hidden && e.key === "Escape") answerDelete(false); });

  // the card slides back out of its sleeve the way it came in, and is forgotten
  async function deleteCard(pocket) {
    const slot = pocket.querySelector(".slot");
    const img = slot && slot.querySelector(".card");
    if (!img || pocket.deleting) return;
    pocket.deleting = true;
    slot.querySelector(".tools")?.remove();
    dbRun("readwrite", (st) => st.delete(cardKey(pocket)));
    if (!reduceMotion) {
      pocket.style.zIndex = 5;                          // above its neighbours while it travels
      playSlide();
      await img.animate([
        { transform: "none", opacity: 1 },
        { transform: `translateX(${openSide(pocket) * 105}%)`, opacity: 0 },
      ], SLIDE_OUT).finished.catch(() => {});
    }
    URL.revokeObjectURL(img.src);
    slot.remove();
    pocket.classList.remove("has-card");
    pocket.style.zIndex = "";
    pocket.deleting = false;
    refreshCurl(pocket, 100);
  }

  // ----- open / close the cover; the 18-slot spread is centred -----
  // The spine is the scene's left edge. Sliding right by half a binder-width puts the spine,
  // and so the middle of the spread, at screen centre. If the spread is wider than the window
  // it also scales down to fit.
  function fitSpread() {
    const w = binder.offsetWidth;
    scene.style.setProperty("--open-x", `${w / 2}px`);
    scene.style.setProperty("--open-s", Math.min(1, (window.innerWidth - 24) / (2 * w)));
  }

  let openedAt = 0;
  function openAlbum() {
    if (closing || isOpen()) return;
    openedAt = performance.now();
    if (state.sound !== "off") loadSounds();        // so the very first page turn isn't silent
    // always open at the first page
    sheets.forEach((s) => { cancelAnimationFrame(s.raf); stopPeel(s); exitCurl(s); s.moving = false; setP(s, 0); });
    flipped = 0;
    fitSpread();
    // build the turning-page strips ahead of time, once the cover has finished opening, so the
    // first page turn doesn't have to build them mid-animation
    setTimeout(() => sheets.forEach((s) => { if (!s.curlEl && !reduceMotion) buildCurl(s); }), 1100);
    scene.classList.add("open");
    binder.classList.add("open");
    root.classList.add("album-open");
    front.setAttribute("aria-label", "");
    updatePager();
  }

  // closing first turns every page back (top page first), then shuts the cover
  async function closeAlbum() {
    if (!isOpen() || closing || dragging) return;
    closing = true;
    root.classList.remove("album-open");
    const back = [];
    for (let i = flipped - 1, k = 0; i >= 0; i--, k++) back.push(animateTo(sheets[i], 0, { delay: k * 90 }));
    flipped = 0;
    await Promise.all(back);
    scene.classList.remove("open");
    binder.classList.remove("open");
    front.setAttribute("aria-label", "Open the album");
    setTimeout(() => { closing = false; updatePager(); }, 900);
  }

  function setAlbumOpen(open) { return open ? openAlbum() : closeAlbum(); }

  front.addEventListener("click", () => {
    if (!binder.classList.contains("editing")) setAlbumOpen(true);
  });
  front.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === front) { e.preventDefault(); setAlbumOpen(true); }
  });
  // click the empty background to close
  stage.addEventListener("click", (e) => { if (e.target === stage && !cropOpen) setAlbumOpen(false); });
  window.addEventListener("resize", fitSpread);

  restoreCards();
  apply();
  renderLabel();
  fitSpread();
  render();
  updatePager();
})();

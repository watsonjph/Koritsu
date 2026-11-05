// Pixel-art companion: the character sprite sheet (assets/character.png, 8 walk frames of
// 64×64) acting out what you're doing. Backgrounds are drawn in code at 160×80 and doubled,
// the sprite is drawn at full detail on top.
//
// Moods: idle (strolling on the dock), productive (fishing or reading), wasted (in bed,
// doomscrolling), break (asleep). The outdoor sky follows the local time of day.
window.koritsuScene = (() => {
  const W = 160, H = 80, S = 2; // background resolution and its upscale
  const FPS = 30; // redraw rate: movement glides; sprite frames still step at their atlas timings
  const TICK = 125; // ms per "tick" (8 per second), the unit the scene's timings are written in
  const FW = 64, FRAMES = 8;

  // ---------- colour helpers ----------
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function fromHsl([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // ---------- the sprite sheet ----------
  // Colour groups in the sheet. Each pixel keeps its offset from the group's base colour, so a
  // new colour inherits the original shading.
  const GROUPS = {
    hair: { base: "#fdd777", colors: ["#fdd777", "#d79e52", "#c58146", "#af6d3f", "#ad6c39", "#974e1a"] }, // hair, ears and tail fur
    skin: { base: "#fce1c8", colors: ["#fce1c8", "#edb9af", "#cb8e76"] },
    eyes: { base: "#e1262b", colors: ["#e1262b", "#8a111c"], above: 30 }, // red above the neckline
    outfit: { base: "#e1262b", colors: ["#e1262b", "#8a111c"], below: 30 }, // the red hakama and ties
  };
  const OUTLINE = "#393331";
  // Each eye in frame 0: the area to cover with skin, and the closed-lid curve.
  const EYES = [
    { x0: 22, x1: 26, y0: 23, y1: 26, lid: [[22, 24], [23, 25], [24, 25], [25, 25], [26, 24]] },
    { x0: 32, x1: 35, y0: 23, y1: 26, lid: [[32, 24], [33, 25], [34, 25], [35, 24]] },
  ];

  const sheet = new Image();
  let raw = null; // ImageData per frame
  sheet.onload = () => {
    const c = document.createElement("canvas");
    c.width = sheet.width;
    c.height = sheet.height;
    const g = c.getContext("2d");
    g.drawImage(sheet, 0, 0);
    raw = Array.from({ length: FRAMES }, (_, i) => g.getImageData(i * FW, 0, FW, FW));
    cache.key = null;
    redrawAll();
  };
  sheet.src = window.KORITSU_SHEET || "/assets/character.png";

  // Extra animations (assets/senko/*.png + their JSON atlases): eating and hopping on the dock,
  // jumping into bed. Each frame is 64×64 like the walk sheet; durations come from the atlas.
  const ANIM_NAMES = ["eating", "to-bed", "hopping"];
  const anims = {}; // name → { raw: ImageData[], ms: number[], total, ground }
  function loadAnim(name, src, atlas) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const frames = Object.values(atlas.frames);
      const raw = frames.map(({ frame: f }) => g.getImageData(f.x, f.y, f.w, f.h));
      const ms = frames.map((f) => f.duration || TICK);
      // the lowest opaque row across all frames: where her feet rest
      let ground = 0;
      for (const r of raw) for (let y = r.height - 1; y > ground; y--) {
        let any = false;
        for (let x = 0; x < r.width && !any; x++) any = r.data[(y * r.width + x) * 4 + 3] > 0;
        if (any) ground = y;
      }
      anims[name] = { raw, ms, total: ms.reduce((a, b) => a + b, 0), ground };
      cache.key = null;
      redrawAll();
    };
    img.src = src;
  }
  for (const name of ANIM_NAMES) {
    const bundled = window.KORITSU_ANIMS?.[name];
    if (bundled) loadAnim(name, bundled.src, bundled.atlas);
    else fetch(`/assets/senko/${name}.json`).then((r) => r.json()).then((a) => loadAnim(name, `/assets/senko/${name}.png`, a)).catch(() => {});
  }

  // Index of the frame showing `ms` into an animation; past the end it loops, or holds the last
  // frame when `hold` is set.
  function frameAt(a, ms, hold = false) {
    if (hold && ms >= a.total) return a.ms.length - 1;
    let m = ms % a.total;
    for (let i = 0; i < a.ms.length; i++) {
      if (m < a.ms[i]) return i;
      m -= a.ms[i];
    }
    return 0;
  }

  // Recoloured frames (plus a closed-eyes copy of frame 0, a sitting pose and the extra
  // animations), rebuilt when the colours change.
  const cache = { key: null, frames: [], shut: null, sit: null, legs: [], hand: [12, 40], anims: {} };

  // Sitting pose, in frame-0 coordinates (the sprite faces left; "front" is low x).
  // The near arm reaches forward to grip the rod; the far arm comes across her chest and
  // holds the rod's end at her lap. Rows are [x, y, pixels].
  const ARM = [
    [20, 37, "owwwo"],
    [17, 38, "owwwwwwo"],
    [14, 39, "owwwwwwwvVo"],
    [12, 40, "ossowwwwwvVVo"],
    [11, 41, "osssowwwvVVVo"],
    [12, 42, "ossowwvVVVVo"],
    [13, 43, "oo.owvVVVo"],
    [16, 44, "owVVVo."],
    [17, 45, "ooooo"],
  ];
  const BACK_ARM = [
    [29, 37, "owwo"],
    [28, 38, "owwwo"],
    [27, 39, "owwwvo"],
    [26, 40, "owwwvo"],
    [26, 41, "owwvVo"],
    [25, 42, "owwvVo"],
    [25, 43, "owvVVo"],
    [24, 44, "owvVVo"],
    [24, 45, "owvVo"],
    [23, 46, "ossso"],
    [23, 47, "osssso"],
    [24, 48, "oooo"],
  ];
  const GRIP = { x: 11, y: 40, w: 5, h: 3 }; // near fist, redrawn over the rod
  const BACK_GRIP = { x: 23, y: 46, w: 6, h: 2 }; // far hand, redrawn over the rod
  const BUTT = [25, 47]; // the rod's end, in the far hand
  const HEM = 53; // last row of the hakama; the legs below it dangle separately
  const LEGS = [[23, 7], [31, 8]]; // [x, width] of each lower leg, rows HEM+1..61
  const SLEEVE = new Set(["#fdfcfa", "#c8b6c4", "#ac9eb4", "#5c5854", "#696461", "#393331", "#fce1c8", "#edb9af", "#cb8e76"]);

  function buildSit(src, rc) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = FW;
    const g = cv.getContext("2d");
    g.drawImage(src, 0, 0, FW, HEM + 1, 0, 0, FW, HEM + 1);
    const id = g.getImageData(0, 0, FW, FW), d = id.data;
    const colourAt = (x, y) => {
      const k = (y * FW + x) * 4;
      return d[k + 3] ? toHex([d[k], d[k + 1], d[k + 2]]) : null;
    };
    const set = (x, y, c) => {
      const k = (y * FW + x) * 4;
      if (c === null) d[k + 3] = 0;
      else [d[k], d[k + 1], d[k + 2], d[k + 3]] = [...hex(c), 255];
    };
    const sleeveish = (c) => c && [...SLEEVE].some((o) => rc(o) === c);
    // The hanging front sleeve goes; the new arm covers that area.
    for (let y = 38; y <= HEM; y++) for (let x = 12; x <= 23; x++) if (sleeveish(colourAt(x, y))) set(x, y, null);
    // The far sleeve no longer hangs there: fill the gap with her back (kimono above the
    // obi, hakama below), outlined where it meets the tail.
    const kimono = "#c8b6c4", hakama = rc("#8a111c"), edge = rc("#393331");
    for (let y = 37; y <= 49; y++) for (let x = 34; x <= 42; x++) {
      if (sleeveish(colourAt(x, y))) set(x, y, x >= 41 ? edge : y <= 40 ? kimono : hakama);
    }
    const pal = { o: rc("#393331"), w: "#fdfcfa", v: "#c8b6c4", V: "#ac9eb4", s: rc("#fce1c8") };
    for (const [x0, y, row] of [...BACK_ARM, ...ARM]) [...row].forEach((k, i) => k !== "." && set(x0 + i, y, pal[k]));
    g.putImageData(id, 0, 0);
    const legs = LEGS.map(([x, w]) => {
      const l = document.createElement("canvas");
      l.width = w;
      l.height = 61 - HEM;
      l.getContext("2d").drawImage(src, x, HEM + 1, w, 61 - HEM, 0, 0, w, 61 - HEM);
      return l;
    });
    return { cv, legs };
  }
  function frames(ch) {
    const key = JSON.stringify(ch);
    if (!raw || cache.key === key) return cache;
    const maps = Object.entries(GROUPS).map(([name, grp]) => {
      const target = ch[name];
      if (!target) return null;
      const [bh, bs, bl] = toHsl(hex(grp.base)), [th, ts, tl] = toHsl(hex(target));
      const lookup = new Map(grp.colors.map((c) => {
        const [, s0, l0] = toHsl(hex(c));
        return [c, fromHsl([th, clamp01(ts + (s0 - bs)), clamp01(tl + (l0 - bl))])];
      }));
      return { lookup, above: grp.above, below: grp.below };
    }).filter(Boolean);

    const build = (src, shut) => {
      const out = new ImageData(new Uint8ClampedArray(src.data), FW, FW);
      const d = out.data;
      for (let y = 0; y < FW; y++) for (let x = 0; x < FW; x++) {
        const k = (y * FW + x) * 4;
        if (!d[k + 3]) continue;
        const c = toHex([d[k], d[k + 1], d[k + 2]]);
        for (const m of maps) {
          if ((m.above !== undefined && y >= m.above) || (m.below !== undefined && y < m.below)) continue;
          const to = m.lookup.get(c);
          if (to) {
            [d[k], d[k + 1], d[k + 2]] = to;
            break;
          }
        }
      }
      if (shut) {
        // Closed eyes: skin over the whole eye (lashes, iris, highlights), then a "︶" lid line.
        const skin = hex(ch.skin || "#fce1c8"), lid = hex(OUTLINE);
        const put = (x, y, c) => {
          const k = (y * FW + x) * 4;
          [d[k], d[k + 1], d[k + 2]] = c;
        };
        for (const e of EYES) {
          for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) put(x, y, skin);
          for (const [x, y] of e.lid) put(x, y, lid);
        }
      }
      const cv = document.createElement("canvas");
      cv.width = cv.height = FW;
      cv.getContext("2d").putImageData(out, 0, 0);
      return cv;
    };

    cache.frames = raw.map((f) => build(f, false));
    cache.shut = build(raw[0], true);
    const rc = (c) => {
      for (const m of maps) if (m.below === undefined && m.lookup.has(c)) return toHex(m.lookup.get(c));
      return c;
    };
    const sit = buildSit(cache.frames[0], rc), sitShut = buildSit(cache.shut, rc);
    cache.sit = sit.cv;
    cache.sitShut = sitShut.cv;
    cache.legs = sit.legs;
    cache.anims = Object.fromEntries(Object.entries(anims).map(([n, a]) => [n, a.raw.map((r) => build(r, false))]));
    // The hand nearest the front (lowest skin pixels on the left half of frame 0) holds things.
    let best = null;
    const d0 = raw[0].data;
    for (let y = 30; y < FW; y++) for (let x = 0; x < 32; x++) {
      const k = (y * FW + x) * 4;
      if (d0[k + 3] && GROUPS.skin.colors.includes(toHex([d0[k], d0[k + 1], d0[k + 2]])) && (!best || x < best[0])) best = [x, y];
    }
    if (best) cache.hand = best;
    cache.key = key;
    return cache;
  }

  function paint(ctx, rows, x, y, pal) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const k = row[c];
        if (k === "." || !pal[k]) continue;
        ctx.fillStyle = pal[k];
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }

  // ---------- backgrounds ----------
  // Sky through the day: [hour, top, horizon, darkness 0–1]. Interpolated by the minute.
  const SKY = [
    [0, "#0d1230", "#222752", 1],
    [4.5, "#121838", "#2c2f5c", 1],
    [5.5, "#3b3f7a", "#b07a8a", 0.6],
    [6.5, "#6a74b8", "#f4b39a", 0.25],
    [8, "#79bdee", "#d6eeff", 0],
    [16.5, "#78bff0", "#e6e9d2", 0],
    [18, "#7a5aa0", "#f59a6b", 0.2],
    [19, "#3b3270", "#b0607a", 0.55],
    [20.5, "#161c40", "#30346a", 0.95],
    [24, "#0d1230", "#222752", 1],
  ];

  function sky(hour, rain) {
    let i = 0;
    while (hour > SKY[i + 1][0]) i++;
    const [h0, t0, b0, d0] = SKY[i], [h1, t1, b1, d1] = SKY[i + 1];
    const u = (hour - h0) / (h1 - h0);
    let top = mix(t0, t1, u), bottom = mix(b0, b1, u), dark = d0 + (d1 - d0) * u;
    if (rain) {
      // overcast: wash toward grey, a little darker
      top = mix(top, mix("#5f6878", "#1c2030", dark), 0.6 * rain);
      bottom = mix(bottom, mix("#8a93a3", "#2a2f40", dark), 0.6 * rain);
      dark = Math.min(1, dark + 0.12 * rain);
    }
    return { top, bottom, dark, hour, rain };
  }

  // Is it raining? "auto" makes roughly one hour in five rainy, the same for everyone at that hour.
  function rainAt(mode, now) {
    if (mode === "rain") return 1;
    if (mode === "clear") return 0;
    const start = new Date(now.getFullYear(), 0, 0);
    const n = Math.floor((now - start) / 3600000);
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x) < 0.2 ? 1 : 0;
  }

  // ---------- drawing helpers (full resolution, 320×160, same pixel size as the sprite) ----------
  const SW = W * S, SH = H * S;
  function rect(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }
  function px(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  }
  // A pixel-perfect filled circle (or ellipse with `ry`).
  function disc(ctx, cx, cy, r, c, ry = r) {
    ctx.fillStyle = c;
    for (let dy = -ry; dy <= ry; dy++) {
      const dx = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
      ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
    }
  }
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  // Smooth 1-D value noise in 0..1.
  const noise = (x) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
  // Banded vertical gradient with a checkerboard row between bands: the pixel-art way.
  function bands(ctx, top, bottom, y0, y1, n, x0 = 0, x1 = SW) {
    const h = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const ya = Math.round(y0 + i * h), yb = Math.round(y0 + (i + 1) * h);
      rect(ctx, x0, ya, x1 - x0, yb - ya, mix(top, bottom, n === 1 ? 0 : i / (n - 1)));
      if (i < n - 1) {
        ctx.fillStyle = mix(top, bottom, (i + 1) / (n - 1));
        for (let x = x0 + (yb % 2); x < x1; x += 2) ctx.fillRect(x, yb - 1, 1, 1);
      }
    }
  }

  // ---------- sky: stars, sun, moon, clouds ----------
  const STARS = Array.from({ length: 46 }, (_, i) => [Math.floor(hash(i) * SW), Math.floor(hash(i + 99) * 70), hash(i + 7) > 0.8]);
  function stars(ctx, t, x0, x1, y0, y1, alpha = 1) {
    if (alpha <= 0.02) return;
    ctx.globalAlpha = alpha;
    for (const [i, [x, y, big]] of STARS.entries()) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const twinkle = (i * 7 + t) % 29 < 2;
      px(ctx, x, y, twinkle ? "#7a7fb0" : "#f2f0ff");
      if (big && !twinkle) {
        ctx.globalAlpha = alpha * 0.45;
        rect(ctx, x - 1, y, 3, 1, "#d8d8ff");
        rect(ctx, x, y - 1, 1, 3, "#d8d8ff");
        ctx.globalAlpha = alpha;
      }
    }
    ctx.globalAlpha = 1;
  }

  function sun(ctx, x, y) {
    for (const [r, a] of [[14, 0.08], [10, 0.14]]) {
      ctx.globalAlpha = a;
      disc(ctx, x, y, r, "#fff1b8");
    }
    ctx.globalAlpha = 1;
    disc(ctx, x, y, 6, "#ffd257");
    disc(ctx, x, y, 5, "#ffe27a");
    disc(ctx, x - 1, y - 1, 3, "#fff3b8");
  }

  function moon(ctx, x, y) {
    ctx.globalAlpha = 0.12;
    disc(ctx, x, y, 11, "#e8e4ff");
    ctx.globalAlpha = 1;
    disc(ctx, x, y, 6, "#d9d4b8");
    disc(ctx, x, y, 5, "#fff8dc");
    for (const [dx, dy, c] of [[-2, -1, "#e6dfba"], [1, 2, "#e6dfba"], [2, -2, "#ece6c6"], [-1, 2, "#ece6c6"]]) px(ctx, x + dx, y + dy, c);
  }

  // Sun by day, moon by night, each on an arc over the given box. Hidden by rain clouds.
  function celestial(ctx, s, x0, x1, y0, y1) {
    if (s.rain) return;
    const arc = (u) => [Math.round(x0 + 10 + u * (x1 - x0 - 20)), Math.round(y1 - 6 - Math.sin(u * Math.PI) * (y1 - y0 - 16))];
    const h = s.hour;
    if (h >= 5.5 && h <= 19) sun(ctx, ...arc((h - 5.5) / 13.5));
    if (h >= 18.5 || h <= 6.5) moon(ctx, ...arc(((h - 18.5 + 24) % 24) / 12));
  }

  // A fluffy cloud: overlapping puffs, a lit top and a shaded underside.
  function cloud(ctx, x, y, w, light, shade) {
    const puffs = [[0.18, 0.55, 0.22], [0.42, 0.3, 0.3], [0.68, 0.45, 0.24], [0.86, 0.65, 0.16]];
    for (const [u, v, r] of puffs) disc(ctx, x + u * w, y + v * w * 0.32, Math.max(3, r * w * 0.45), shade);
    for (const [u, v, r] of puffs) disc(ctx, x + u * w, y + v * w * 0.32 - 1, Math.max(2, r * w * 0.45 - 1), light);
    rect(ctx, Math.round(x + w * 0.1), Math.round(y + w * 0.3), Math.round(w * 0.8), 2, shade);
  }

  function clouds(ctx, tf, s) {
    const drift = tf / 6;
    const list = s.rain
      ? [[0, 6, 90], [70, 0, 110], [160, 8, 100], [240, 2, 110], [-40, 18, 80], [120, 22, 90], [210, 26, 80]]
      : [[20, 16, 46], [130, 6, 34], [210, 26, 56], [300, 12, 40]];
    const light = s.rain ? mix("#a3acbb", "#2a3040", s.dark) : mix("#ffffff", "#454c7a", s.dark);
    const shade = s.rain ? mix("#7d8696", "#1c2030", s.dark) : mix("#d4e4f4", "#2c3262", s.dark);
    ctx.globalAlpha = s.rain ? 1 : 1 - 0.55 * s.dark;
    for (const [cx, cy, w] of list) {
      const x = ((cx + drift) % (SW + 140) + SW + 140) % (SW + 140) - 120;
      cloud(ctx, Math.round(x), cy, w, light, shade);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the lake ----------
  const HORIZON = 104; // where the water starts
  const BANK = 88; // right edge of the grassy bank
  const POSTS = [96, 140, 186]; // dock posts (left x, 6 wide)

  // Static parts of the lake, drawn once per sky colour: [sky, land].
  function lakeLayers(s) {
    const sky = layer(), land = layer();
    const g = sky.getContext("2d");
    bands(g, s.top, s.bottom, 0, HORIZON, 12);

    const l = land.getContext("2d");
    // far mountains, hazy with distance
    const far = mix("#6c7fb0", s.bottom, 0.45), farLit = mix(far, "#ffffff", 0.18);
    for (let x = 0; x < SW; x++) {
      const y = Math.round(66 - 16 * noise(x / 46) - 7 * noise(x / 15 + 4));
      rect(l, x, y, 1, HORIZON - y, far);
      px(l, x, y, farLit);
      if (y < 56) rect(l, x, y, 1, Math.min(3, 56 - y), mix("#eef2ff", far, 0.25)); // snow on the peaks
    }
    // rolling green hills with a tree line
    for (let x = 0; x < SW; x++) {
      const y = Math.round(88 - 7 * noise(x / 30 + 9) - 3 * noise(x / 9));
      rect(l, x, y, 1, HORIZON - y, "#5a9e5c");
      rect(l, x, y + 6, 1, HORIZON - y - 6, "#4c8b52");
      rect(l, x, HORIZON - 3, 1, 3, "#3f7a49");
      px(l, x, y, "#74b86e");
    }
    for (let x = 4; x < SW; x += 6 + Math.floor(hash(x) * 5)) {
      const base = Math.round(88 - 7 * noise(x / 30 + 9) - 3 * noise(x / 9)) + 2;
      if (hash(x + 3) > 0.55) {
        // pine
        for (let r = 0; r < 8; r++) rect(l, x - Math.floor(r / 2), base - 8 + r, Math.floor(r / 2) * 2 + 1, 1, r % 3 === 0 ? "#3c7a46" : "#2f6a3c");
        px(l, x, base + 1, "#4a3424");
      } else {
        disc(l, x, base - 3, 3, "#2f6a3c");
        disc(l, x - 1, base - 4, 2, "#3f8048");
      }
    }
    // water: hill reflections near the shore, deepening toward us
    const top = s.rain ? "#6f97b8" : mix("#5fb4e6", s.bottom, 0.3), deep = s.rain ? "#2f5c80" : "#1d5e9c";
    bands(l, top, deep, HORIZON, SH, 9);
    for (let x = 0; x < SW; x += 1) {
      const h = 2 + Math.round(5 * noise(x / 30 + 9));
      l.globalAlpha = 0.35;
      rect(l, x, HORIZON, 1, h, "#3f7a49");
      l.globalAlpha = 1;
    }
    // lily pads and a lotus
    for (const [x, y, r] of [[236, 140, 6], [262, 151, 5], [212, 128, 4], [300, 134, 5]]) {
      disc(l, x, y + 1, r + 1, "#1f5a3a", Math.ceil(r / 2));
      disc(l, x, y, r, "#4fa25a", Math.ceil(r / 2));
      disc(l, x - 1, y - 1, Math.max(1, r - 3), "#6cc06a", 1);
      rect(l, x, y - Math.ceil(r / 2), 1, Math.ceil(r / 2) + 1, "#1f5a3a"); // the notch
    }
    for (const [dx, dy, c] of [[0, -3, "#ffd6e2"], [-1, -2, "#f7a8c0"], [1, -2, "#f7a8c0"], [-2, -1, "#f392b2"], [2, -1, "#f392b2"], [0, -2, "#fff0f4"], [0, -1, "#ffe27a"]]) px(l, 236 + dx, 140 + dy, c);

    // the bank: grass over a dirt cliff with stones and roots
    const edge = (y) => BANK - Math.round(3 * noise(y / 7 + 2));
    for (let y = 100; y < SH; y++) {
      const e = edge(y);
      rect(l, 0, y, e, 1, y % 9 < 1 ? "#7a4e33" : "#8a5a3c");
      rect(l, e - 2, y, 2, 1, "#6a432c");
      px(l, e, y, "#4d3020");
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i + 11) * 80), y = 104 + Math.floor(hash(i + 31) * 54);
      if (x > edge(y) - 4) continue;
      rect(l, x, y, 2 + (i % 3), 1, i % 2 ? "#a06b48" : "#74482f"); // soil grain
    }
    for (const [x, y, r] of [[14, 126, 5], [40, 146, 6], [66, 118, 4], [24, 152, 3], [58, 138, 3]]) {
      disc(l, x, y, r, "#6e6e78");
      disc(l, x - 1, y - 1, r - 1, "#8f8f9a");
      px(l, x - r + 2, y - r + 2, "#b4b4c0");
    }
    for (const [x0, y0, len] of [[30, 102, 12], [52, 104, 9], [12, 103, 7]]) {
      for (let k = 0; k < len; k++) px(l, x0 + Math.round(Math.sin(k / 2) * 1.5), y0 + k, "#4a2f1f"); // roots
    }
    // grass with a ragged overhang, tufts and flowers
    rect(l, 0, 94, BANK + 2, 6, "#5cc45a");
    rect(l, 0, 94, BANK + 2, 2, "#7fdc6e");
    for (let x = 0; x < BANK + 2; x++) {
      const hang = Math.floor(hash(x * 3.1) * 4);
      rect(l, x, 100, 1, hang, "#4caa48");
      if (hash(x + 0.5) > 0.6) px(l, x, 92 + Math.floor(hash(x + 9) * 2), "#8fe27e");
    }
    for (let i = 0; i < 12; i++) {
      const x = 6 + Math.floor(hash(i + 50) * (BANK - 10));
      px(l, x, 93, ["#ffffff", "#ffd6e2", "#ffe27a", "#c8b6ff"][i % 4]);
      px(l, x, 94, "#3f9a40");
    }
    // reeds at the waterline
    for (let i = 0; i < 9; i++) {
      const x = BANK + 1 + i * 2 + (i % 2), tall = 10 + Math.floor(hash(i + 70) * 9);
      rect(l, x, HORIZON + 4 - tall, 1, tall, i % 2 ? "#4f8a3c" : "#6aa84c");
      if (i % 3 === 0) rect(l, x, HORIZON + 4 - tall - 4, 1, 4, "#7a4a2a");
    }

    // a cherry-blossom tree on the bank
    for (let y = 30; y < 96; y++) rect(l, 18 + Math.round(Math.sin(y / 9) * 1.5), y, 7, 1, "#5a3a2c");
    for (let y = 30; y < 96; y++) px(l, 18 + Math.round(Math.sin(y / 9) * 1.5), y, "#7a5240");
    for (const [x0, y0, x1, y1] of [[22, 52, 44, 34], [20, 46, 4, 30], [24, 60, 50, 50]]) line(l, x0, y0, x1, y1, "#5a3a2c");
    const blossom = [[24, 26, 18], [6, 34, 13], [44, 32, 14], [30, 44, 12], [52, 46, 9], [12, 18, 10], [36, 14, 11]];
    for (const [x, y, r] of blossom) disc(l, x, y + 1, r, "#d97a98");
    for (const [x, y, r] of blossom) disc(l, x, y, r - 1, "#f3a0b8");
    for (const [x, y, r] of blossom) disc(l, x - 2, y - 2, Math.max(2, r - 5), "#f8bfd0");
    for (let i = 0; i < 40; i++) {
      const [bx, by, br] = blossom[i % blossom.length];
      const a = hash(i) * Math.PI * 2, d = hash(i + 5) * (br - 2);
      px(l, Math.round(bx + Math.cos(a) * d), Math.round(by + Math.sin(a) * d), hash(i + 9) > 0.5 ? "#ffe3ec" : "#e48aa6");
    }
    for (let i = 0; i < 10; i++) px(l, Math.floor(hash(i + 300) * 60), 95 + Math.floor(hash(i + 301) * 4), "#f7b6c8"); // fallen petals

    // the dock: braced posts, a front beam with grain and nails, a lit plank edge
    for (const x of POSTS) {
      rect(l, x, 108, 6, 44, "#6e4426");
      rect(l, x, 108, 2, 44, "#8c5a32");
      rect(l, x + 5, 108, 1, 44, "#4e2f1a");
      rect(l, x, 118, 6, 3, "#4f7a3a"); // algae at the waterline
      l.globalAlpha = 0.45;
      rect(l, x, 121, 6, 31, deep); // under water
      l.globalAlpha = 1;
    }
    line(l, POSTS[0] + 5, 110, POSTS[1], 117, "#5e3a20");
    line(l, POSTS[1] + 5, 117, POSTS[2], 110, "#5e3a20");
    rect(l, 80, 100, 117, 2, "#e8b47a"); // plank tops catching the light
    rect(l, 80, 102, 117, 6, "#b07a48");
    rect(l, 80, 107, 117, 1, "#7a4e2c");
    for (let x = 80; x < 197; x += 13) {
      rect(l, x, 100, 1, 8, "#7a4e2c"); // plank seams
      px(l, x + 3, 104, "#5a3a22"); // nails
      px(l, x + 9, 104, "#5a3a22");
    }
    for (let i = 0; i < 26; i++) rect(l, 82 + Math.floor(hash(i + 400) * 110), 103 + Math.floor(hash(i + 401) * 4), 3 + (i % 4), 1, "#9c6a3e"); // grain
    rect(l, 196, 100, 1, 8, "#5a3a22");
    return [sky, land];
  }

  // Moving parts of the lake, drawn every frame.
  function lakeLife(ctx, t, tf, s) {
    // shimmer on the water, not over the bank or the posts
    const glint = s.rain ? "#a9c6dd" : mix("#d6f0ff", "#5a78b0", s.dark);
    for (let i = 0; i < 28; i++) {
      const y = HORIZON + 4 + Math.floor(hash(i + 600) * 54);
      const len = 3 + (i % 5);
      const x = ((Math.floor(hash(i + 601) * SW) + Math.floor(tf * (i % 2 ? 0.6 : -0.45))) % SW + SW) % SW;
      if (x < BANK + 4 || POSTS.some((p) => x + len > p - 2 && x < p + 8)) continue;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(tf / 3 + i);
      rect(ctx, x, y, len, 1, glint);
    }
    ctx.globalAlpha = 1;
    // ripples around the posts
    for (const [k, x] of POSTS.entries()) {
      const r = 4 + ((Math.floor(tf / 2) + k * 3) % 6);
      ctx.globalAlpha = 0.5 - r / 20;
      rect(ctx, x - r + 3, 121, 1, 1, "#d6f0ff");
      rect(ctx, x + r + 2, 121, 1, 1, "#d6f0ff");
    }
    ctx.globalAlpha = 1;
    // petals drifting off the tree
    if (!s.rain) {
      for (let i = 0; i < 7; i++) {
        const p = (tf * 0.9 + i * 37) % 180;
        const x = 20 + i * 9 + p * 0.9 + Math.sin(p / 7 + i) * 4, y = 30 + p * 0.45;
        if (y > 100 || x > SW) continue;
        px(ctx, Math.round(x), Math.round(y), i % 2 ? "#ffd6e2" : "#f392b2");
      }
    }
  }

  // Fireflies by the reeds on clear nights; drawn after night falls so they glow.
  function fireflies(ctx, tf, s) {
    if (s.rain || s.dark < 0.5) return;
    for (let i = 0; i < 7; i++) {
      const on = Math.sin(tf / 4 + i * 2.3) > 0.2;
      if (!on) continue;
      const x = 70 + Math.round(30 * noise(tf / 40 + i * 3)) + i * 4, y = 74 + Math.round(22 * noise(tf / 30 + i * 7));
      ctx.globalAlpha = 0.35;
      disc(ctx, x, y, 2, "#e8ff8a");
      ctx.globalAlpha = 1;
      px(ctx, x, y, "#fbffcf");
    }
  }

  // ---------- the bedroom ----------
  function bedroomLayer(s) {
    const room = layer(), g = room.getContext("2d");
    const day = 1 - s.dark;
    const wall = mix("#2e2744", "#6e6084", day * 0.8), stripe = mix(wall, "#ffffff", 0.05);
    rect(g, 0, 0, SW, 98, wall);
    for (let x = 6; x < SW; x += 16) rect(g, x, 0, 4, 98, stripe);
    for (let y = 8; y < 96; y += 12) for (let x = 2 + ((y / 12) % 2) * 8; x < SW; x += 16) px(g, x, y, mix(wall, "#ffffff", 0.1));
    // wood panelling and the floor
    rect(g, 0, 96, SW, 3, mix("#7a5440", "#2e2030", s.dark * 0.6));
    rect(g, 0, 99, SW, 21, mix("#5e3f2e", "#2a1c18", s.dark * 0.6));
    for (let x = 0; x < SW; x += 24) {
      rect(g, x + 3, 102, 18, 15, mix("#664533", "#2e1f1a", s.dark * 0.6));
      rect(g, x + 3, 102, 18, 1, mix("#7a5440", "#3a2820", s.dark * 0.6));
    }
    rect(g, 0, 120, SW, 40, mix("#6e4a34", "#2a1d17", s.dark * 0.55));
    for (let y = 120; y < SH; y += 6) {
      rect(g, 0, y, SW, 1, mix("#5a3a28", "#201612", s.dark * 0.55));
      for (let x = (y / 6) % 2 ? 0 : 20; x < SW; x += 40) rect(g, x, y, 1, 6, mix("#5a3a28", "#201612", s.dark * 0.55));
    }
    // rug
    rect(g, 70, 142, 236, 18, "#8a3d4f");
    rect(g, 74, 145, 228, 12, "#b65a6e");
    for (let x = 78; x < 300; x += 10) {
      rect(g, x, 149, 5, 4, "#f2d9b8");
      px(g, x + 2, 150, "#8a3d4f");
    }
    // window with curtains
    rect(g, 22, 12, 74, 64, "#3a2c22");
    bands(g, s.top, s.bottom, 15, 73, 6, 25, 93);
    stars(g, 0, 25, 93, 15, 72, s.dark * (1 - s.rain));
    g.save();
    g.beginPath();
    g.rect(25, 15, 68, 58);
    g.clip();
    celestial(g, s, 25, 93, 15, 73);
    g.restore();
    rect(g, 57, 15, 4, 58, "#3a2c22");
    rect(g, 25, 42, 68, 3, "#3a2c22");
    rect(g, 18, 74, 82, 4, "#8a6a52");
    rect(g, 18, 74, 82, 1, "#a6866c");
    rect(g, 12, 8, 94, 3, "#2a201a"); // curtain rod
    disc(g, 12, 9, 2, "#c9a24a");
    disc(g, 106, 9, 2, "#c9a24a");
    for (const [x0, w] of [[10, 16], [92, 16]]) {
      rect(g, x0, 10, w, 72, "#a4475c");
      for (let x = x0 + 2; x < x0 + w; x += 4) rect(g, x, 10, 1, 72, "#7e3245");
      rect(g, x0, 10, w, 2, "#c86a80");
      rect(g, x0, 80, w, 2, "#7e3245");
    }
    // potted cactus on the sill
    rect(g, 66, 66, 8, 8, "#c96b4a");
    rect(g, 66, 66, 8, 1, "#e08a66");
    rect(g, 68, 56, 4, 10, "#4f9a50");
    rect(g, 65, 59, 2, 5, "#4f9a50");
    rect(g, 73, 58, 2, 4, "#4f9a50");
    px(g, 69, 57, "#7fd07a");
    // framed picture
    rect(g, 156, 18, 44, 30, "#6e4a34");
    bands(g, "#9fd2ff", "#ffe0b0", 21, 45, 3, 159, 197);
    for (let x = 159; x < 197; x++) rect(g, x, 45 - Math.round(8 * noise(x / 6)), 1, Math.round(8 * noise(x / 6)), "#4f8a5a");
    disc(g, 188, 27, 2, "#ffd257");
    // shelf with books, a plant and a jar
    rect(g, 226, 40, 74, 4, "#6e4630");
    rect(g, 226, 44, 74, 1, "#4a2f20");
    let bx = 230;
    for (const [w, h, c] of [[5, 16, "#5b8cff"], [4, 13, "#e8833a"], [6, 18, "#e8c84a"], [4, 14, "#8a5ab0"], [5, 17, "#4fa25a"], [3, 12, "#e1262b"]]) {
      rect(g, bx, 40 - h, w, h, c);
      rect(g, bx, 40 - h, 1, h, mix(c, "#ffffff", 0.3));
      rect(g, bx, 40 - h + 3, w, 1, mix(c, "#000000", 0.3));
      bx += w + 1;
    }
    rect(g, 270, 30, 8, 10, "#c96b4a");
    for (const [x, y, r] of [[274, 26, 5], [270, 23, 3], [278, 22, 3]]) disc(g, x, y, r, "#4f9a50");
    for (let y = 40; y < 62; y += 3) px(g, 279 + ((y / 3) % 2), y, "#4f9a50"); // trailing leaves
    rect(g, 284, 32, 7, 8, "#b8d8f0");
    rect(g, 284, 30, 7, 2, "#8a6a52");
    // nightstand with a lamp
    rect(g, 52, 96, 40, 24, "#7a5238");
    rect(g, 52, 96, 40, 2, "#9a6a48");
    rect(g, 56, 102, 32, 7, "#664330");
    rect(g, 70, 105, 4, 1, "#c9a24a");
    rect(g, 66, 90, 12, 6, "#8a6a52");
    rect(g, 70, 80, 4, 10, "#5a4030");
    const lampOn = s.dark > 0.3;
    for (let r = 0; r < 9; r++) rect(g, 63 - Math.floor(r / 2), 70 + r, 18 + Math.floor(r / 2) * 2, 1, lampOn ? "#ffd889" : "#d8c49a");
    // bed frame, mattress and pillow (behind her)
    rect(g, 96, 58, 12, 64, "#6e4630");
    rect(g, 96, 58, 12, 3, "#9a6a48");
    disc(g, 102, 58, 6, "#6e4630", 3);
    rect(g, 98, 66, 8, 50, "#7e5238");
    rect(g, 292, 90, 8, 32, "#6e4630");
    rect(g, 292, 90, 8, 2, "#9a6a48");
    rect(g, 108, 106, 184, 8, "#ece6f4");
    rect(g, 108, 112, 184, 2, "#cfc6e0");
    rect(g, 108, 114, 184, 8, "#7e5238");
    rect(g, 108, 114, 184, 1, "#9a6a48");
    rect(g, 110, 122, 4, 6, "#5a3a28");
    rect(g, 286, 122, 4, 6, "#5a3a28");
    disc(g, 134, 98, 24, "#ffffff", 9);
    disc(g, 134, 101, 24, "#dcd4ea", 6);
    disc(g, 134, 97, 22, "#ffffff", 7);
    rect(g, 116, 96, 36, 1, "#ece6f4");
    return room;
  }

  // The lamp's warm pool of light, after night falls so it glows.
  function lampGlow(ctx, s) {
    if (s.dark <= 0.3) return;
    for (const [r, a] of [[46, 0.06], [30, 0.08], [16, 0.1]]) {
      ctx.globalAlpha = a * s.dark;
      disc(ctx, 72, 78, r, "#ffcf7a", Math.round(r * 0.7));
    }
    ctx.globalAlpha = 1;
  }

  // Quilted blanket. `flat`: smoothed over the bed (she naps on top); otherwise pulled up to
  // her chin with a hump where her body is.
  function blanket(ctx, outfit, breath, flat = false) {
    const top = flat ? 104 : 94 - breath, x0 = flat ? 160 : 106, x1 = 292;
    const base = mix(outfit, "#6b7fd6", 0.55), dark = mix(base, "#1a1030", 0.3), lit = mix(base, "#ffffff", 0.3);
    rect(ctx, x0, top, x1 - x0, 122 - top, base);
    if (!flat) {
      disc(ctx, 214, top + 2, 46, base, 7); // hip and knees
      disc(ctx, 214, top - 1, 42, lit, 1);
    }
    for (let x = x0 + 8; x < x1; x += 14) rect(ctx, x, top + 4, 1, 122 - top - 4, dark); // quilting
    for (let y = top + 10; y < 122; y += 9) rect(ctx, x0, y, x1 - x0, 1, dark);
    for (let x = x0 + 15; x < x1; x += 14) for (let y = top + 15; y < 122; y += 9) px(ctx, x, y, lit);
    rect(ctx, x0, top, x1 - x0, 4, "#f4f0fa"); // the sheet folded over
    rect(ctx, x0, top + 4, x1 - x0, 1, "#cfc6e0");
    rect(ctx, x0, 122, x1 - x0, 1, dark);
  }

  // Off-screen layer the size of the scene.
  function layer() {
    const c = document.createElement("canvas");
    c.width = SW;
    c.height = SH;
    return c;
  }

  // ---------- scenes (full-resolution coordinates: 320×160) ----------
  function line(ctx, x0, y0, x1, y1, color) {
    ctx.fillStyle = color;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
  }

  const DOCK_TOP = 51 * S;

  // Idle: a little routine on the dock. [what, ticks, from x, to x, face right]
  const IDLE = [
    ["eating", 64, 104, 104, false],
    ["walk", 60, 104, 176, true],
    ["hopping", 24, 176, 176, true],
    ["stand", 24, 176, 176, true],
    ["walk", 60, 176, 104, false],
    ["stand", 24, 104, 104, false],
  ];
  const IDLE_TICKS = IDLE.reduce((n, seg) => n + seg[1], 0);

  function strolling(ctx, t, tf, f) {
    let p = tf % IDLE_TICKS, seg = IDLE[0];
    for (seg of IDLE) {
      if (p < seg[1]) break;
      p -= seg[1];
    }
    const [what, len, from, to, right] = seg;
    const x = from + ((to - from) * p) / len; // glides at the redraw rate, not 8 fps
    if (what !== "walk" && what !== "stand" && f.anims[what]) {
      return drawAnim(ctx, f, what, frameAt(anims[what], p * TICK), x, DOCK_TOP, right);
    }
    const img = what === "walk" ? f.frames[t % FRAMES] : t % 48 === 47 ? f.shut : f.frames[0];
    drawFacing(ctx, img, x, DOCK_TOP, right);
  }

  // One frame of an extra animation, feet at (cx, feetY).
  function drawAnim(ctx, f, name, i, cx, feetY, faceRight) {
    const img = f.anims[name]?.[i];
    if (!img) return;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(feetY - anims[name].ground));
    if (faceRight) ctx.scale(-1, 1);
    ctx.drawImage(img, -FW / 2, 0);
    ctx.restore();
  }

  function drawFacing(ctx, img, cx, feetY, faceRight) {
    if (!img) return;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(feetY - 61));
    if (faceRight) ctx.scale(-1, 1);
    ctx.drawImage(img, -FW / 2, 0);
    ctx.restore();
  }

  // Productive: sitting on the end of the dock facing the water, legs swinging over the edge,
  // both hands on the rod (or a book). Coordinates convert from frame 0 with sx = cx + 32 - x.
  function sitting(ctx, t, f, hold) {
    if (!f.sit) return;
    const cx = 172, top = DOCK_TOP + 3 - HEM;
    const sx = (x) => cx + FW / 2 - x, sy = (y) => top + y;
    // legs first so the hakama hem overlaps them; each swings opposite the other
    const SWING = [0, 1, 2, 1, 0, -1, -2, -1];
    LEGS.forEach(([x, w], i) => {
      const leg = f.legs[i];
      if (!leg) return;
      const sw = SWING[(Math.floor(t / 2) + i * 4) % 8];
      ctx.save();
      ctx.translate(sx(x) + 1, sy(HEM + 1));
      ctx.scale(-1, 1);
      ctx.drawImage(leg, 0, 0, w, 4, Math.round(sw / 2), 0, w, 4); // shin
      ctx.drawImage(leg, 0, 4, w, leg.height - 4, sw, 4, w, leg.height - 4); // foot swings further
      ctx.restore();
    });
    const blink = t % 48 === 47;
    ctx.save();
    ctx.translate(cx, top);
    ctx.scale(-1, 1);
    ctx.drawImage(blink ? f.sitShut : f.sit, -FW / 2, 0);
    ctx.restore();

    const hx = sx(GRIP.x + 2), hy = sy(GRIP.y + 1);
    if (hold === "rod") {
      // A straight rod: from the far hand at her lap, through the near fist, out over the water.
      const bx = sx(BUTT[0]), by = sy(BUTT[1]), fx = sx(GRIP.x + 2), fy0 = sy(GRIP.y + 1);
      const len = Math.hypot(fx - bx, fy0 - by), reach = 150;
      const tipX = Math.round(bx + ((fx - bx) / len) * reach), tipY = Math.round(by + ((fy0 - by) / len) * reach) + (Math.floor(t / 10) % 2);
      line(ctx, bx, by, tipX, tipY, "#6b3f22");
      line(ctx, bx, by + 1, tipX, tipY + 1, "#8a5a32");
      // both hands over the rod
      const img = blink ? f.sitShut : f.sit;
      ctx.save();
      ctx.translate(cx, top);
      ctx.scale(-1, 1);
      for (const gr of [GRIP, BACK_GRIP]) ctx.drawImage(img, gr.x, gr.y, gr.w, gr.h, -FW / 2 + gr.x, gr.y, gr.w, gr.h);
      ctx.restore();
      const bob = Math.floor(t / 3) % 2, fy = 126 + bob * 2;
      ctx.fillStyle = "#f4f4f4";
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        ctx.fillRect(Math.round(tipX + (306 - tipX) * u), Math.round(tipY + (fy - tipY) * u * u), 1, 1);
      }
      paint(ctx, [".rr.", "rrrr", "wwww", ".ww."], 304, fy, { r: "#e8433a", w: "#ffffff" });
      if (bob) {
        ctx.fillStyle = "#bfe6ff";
        ctx.fillRect(298, fy + 5, 4, 1);
        ctx.fillRect(310, fy + 5, 4, 1);
      }
      // now and then a fish jumps
      const jump = t % 96;
      if (jump < 12) {
        const fx = 232 + jump * 4, fyy = 130 - Math.round(18 * Math.sin((jump / 12) * Math.PI));
        paint(ctx, ["..ffff..", ".ffffff.", "ffffffff", ".ffffff.", "..f..f.."], fx, fyy, { f: "#f2a65a" });
      }
    } else {
      const flip = Math.floor(t / 16) % 2;
      const book = ["RRRRRRRRRRRR", "RwwwwRRwwwwR", flip ? "RwXwwRRwwXwR" : "RwwXwRRwXwwR", "RwwwwRRwwwwR", "RwXwwRRwwXwR", "RRRRRRRRRRRR"];
      paint(ctx, book, hx - 5, hy - 8, { R: "#8a3b5a", w: "#ffffff", X: "#c9c2dc" });
    }
  }

  // Break: she jumps onto the bed and curls up on top of the covers, then breathes slowly.
  // Returns where her head ends up, for the Zz.
  const BED_TOP = 55 * S;
  function napping(ctx, t, f, since) {
    const a = anims["to-bed"];
    if (!a || !f.anims["to-bed"]) return null;
    const i = frameAt(a, since, true);
    const settled = since >= a.total;
    const breathe = settled && Math.floor(t / 8) % 2 ? 1 : 0;
    drawAnim(ctx, f, "to-bed", i, 186, BED_TOP + breathe, false);
    return settled ? [160, BED_TOP - 44] : null;
  }

  // In bed: head and ears upright on the pillow, peeking over the blanket, turned toward the
  // phone. (Turning the whole sprite on its side made the head unreadable at this size.)
  function lying(ctx, t, f, mode) {
    const img = mode === "sleep" ? f.shut : f.frames[0];
    if (!img) return;
    ctx.save();
    ctx.translate(100 + 48, 62);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 8, 0, 48, 34, 0, 0, 48, 34);
    ctx.restore();
  }

  // ---------- engine ----------
  const canvases = new Map();
  let state = { mood: "idle", productive: "fishing", weather: "auto", sky: "auto", character: {} };
  // The Sky setting pins the scene to one time of day; "auto" follows the clock.
  const FIXED_HOUR = { day: 12, sunset: 18.25, night: 23 };
  let t = 0, tf = 0; // whole ticks (sprite frames), fractional ticks (smooth motion)
  let clock = 0, moodAt = 0; // ms the scene has been running; when the mood last changed
  const glow = layer(); // stars, sun and moon, cut out wherever the land is
  // The static background, redrawn only when the sky's colour (or the room) changes.
  const bg = { key: "", layers: [] };
  function background(indoors, s) {
    const key = `${indoors}|${s.top}|${s.bottom}|${s.rain}|${s.dark.toFixed(2)}|${Math.floor(s.hour * 4)}`;
    if (bg.key !== key) {
      bg.layers = indoors ? [bedroomLayer(s)] : lakeLayers(s);
      bg.key = key;
    }
    return bg.layers;
  }

  function draw(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SW, SH);
    const f = frames(state.character);
    const now = new Date();
    const rain = rainAt(state.weather, now);
    const s = sky(FIXED_HOUR[state.sky] ?? now.getHours() + now.getMinutes() / 60, rain);
    const indoors = state.mood === "wasted" || state.mood === "break";
    const since = clock - moodAt;
    const napAnim = state.mood === "break" && !!f.anims["to-bed"];
    const outfit = state.character.outfit || "#e1262b";
    const breath = state.mood === "break" ? Math.floor(t / 8) % 2 : 0;

    if (indoors) {
      ctx.drawImage(background(true, s)[0], 0, 0);
      if (napAnim) blanket(ctx, outfit, 0, true); // she naps on top of the covers
    } else {
      const [skyLayer, land] = background(false, s);
      ctx.drawImage(skyLayer, 0, 0);
      clouds(ctx, tf, s);
      ctx.drawImage(land, 0, 0);
      lakeLife(ctx, t, tf, s);
    }

    let zz = null;
    if (state.mood === "productive") {
      // a happy hop at the end of the dock, then she sits down to fish or read
      const hop = anims.hopping;
      if (hop && f.anims.hopping && since < hop.total) drawAnim(ctx, f, "hopping", frameAt(hop, since), 172, DOCK_TOP, true);
      else sitting(ctx, t, f, state.productive === "reading" ? "book" : "rod");
    } else if (napAnim) zz = napping(ctx, t, f, since);
    else if (indoors) lying(ctx, t, f, state.mood === "break" ? "sleep" : "phone");
    else strolling(ctx, t, tf, f);

    if (indoors) {
      if (!napAnim) blanket(ctx, outfit, breath, false);
      lampGlow(ctx, s);
      if (rain) windowRain(ctx, tf);
    } else {
      // Night dims the whole picture evenly; stars, sun, moon and fireflies go on top to shine.
      if (s.dark > 0.01) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = mix("#ffffff", "#2c3570", s.dark * 0.6);
        ctx.fillRect(0, 0, SW, SH);
        ctx.globalCompositeOperation = "source-over";
      }
      const g = glow.getContext("2d");
      g.clearRect(0, 0, SW, SH);
      stars(g, t, 0, SW, 0, 72, s.dark * (1 - s.rain));
      celestial(g, s, 0, SW, 0, 92);
      g.globalCompositeOperation = "destination-out";
      g.drawImage(background(false, s)[1], 0, 0);
      g.globalCompositeOperation = "source-over";
      ctx.drawImage(glow, 0, 0);
      fireflies(ctx, tf, s);
      if (rain) rainfall(ctx, tf, s);
    }
    if (state.mood === "wasted") phone(ctx, t);
    if (state.mood === "break" && (zz || !napAnim)) zzz(ctx, t, ...(zz || [148, 62]));
  }

  // Slanted streaks falling across the whole scene, with rings where drops hit the water.
  function rainfall(ctx, t, s) {
    const col = mix("#dce8ff", "#7c88b8", s.dark);
    for (let i = 0; i < 90; i++) {
      const speed = 9 + (i % 4);
      const land = 108 + ((i * 53) % 52); // where this drop hits the water or dock
      const cycle = land + 20;
      const y = ((i * 37 + Math.floor(t * speed)) % cycle) - 20;
      const x = ((i * 71) % (W * S + 40)) - y * 0.35;
      if (y < land) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = col;
        for (let k = 0; k < 6; k += 2) ctx.fillRect(Math.round(x - k * 0.35), Math.round(y - k), 1, 2);
      } else if (y < land + 6) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = col;
        const r = Math.floor((y - land) / 2) + 1;
        ctx.fillRect(Math.round(x) - r, land, r * 2 + 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Rain running down the bedroom window.
  function windowRain(ctx, t) {
    ctx.fillStyle = "#b8c8f0";
    for (let i = 0; i < 22; i++) {
      const x = 28 + ((i * 13) % 64);
      const y = 18 + ((i * 19 + Math.floor(t * (3 + (i % 3)))) % 52);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x, y, 1, 3);
    }
    ctx.globalAlpha = 1;
  }

  // A hand out of the blanket holds the phone up in front of the face; the feed scrolls.
  function phone(ctx, t) {
    const flick = Math.floor(t / 3) % 2;
    ctx.fillStyle = "#fce1c8";
    ctx.fillRect(160, 82 - flick, 6, 12);
    ctx.fillStyle = "#1b1528";
    ctx.fillRect(152, 56 - flick, 16, 28);
    const scroll = (t * 3) % 24;
    for (let y = 0; y < 24; y++) {
      const k = Math.floor((y + scroll) / 2) % 6;
      ctx.fillStyle = k === 0 ? "#ff8fb1" : k === 3 ? "#ffffff" : k === 5 ? "#ffd27a" : "#8fd8ff";
      ctx.fillRect(154, 58 - flick + y, 12, 1);
    }
    ctx.fillStyle = "#8fd8ff";
    for (const [x, y, w, h, a] of [[100, 50, 74, 46, 0.05], [112, 56, 56, 36, 0.07]]) {
      ctx.globalAlpha = a;
      ctx.fillRect(x, y - flick, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function zzz(ctx, t, x0, y0) {
    for (let i = 0; i < 3; i++) {
      const p = (t + i * 10) % 30;
      const zx = x0 + i * 12 + Math.floor(p / 3), zy = y0 - p;
      ctx.globalAlpha = 1 - p / 30;
      paint(ctx, ["oooooo", "....o.", "...o..", "..o...", ".o....", "oooooo"], zx, zy, { o: "#e8e6ff" });
      ctx.globalAlpha = 1;
    }
  }

  function redrawAll() {
    for (const c of canvases.values()) draw(c);
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (!reduced.matches) clock += now - last; // reduced motion: the scene holds still
    last = now;
    tf = clock / TICK;
    t = Math.floor(tf);
    for (const [id, canvas] of canvases) {
      if (!canvas.isConnected) {
        canvases.delete(id);
        continue;
      }
      draw(canvas);
    }
  }, 1000 / FPS);

  return {
    attach(id) {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      canvas.width = W * S;
      canvas.height = H * S;
      canvases.set(id, canvas);
      draw(canvas);
    },
    update(next) {
      if (next.mood && next.mood !== state.mood) moodAt = clock; // restart the transition animations
      state = { ...state, ...next, character: next.character ?? state.character };
      redrawAll();
    },
  };
})();

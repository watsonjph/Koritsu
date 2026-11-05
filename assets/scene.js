// Pixel-art companion: the character sprite sheet (assets/character.png, 8 walk frames of
// 64×64) acting out what you're doing. Backgrounds are drawn in code at 160×80 and doubled,
// the sprite is drawn at full detail on top.
//
// Moods: idle (strolling on the dock), productive (fishing or reading), wasted (on a train,
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
  // On her phone the far arm comes forward under the near one, so both hands hold it.
  const PHONE_ARM = [
    [29, 37, "owwo"],
    [28, 38, "owwwo"],
    [27, 39, "owwwvo"],
    [26, 40, "owwwvo"],
    [26, 41, "owwvVo"],
    [21, 42, "owwwwwvVo"],
    [17, 43, "owwwwwwwvVVo"],
    [14, 44, "ossowwwwwvVVo"],
    [13, 45, "osssowwwvVVo"],
    [14, 46, "oooooooooo"],
  ];
  const PHONE = { x: 10, y: 37, w: 5, h: 9 }; // in front of her chest, below the chin
  const PHONE_GRIP = { x: 13, y: 44, w: 4, h: 3 }; // far hand, redrawn over the phone
  const GRIP = { x: 11, y: 40, w: 5, h: 3 }; // near fist, redrawn over the rod
  const BACK_GRIP = { x: 23, y: 46, w: 6, h: 2 }; // far hand, redrawn over the rod
  const BUTT = [25, 47]; // the rod's end, in the far hand
  const HEM = 53; // last row of the hakama; the legs below it dangle separately
  const LEGS = [[23, 7], [31, 8]]; // [x, width] of each lower leg, rows HEM+1..61
  const SLEEVE = new Set(["#fdfcfa", "#c8b6c4", "#ac9eb4", "#5c5854", "#696461", "#393331", "#fce1c8", "#edb9af", "#cb8e76"]);

  function buildSit(src, rc, back = BACK_ARM) {
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
    for (const [x0, y, row] of [...back, ...ARM]) [...row].forEach((k, i) => k !== "." && set(x0 + i, y, pal[k]));
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
    cache.sitPhone = buildSit(cache.frames[0], rc, PHONE_ARM).cv;
    cache.sitPhoneShut = buildSit(cache.shut, rc, PHONE_ARM).cv;
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

  function sky(hour, rain, snow = false) {
    let i = 0;
    while (hour > SKY[i + 1][0]) i++;
    const [h0, t0, b0, d0] = SKY[i], [h1, t1, b1, d1] = SKY[i + 1];
    const u = (hour - h0) / (h1 - h0);
    let top = mix(t0, t1, u), bottom = mix(b0, b1, u), dark = d0 + (d1 - d0) * u;
    if (rain) {
      // overcast: wash toward grey, a little darker
      // snow clouds are paler than rain clouds
      top = mix(top, mix(snow ? "#a7aebb" : "#5f6878", "#1c2030", dark), 0.6 * rain);
      bottom = mix(bottom, mix(snow ? "#d2d6de" : "#8a93a3", "#2a2f40", dark), 0.6 * rain);
      dark = Math.min(1, dark + 0.12 * rain);
    }
    return { top, bottom, dark, hour, rain };
  }

  // Is it raining? "auto" makes roughly one hour in five rainy, the same for everyone at that hour.
  function rainAt(mode, now) {
    if (mode === "rain" || mode === "snow") return 1;
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

  // ---------- the train ----------
  // Seen from the side: forward-facing seats under one long window, scenery sliding past.
  // She sits in the middle seat facing right, on her phone.
  const WIN_TOP = 22, WIN_BOTTOM = 70;
  const PILLARS = [36, 126, 216, 306]; // frames between the panes, 8 wide
  const SEATS = [60, 150, 240]; // left edge of each seat back; she sits in the middle one
  const SEAT_TOP = 110;
  function trainLayers(s) {
    const out = layer(), o = out.getContext("2d");
    bands(o, s.top, s.bottom, WIN_TOP, WIN_BOTTOM, 5);
    stars(o, 0, 0, SW, WIN_TOP, WIN_BOTTOM - 20, s.dark * (1 - s.rain));
    o.save();
    o.beginPath();
    o.rect(0, WIN_TOP, SW, WIN_BOTTOM - WIN_TOP);
    o.clip();
    celestial(o, s, 0, SW, WIN_TOP, WIN_BOTTOM);
    o.restore();

    const car = layer(), g = car.getContext("2d");
    const lit = (c) => mix(c, "#2a2840", s.dark * 0.25); // the lights are on; night still shows a little
    const frame = lit("#9aa2ab"), shine = lit("#c3c9cf"), steel = lit("#7d848c");
    rect(g, 0, 0, SW, SH, lit("#e6dfcc")); // wall
    rect(g, 0, 0, SW, 8, lit("#d4cebf")); // ceiling
    rect(g, 0, 3, SW, 2, "#fff6d8"); // light strip
    // luggage rack
    rect(g, 0, 11, SW, 2, shine);
    for (let x = 0; x < SW; x += 4) rect(g, x, 13, 1, 3, steel);
    rect(g, 0, 16, SW, 1, steel);
    // window, frames and sill
    rect(g, 0, WIN_TOP - 3, SW, WIN_BOTTOM - WIN_TOP + 6, frame);
    g.clearRect(0, WIN_TOP, SW, WIN_BOTTOM - WIN_TOP);
    for (const x of PILLARS) {
      rect(g, x, WIN_TOP - 3, 8, WIN_BOTTOM - WIN_TOP + 6, frame);
      rect(g, x + 1, WIN_TOP, 1, WIN_BOTTOM - WIN_TOP, shine);
    }
    rect(g, 0, WIN_BOTTOM + 1, SW, 2, shine);
    rect(g, 0, WIN_BOTTOM + 3, SW, 1, steel);
    // lower wall and floor
    rect(g, 0, 98, SW, 38, lit("#d3cab3"));
    rect(g, 0, 98, SW, 1, lit("#bdb39a"));
    rect(g, 0, 136, SW, 24, lit("#7b7f86"));
    rect(g, 0, 136, SW, 2, lit("#9aa0a8"));
    for (let x = 3; x < SW; x += 9) px(g, x, 142 + (x % 4) * 4, lit("#8c9097"));
    // seats: tall back with a white headrest cover, cushion, pedestal
    const seat = lit("#3f6f93"), seatLit = lit("#5e8fb5"), seatDark = lit("#2c4f6b");
    for (const x of SEATS) {
      rect(g, x, 60, 12, SEAT_TOP - 58, seat);
      rect(g, x + 1, 60, 2, SEAT_TOP - 58, seatLit);
      rect(g, x + 10, 60, 2, SEAT_TOP - 58, seatDark);
      rect(g, x + 1, 58, 10, 2, seat);
      rect(g, x, 60, 12, 12, "#f2f0ea");
      rect(g, x, 71, 12, 1, "#d6d2c8");
      rect(g, x + 12, SEAT_TOP, 26, 8, seat);
      rect(g, x + 12, SEAT_TOP, 26, 2, seatLit);
      rect(g, x + 12, SEAT_TOP + 7, 26, 1, seatDark);
      rect(g, x + 18, SEAT_TOP + 8, 12, 136 - SEAT_TOP - 8, lit("#5d6066"));
      rect(g, x + 18, SEAT_TOP + 8, 12, 1, lit("#45484d"));
    }
    return [out, car];
  }

  // Outside the window: hills, houses and poles sliding past at their own speeds.
  function passing(ctx, tf, s, rain, snow) {
    const y0 = WIN_TOP, y1 = WIN_BOTTOM;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, SW, y1 - y0);
    ctx.clip();
    const far = mix("#9cbad4", "#26304e", s.dark), mid = mix("#6f9f78", "#1b2639", s.dark);
    const roof = mix("#b8584a", "#2a2236", s.dark), near = mix("#4e7d5a", "#121a2a", s.dark);
    for (let x = 0; x < SW; x++) {
      const h = Math.round(16 * noise((x + tf * 0.5) / 26));
      rect(ctx, x, y1 - 14 - h, 1, h + 14, far);
    }
    const span = SW + 60;
    for (let i = 0; i < 9; i++) {
      const x = Math.round(((i * 41 - tf * 3) % span + span) % span) - 40;
      if (i % 3 === 0) {
        disc(ctx, x + 6, y1 - 13, 6, mid);
        rect(ctx, x + 5, y1 - 8, 2, 8, mid);
        continue;
      }
      const w = 14 + (i % 2) * 6, h = 8 + (i % 4) * 2;
      rect(ctx, x, y1 - h, w, h, mid);
      for (let r = 0; r < 4; r++) rect(ctx, x - 1 + r, y1 - h - 4 + r, w + 2 - r * 2, 1, roof);
      if (s.dark > 0.4) for (let k = 3; k < w - 2; k += 5) rect(ctx, x + k, y1 - h + 3, 2, 2, "#ffd77a");
    }
    rect(ctx, 0, y1 - 4, SW, 4, near);
    rect(ctx, 0, y0 + 7, SW, 1, mix("#3a3f48", "#0c1018", s.dark)); // overhead wire
    for (let i = 0; i < 3; i++) {
      const x = Math.round(((i * 150 - tf * 20) % (SW + 150) + SW + 150) % (SW + 150)) - 20;
      rect(ctx, x, y0, 3, y1 - y0, mix("#3a3f48", "#0c1018", s.dark));
    }
    if (rain) {
      ctx.fillStyle = mix(s.bottom, "#ffffff", 0.6);
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 36; i++) {
        const x = Math.round(((i * 47 - tf * 6) % SW + SW) % SW), y = y0 + ((i * 13 + Math.floor(tf)) % (y1 - y0));
        ctx.fillRect(x, y, 4, 1);
        ctx.fillRect(x + 4, y + 1, 2, 1);
      }
    }
    if (snow) snowfall(ctx, tf, s, [0, y0, SW, y1 - y0], 60, 7);
    // glare on the glass
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    for (const x0 of [60, 190]) for (let k = 0; k < 10; k++) ctx.fillRect(x0 + k * 2, y1 - 6 - k * 4, 6, 4);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Hand straps hanging from the rack, swaying with the train.
  function straps(ctx, tf) {
    for (let i = 0; i < 7; i++) {
      const x = 22 + i * 46, sway = Math.round(Math.sin(tf / 5 + i * 0.7) * 1.2);
      rect(ctx, x, 17, 2, 8, "#f2f0ea");
      rect(ctx, x + Math.round(sway / 2), 25, 2, 4, "#f2f0ea");
      paint(ctx, [".ooo.", "o...o", "o...o", ".ooo."], x - 1 + sway, 29, { o: "#d8d2c4" });
    }
  }

  // ---------- lettering: a 3×5 pixel font, and kanji snapped from the system font ----------
  const FONT = {
    A: ".#./#.#/###/#.#/#.#", B: "##./#.#/##./#.#/##.", C: ".##/#../#../#../.##", D: "##./#.#/#.#/#.#/##.",
    E: "###/#../##./#../###", F: "###/#../##./#../#..", G: ".##/#../#.#/#.#/.##", H: "#.#/#.#/###/#.#/#.#",
    I: "###/.#./.#./.#./###", J: "..#/..#/..#/#.#/.#.", K: "#.#/#.#/##./#.#/#.#", L: "#../#../#../#../###",
    M: "#.#/###/###/#.#/#.#", N: "##./#.#/#.#/#.#/#.#", O: ".#./#.#/#.#/#.#/.#.", P: "##./#.#/##./#../#..",
    Q: ".#./#.#/#.#/##./.##", R: "##./#.#/##./#.#/#.#", S: ".##/#../.#./..#/##.", T: "###/.#./.#./.#./.#.",
    U: "#.#/#.#/#.#/#.#/###", V: "#.#/#.#/#.#/#.#/.#.", W: "#.#/#.#/###/###/#.#", X: "#.#/#.#/.#./#.#/#.#",
    Y: "#.#/#.#/.#./.#./.#.", Z: "###/..#/.#./#../###",
    0: "###/#.#/#.#/#.#/###", 1: ".#./##./.#./.#./###", 2: "##./..#/.#./#../###", 3: "##./..#/.#./..#/##.",
    4: "#.#/#.#/###/..#/..#", 5: "###/#../##./..#/##.", 6: ".##/#../###/#.#/###", 7: "###/..#/.#./.#./.#.",
    8: "###/#.#/###/#.#/###", 9: "###/#.#/###/..#/##.",
    ":": ".../.#./.../.#./...", ".": ".../.../.../.../.#.", "-": ".../.../###/.../...",
    ">": "#../.#./..#/.#./#..", "<": "..#/.#./#../.#./..#",
  };
  const textWidth = (str) => str.length * 4 - 1;
  function text(ctx, str, x, y, color) {
    ctx.fillStyle = color;
    [...str.toUpperCase()].forEach((ch, i) => {
      FONT[ch]?.split("/").forEach((row, r) => [...row].forEach((k, c) => k === "#" && ctx.fillRect(x + i * 4 + c, y + r, 1, 1)));
    });
  }
  // ponytail: kanji come from the system's Japanese font (every Windows and macOS has one; a bare
  // Linux without CJK fonts shows boxes). Hand-drawn glyphs if that matters.
  const glyphs = new Map();
  function kanjiGlyph(str, size, color) {
    const key = `${str}|${size}|${color}`;
    if (!glyphs.has(key)) {
      const c = document.createElement("canvas");
      c.width = size * str.length + 4;
      c.height = size + 4;
      const g = c.getContext("2d");
      g.font = `bold ${size}px "Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif`;
      g.textBaseline = "top";
      g.fillText(str, 0, 1);
      const id = g.getImageData(0, 0, c.width, c.height), d = id.data, [r, gr, b] = hex(color);
      for (let k = 0; k < d.length; k += 4) [d[k], d[k + 1], d[k + 2], d[k + 3]] = d[k + 3] > 110 ? [r, gr, b, 255] : [0, 0, 0, 0];
      g.putImageData(id, 0, 0);
      glyphs.set(key, { c, w: Math.ceil(g.measureText(str).width) });
    }
    return glyphs.get(key);
  }

  // ---------- the commute: wait on a platform, ride to the next station, repeat ----------
  // 桜 稲荷 月見 蛍 湖畔 紅葉, escaped: the app's page isn't declared UTF-8, so raw kanji in a script
  // get misread there.
  const ROUTE = [["\u685c", "SAKURA"], ["\u7a32\u8377", "INARI"], ["\u6708\u898b", "TSUKIMI"], ["\u86cd", "HOTARU"], ["\u6e56\u7554", "KOHAN"], ["\u7d05\u8449", "MOMIJI"]];
  const SERVICES = [["LOCAL", "#3fae5a"], ["RAPID", "#f28b30"], ["EXPRESS", "#e0484d"], ["SEMI EXP", "#3f8fd8"]];
  const WAIT = 34000, RIDE = 30000, LEG = WAIT + RIDE; // ms on the platform, then on the train
  // Within WAIT: she steps off and walks to the bench, her train pulls out, the next pulls in and
  // opens its doors, she walks over and hops on, the doors shut.
  const OFF = 1000, DOWN = 1800, SEATED = 4500, LEAVE = 3000, GONE = 9000;
  const ARRIVE = 22000, DOORS = 28000, STAND = 28500, HOP = 31000, ON = 31800, SHUT = 33000;
  const BENCH_X = 150, PLATFORM_FEET = 126;
  const PLATFORM = 100; // far edge of the platform; the far track runs just behind it
  const LINE = "#3fae5a";
  const at = (i) => ROUTE[((i % ROUTE.length) + ROUTE.length) % ROUTE.length];
  const service = (i) => SERVICES[((i % SERVICES.length) + SERVICES.length) % SERVICES.length];
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  // Static parts: what's across the tracks, and the platform itself.
  function stationLayers(s, i) {
    const far = layer(), g = far.getContext("2d");
    bands(g, s.top, s.bottom, 0, PLATFORM, 6);
    stars(g, 0, 0, SW, 0, 60, s.dark * (1 - s.rain));
    celestial(g, s, 0, SW, 0, 70);
    const hill = mix(s.bottom, "#5a6a9a", 0.45);
    for (let x = 0; x < SW; x++) {
      const h = Math.round(22 * noise(x / 40 + i * 3));
      rect(g, x, 70 - h, 1, h + 30, hill);
    }
    // the town across the tracks; each station's is different
    for (let x = -6, n = 0; x < SW; n++) {
      const w = 18 + Math.floor(hash(n * 7 + i * 31) * 22), h = 12 + Math.floor(hash(n * 3 + i * 17) * 18);
      const wall = ["#e9e1d3", "#d6dbe4", "#efe6da", "#cfd6cf"][Math.floor(hash(n + i * 5) * 4)];
      rect(g, x, 92 - h, w, h, wall);
      rect(g, x - 2, 92 - h - 3, w + 4, 3, "#5a4b5e");
      rect(g, x + 2, 92 - h - 5, w - 4, 2, "#5a4b5e");
      for (let k = 4; k < w - 3; k += 6) rect(g, x + k, 92 - h + 4, 3, 3, "#7b8aa8");
      x += w + 4 + Math.floor(hash(n * 11 + i) * 16);
    }
    // cherry trees
    for (const tx of [(i * 53) % 90 + 4, 250 + ((i * 29) % 50)]) {
      rect(g, tx + 9, 66, 3, 28, "#5a3a3e");
      for (const [dx, dy, r, c] of [[10, 58, 13, "#e98fb0"], [3, 62, 8, "#f2a7c3"], [18, 61, 9, "#f2a7c3"], [10, 52, 7, "#f7c6d9"]]) disc(g, tx + dx, dy, r, c, Math.round(r * 0.8));
    }
    // a utility pole and its wires
    const pole = 150 + ((i * 41) % 60);
    rect(g, pole, 26, 3, 70, "#4a4f5a");
    rect(g, pole - 6, 30, 15, 2, "#4a4f5a");
    for (const y0 of [31, 35]) for (let x = 0; x < SW; x++) px(g, x, y0 + Math.round(4 * Math.sin((Math.abs(x - pole) / 200) * Math.PI)), "#4a4f5a");
    // fence, ballast and the far track
    rect(g, 0, 88, SW, 1, "#8a8f9c");
    for (let x = 0; x < SW; x += 8) rect(g, x, 88, 1, 8, "#8a8f9c");
    rect(g, 0, 95, SW, 5, "#6d6670");
    rect(g, 0, 96, SW, 1, "#b0b4bc");

    const plat = layer(), p = plat.getContext("2d");
    rect(p, 0, PLATFORM, SW, 34, "#aeb2bf");
    for (let x = 0; x < SW; x += 20) rect(p, x, PLATFORM + 4, 1, 27, "#a3a7b4");
    rect(p, 0, PLATFORM, SW, 1, "#cfd2da");
    rect(p, 0, PLATFORM + 1, SW, 3, "#e8c23a"); // tactile strip along the edge
    for (let x = 1; x < SW; x += 3) px(p, x, PLATFORM + 2, "#c9a42a");
    rect(p, 0, 131, SW, 2, "#f0f0f0");
    rect(p, 0, 134, SW, 6, "#7d8290");
    rect(p, 0, 134, SW, 1, "#959aa6");
    rect(p, 0, 140, SW, 20, "#262a33"); // the near track, down in its pit
    for (let x = 4; x < SW; x += 14) rect(p, x, 151, 8, 4, "#3a3530");
    rect(p, 0, 149, SW, 2, "#8a8f99");
    rect(p, 0, 156, SW, 2, "#8a8f99");
    // canopy and pillars (red and white at the base)
    rect(p, 0, 0, SW, 9, "#4b5568");
    rect(p, 0, 9, SW, 3, "#3a4252");
    for (let x = 0; x < SW; x += 40) rect(p, x, 9, 2, 3, "#2e3442");
    for (const x of [76, 216]) {
      rect(p, x, 12, 6, 116, "#6c7486");
      rect(p, x + 1, 12, 1, 116, "#8a93a6");
      for (let y = 104; y < 128; y += 4) rect(p, x, y, 6, 2, "#e0484d");
    }
    // the departures board's rods and frame (the lettering lights up later)
    rect(p, 116, 12, 2, 4, "#3a3f4a");
    rect(p, 190, 12, 2, 4, "#3a3f4a");
    rect(p, 104, 16, 100, 30, "#3a3f4a");
    rect(p, 105, 17, 98, 28, "#111318");
    rect(p, 105, 37, 98, 1, "#24272e");
    // bins by the vending machine
    for (const [x, c] of [[48, "#4f7ab8"], [60, "#3fae5a"]]) {
      rect(p, x, 110, 11, 18, "#c9ccd4");
      rect(p, x + 2, 112, 7, 3, c);
      rect(p, x + 3, 113, 5, 1, "#222");
    }
    // bench: a row of moulded seats
    for (let k = 0; k < 4; k++) {
      const x = 120 + k * 18;
      rect(p, x, 97, 16, 13, "#f2a65a");
      rect(p, x + 1, 96, 14, 1, "#f2a65a");
      rect(p, x + 1, 97, 14, 2, "#f8c48a");
      rect(p, x, 110, 16, 3, "#d98a40");
    }
    rect(p, 122, 113, 68, 2, "#5d6066");
    for (const x of [124, 184]) rect(p, x, 113, 3, 15, "#5d6066");
    // the station sign's legs
    for (const x of [238, 300]) rect(p, x, 92, 2, 36, "#8a8f99");
    return [far, plat];
  }

  // A commuter train on the far track; `x` is its front (left) end. Doors are tall enough for her.
  const CAR = 140, CAR_TOP = 24, CAR_BOT = 96, DOOR_TOP = 30, DOOR_W = 22, CAR_DOORS = [16, 62, 108];
  const TRAIN_STOP = 4; // where the front stops at the platform
  const DOOR_X = TRAIN_STOP + CAR + 2 + CAR_DOORS[0] + DOOR_W / 2; // the door she uses (second car)
  const DOOR_FEET = CAR_BOT - 4; // the train's floor, level with the doorway
  function farTrain(ctx, x, color, open, s) {
    const TOP = CAR_TOP, BOT = CAR_BOT, night = s.dark > 0.3;
    const glass = night ? "#ffe9a8" : "#33435e", inside = night ? "#f5e6b0" : "#3a3f4c";
    for (let i = 0; i < 3; i++) {
      const x0 = Math.round(x + i * (CAR + 2));
      if (x0 > SW || x0 + CAR < 0) continue;
      rect(ctx, x0, TOP, CAR, BOT - TOP, "#dfe3e8");
      rect(ctx, x0 + 1, TOP - 2, CAR - 2, 2, "#b9c0c8");
      rect(ctx, x0, TOP, CAR, 1, "#f4f6f8");
      rect(ctx, x0, TOP + 3, CAR, 2, color);
      rect(ctx, x0, 70, CAR, 5, color);
      for (const [wx, ww] of [[3, 9], [42, 16], [88, 16], [134, 4]]) {
        rect(ctx, x0 + wx, 34, ww, 24, glass);
        if (!night) for (let k = 0; k < 8; k++) px(ctx, x0 + wx + 2 + k, 55 - k, "#5c6f92");
      }
      for (const dx of CAR_DOORS) {
        const d = x0 + dx, h = BOT - 4 - DOOR_TOP;
        if (open) {
          rect(ctx, d, DOOR_TOP, DOOR_W, h, inside);
          rect(ctx, d, DOOR_TOP + h - 2, DOOR_W, 2, night ? "#d8c890" : "#2a2e38"); // floor
          rect(ctx, d - 6, DOOR_TOP, 6, h, "#c7cdd4");
          rect(ctx, d + DOOR_W, DOOR_TOP, 6, h, "#c7cdd4");
        } else {
          rect(ctx, d, DOOR_TOP, DOOR_W, h, "#cfd5dc");
          rect(ctx, d + DOOR_W / 2, DOOR_TOP, 1, h, "#9aa2ab");
          rect(ctx, d + 3, 34, 5, 18, glass);
          rect(ctx, d + 14, 34, 5, 18, glass);
        }
      }
      rect(ctx, x0, BOT - 4, CAR, 4, "#5d6066");
      if (i === 0) {
        // the cab: a sloped nose, front window, line colour and headlight
        for (let y = TOP; y < BOT; y++) {
          const cut = Math.max(0, 8 - (y - TOP));
          rect(ctx, x0 - 5 + cut, y, 5 - cut, 1, "#dfe3e8");
        }
        rect(ctx, x0 - 4, 34, 4, 22, glass);
        rect(ctx, x0 - 5, 70, 5, 5, color);
        rect(ctx, x0 - 5, 80, 2, 3, night ? "#fff6c0" : "#f4e7a0");
      }
    }
  }

  // Lit things on the platform, drawn over the night tint: board, sign, vending machine, lamps.
  function stationLights(ctx, t, leg, p) {
    // departures: the train due next, then the two after it, with real clock times
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const [kind, col] = service(leg + i), dest = at(leg + 2 + i)[1], y = 19 + i * 7;
      text(ctx, kind, 106, y, col);
      text(ctx, dest, 142, y, "#ffd27a");
      const here = i === 0 && p >= ARRIVE;
      text(ctx, here ? (t % 8 < 5 ? "NOW" : "") : hhmm(new Date(now + DOORS - p + [0, 7, 16][i] * 60000)), 182, y, "#ffd27a");
    }
    const [kind] = service(leg), msg = `KORITSU LINE  -  ${kind} FOR ${at(leg + 2)[1]}  -  PLEASE STAND BEHIND THE YELLOW LINE  -  `;
    ctx.save();
    ctx.beginPath();
    ctx.rect(105, 39, 98, 5);
    ctx.clip();
    text(ctx, msg, 203 - (Math.floor(tf) % (textWidth(msg) + 98)), 39, "#ff9a3c");
    ctx.restore();

    // the station sign: name, reading, and the stations either side
    const i = ((leg % ROUTE.length) + ROUTE.length) % ROUTE.length, [kj, name] = ROUTE[i];
    const x0 = 230, y0 = 62, w = 80;
    rect(ctx, x0 - 1, y0 - 1, w + 2, 32, "#8a8f99");
    rect(ctx, x0, y0, w, 30, "#f6f7f9");
    const k = kanjiGlyph(kj, 12, "#22252c");
    ctx.drawImage(k.c, Math.round(x0 + (w - k.w) / 2), y0 + 1);
    text(ctx, name, Math.round(x0 + (w - textWidth(name)) / 2), y0 + 16, "#22252c");
    rect(ctx, x0, y0 + 23, w, 7, LINE);
    text(ctx, "<" + at(i - 1)[1], x0 + 2, y0 + 24, "#ffffff");
    const next = at(i + 1)[1] + ">";
    text(ctx, next, x0 + w - 2 - textWidth(next), y0 + 24, "#ffffff");

    // vending machine
    rect(ctx, 14, 80, 32, 48, "#c8323c");
    rect(ctx, 14, 80, 32, 2, "#e0525a");
    rect(ctx, 44, 80, 2, 48, "#9a2430");
    rect(ctx, 17, 84, 26, 22, "#f4efe6");
    const drinks = ["#3fae5a", "#f2a65a", "#5b8cff", "#e0484d", "#f2d04a", "#8a5ab0"];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      rect(ctx, 18 + c * 4, 85 + r * 7, 3, 4, drinks[(c + r * 2) % 6]);
      px(ctx, 19 + c * 4, 90 + r * 7, "#ff5040");
    }
    rect(ctx, 18, 108, 14, 4, "#2a2228");
    if (t % 16 < 8) px(ctx, 20, 109, "#7bff8a");
    rect(ctx, 36, 108, 4, 6, "#d8d8d8");
    rect(ctx, 18, 117, 24, 6, "#2a2228");

    // fluorescent lamps under the canopy
    for (const x of [24, 134, 250]) rect(ctx, x, 12, 22, 2, "#b8f5dc");
  }

  // Cherry petals drifting across the platform.
  function petals(ctx, tf) {
    for (let i = 0; i < 9; i++) {
      const p = (tf * 0.8 + i * 41) % 170;
      const x = Math.round((i * 67 + p * 0.9 + Math.sin(p / 8 + i) * 5) % SW), y = Math.round(p * 0.8 - 6);
      if (y > 0 && y < 132) px(ctx, x, y, i % 2 ? "#ffd6e2" : "#f392b2");
    }
  }

  // Inside the train: the LED panel over the window announcing the next stop.
  function nextStop(ctx, t, leg, p) {
    const [kind] = service(leg), next = at(leg + 1)[1];
    rect(ctx, 198, 6, 104, 11, "#3a3f4a");
    rect(ctx, 199, 7, 102, 9, "#111318");
    const msg = p > LEG - 6000 ? `ARRIVING ${next}` : Math.floor(t / 24) % 2 ? `NEXT ${next}` : `${kind} FOR ${at(leg + 2)[1]}`;
    text(ctx, msg, 202, 9, "#ffa040");
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

  function strolling(ctx, t, tf, f, feet = DOCK_TOP) {
    let p = tf % IDLE_TICKS, seg = IDLE[0];
    for (seg of IDLE) {
      if (p < seg[1]) break;
      p -= seg[1];
    }
    const [what, len, from, to, right] = seg;
    const x = from + ((to - from) * p) / len; // glides at the redraw rate, not 8 fps
    if (what !== "walk" && what !== "stand" && f.anims[what]) {
      return drawAnim(ctx, f, what, frameAt(anims[what], p * TICK), x, feet, right);
    }
    const img = what === "walk" ? f.frames[t % FRAMES] : t % 48 === 47 ? f.shut : f.frames[0];
    drawFacing(ctx, img, x, feet, right);
  }

  // Where she is on the platform `p` ms into the wait while commuting: stepping off, walking to
  // the bench, sitting, walking to the next train's door, hopping on. Null once she's aboard.
  function onPlatform(p) {
    const lerp = (a, b, u) => a + (b - a) * Math.min(1, Math.max(0, u));
    if (p < OFF) return { door: true, x: DOOR_X, y: DOOR_FEET, right: false };
    if (p < DOWN) return { hop: (p - OFF) / (DOWN - OFF), x: DOOR_X, y: lerp(DOOR_FEET, PLATFORM_FEET, (p - OFF) / (DOWN - OFF)), right: false };
    if (p < SEATED) return { walk: true, x: lerp(DOOR_X, BENCH_X, (p - DOWN) / (SEATED - DOWN)), y: PLATFORM_FEET, right: false };
    if (p < STAND) return { sit: true };
    if (p < HOP) return { walk: true, x: lerp(BENCH_X, DOOR_X, (p - STAND) / (HOP - STAND)), y: PLATFORM_FEET, right: true };
    if (p < ON) return { hop: (p - HOP) / (ON - HOP), x: DOOR_X, y: lerp(PLATFORM_FEET, DOOR_FEET, (p - HOP) / (ON - HOP)), right: true };
    if (p < SHUT) return { door: true, x: DOOR_X, y: DOOR_FEET, right: true };
    return null;
  }
  function walker(ctx, t, f, w) {
    const hop = anims.hopping;
    if (w.hop !== undefined && hop && f.anims.hopping) return drawAnim(ctx, f, "hopping", frameAt(hop, w.hop * hop.total, true), w.x, w.y, w.right);
    drawFacing(ctx, w.walk ? f.frames[t % FRAMES] : f.frames[0], w.x, w.y, w.right);
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
  function sitting(ctx, t, f, hold, cx = 172, seat = DOCK_TOP) {
    if (!f.sit) return;
    const top = seat + 3 - HEM;
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
    const body = hold === "phone" ? (blink ? f.sitPhoneShut : f.sitPhone) : blink ? f.sitShut : f.sit;
    ctx.save();
    ctx.translate(cx, top);
    ctx.scale(-1, 1);
    ctx.drawImage(body, -FW / 2, 0);
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
    } else if (hold === "phone") {
      // Both hands on the phone in front of her chest; the feed scrolls.
      const px0 = sx(PHONE.x + PHONE.w - 1) - 1, py0 = sy(PHONE.y), scroll = Math.floor(t / 2) % 4;
      rect(ctx, px0, py0, PHONE.w, PHONE.h, "#1b1528");
      for (let y = 0; y < PHONE.h - 2; y++) {
        rect(ctx, px0 + 1, py0 + 1 + y, PHONE.w - 2, 1, ["#ff8fb1", "#8fd8ff", "#ffffff", "#ffd27a"][(y + scroll) % 4]);
      }
      ctx.save();
      ctx.translate(cx, top);
      ctx.scale(-1, 1);
      for (const gr of [GRIP, PHONE_GRIP]) ctx.drawImage(body, gr.x, gr.y, gr.w, gr.h, -FW / 2 + gr.x, gr.y, gr.w, gr.h);
      ctx.restore();
      ctx.globalAlpha = 0.1;
      disc(ctx, px0 + 2, py0 - 2, 9, "#8fd8ff");
      ctx.globalAlpha = 1;
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

  // Asleep in bed: head and ears upright on the pillow, peeking over the blanket. (Turning the
  // whole sprite on its side made the head unreadable at this size.)
  function lying(ctx, f) {
    const img = f.shut;
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
  function background(scene, s) {
    const key = `${scene}|${s.top}|${s.bottom}|${s.rain}|${s.dark.toFixed(2)}|${Math.floor(s.hour * 4)}`;
    if (bg.key !== key) {
      bg.layers =
        scene === "bedroom" ? [bedroomLayer(s)]
        : scene === "train" ? trainLayers(s)
        : scene.startsWith("station") ? stationLayers(s, +scene.split("-")[1])
        : lakeLayers(s);
      bg.key = key;
    }
    return bg.layers;
  }

  let lastStation = 0, routeStart = 0; // where she last got off; where the next commute starts
  const idx = (i) => ((i % ROUTE.length) + ROUTE.length) % ROUTE.length;

  function draw(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SW, SH);
    const f = frames(state.character);
    const now = new Date();
    const wet = rainAt(state.weather, now);
    const snow = !!wet && (state.weather === "snow" || (state.weather === "auto" && [11, 0, 1].includes(now.getMonth())));
    const rain = wet && !snow;
    const s = sky(FIXED_HOUR[state.sky] ?? now.getHours() + now.getMinutes() / 60, wet, snow);
    const since = clock - moodAt;
    const idle = state.mood === "idle";
    // Idle, she stays where the last thing you logged happened.
    const place = idle ? ({ wasted: "wasted", break: "break" }[state.last] ?? "productive") : state.mood;
    // Wasting time is a commute: a wait on the platform, then the ride to the next station.
    const riding = state.mood === "wasted";
    const leg = riding ? Math.floor(since / LEG) : 0, p = riding ? since % LEG : since % WAIT;
    const stop = riding ? routeStart + leg : lastStation;
    if (riding) lastStation = idx(stop + (p >= WAIT ? 1 : 0));
    const scene = place === "wasted" ? (p < WAIT ? `station-${idx(stop)}` : "train") : place === "break" ? "bedroom" : "lake";
    const indoors = scene === "bedroom", station = scene.startsWith("station");
    const where = riding && station ? onPlatform(p) : null;
    const napAnim = state.mood === "break" && !!f.anims["to-bed"];
    const outfit = state.character.outfit || "#e1262b";
    const breath = state.mood === "break" ? Math.floor(t / 8) % 2 : 0;

    if (indoors) {
      ctx.drawImage(background(scene, s)[0], 0, 0);
      if (napAnim || idle) blanket(ctx, outfit, 0, true); // a made bed (she naps on top of the covers)
    } else if (scene === "train") {
      const [outside, car] = background(scene, s);
      ctx.drawImage(outside, 0, 0);
      passing(ctx, tf, s, rain, snow);
      ctx.drawImage(car, 0, 0);
      straps(ctx, tf);
      nextStop(ctx, t, stop, p);
    } else if (station) {
      const [far, plat] = background(scene, s);
      ctx.drawImage(far, 0, 0);
      clouds(ctx, tf, s);
      // the train she came on pulls out; later the next one pulls in and opens its doors
      if (p < GONE) farTrain(ctx, TRAIN_STOP - 480 * Math.max(0, (p - LEAVE) / (GONE - LEAVE)) ** 2, service(stop - 1)[1], p < DOWN, s);
      else if (p >= ARRIVE) farTrain(ctx, TRAIN_STOP + 480 * (1 - Math.min(1, (p - ARRIVE) / (DOORS - ARRIVE))) ** 2, service(stop)[1], p >= DOORS && p < SHUT, s);
      if (where?.door) walker(ctx, t, f, where); // in the doorway, behind the platform
      ctx.drawImage(plat, 0, 0);
      if (!s.rain) petals(ctx, tf);
    } else {
      const [skyLayer, land] = background(scene, s);
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
    else if (state.mood === "break") lying(ctx, f);
    else if (scene === "train") sitting(ctx, t, f, "phone", SEATS[1] + 22, SEAT_TOP + (t % 24 === 0 ? 1 : 0)); // the odd bump on the rails
    else if (where?.sit) sitting(ctx, t, f, "phone", BENCH_X, 110);
    else if (where && !where.door) walker(ctx, t, f, where);
    else if (station && !riding) strolling(ctx, t, tf, f, PLATFORM_FEET);
    else if (indoors) strolling(ctx, t, tf, f, 140);
    else if (!station) strolling(ctx, t, tf, f);

    if (indoors) {
      if (!napAnim && !idle) blanket(ctx, outfit, breath, false);
      lampGlow(ctx, s);
      if (rain) windowRain(ctx, tf);
      if (snow) snowfall(ctx, tf, s, [25, 15, 68, 58], 14);
    } else if (scene === "lake") {
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
      g.drawImage(background(scene, s)[1], 0, 0);
      g.globalCompositeOperation = "source-over";
      ctx.drawImage(glow, 0, 0);
      fireflies(ctx, tf, s);
      if (rain) rainfall(ctx, tf, s);
      if (snow) snowfall(ctx, tf, s);
    } else if (station) {
      if (s.dark > 0.01) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = mix("#ffffff", "#2c3570", s.dark * 0.5);
        ctx.fillRect(0, 0, SW, SH);
        ctx.globalCompositeOperation = "source-over";
      }
      stationLights(ctx, t, stop, p);
      if (rain) rainfall(ctx, tf, s);
      if (snow) snowfall(ctx, tf, s);
    }
    if (state.mood === "break" && (zz || !napAnim)) zzz(ctx, t, ...(zz || [148, 62]));
  }

  // Snowflakes drifting down and swaying, over the whole scene or inside a window [x, y, w, h].
  // `wind` pushes them sideways (past a moving train's window).
  function snowfall(ctx, tf, s, [x0, y0, w, h] = [0, 0, SW, SH], n = 80, wind = 0) {
    ctx.fillStyle = mix("#ffffff", "#b8c0e0", s.dark * 0.6);
    for (let i = 0; i < n; i++) {
      const y = y0 + ((i * 37 + tf * (0.6 + (i % 3) * 0.3)) % h);
      const x = x0 + ((((i * 71 + Math.sin(tf / 9 + i) * 4 - tf * wind) % w) + w) % w);
      const size = i % 5 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
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
    // Hidden in the tray, or (unless set to animate in the background) another window has
    // focus: hold the frame and the clock, so nothing is missed and no CPU is spent.
    const paused = document.hidden || (!state.background && !document.hasFocus());
    if (!reduced.matches && !paused) clock += now - last; // reduced motion: the scene holds still
    last = now;
    if (paused) return;
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
      if (next.mood && next.mood !== state.mood) {
        moodAt = clock; // restart the transition animations
        if (next.mood === "wasted") routeStart = lastStation; // the commute carries on from where she got off
      }
      state = { ...state, ...next, character: next.character ?? state.character };
      redrawAll();
    },
  };
})();

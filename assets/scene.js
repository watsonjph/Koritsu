// Pixel-art companion: the character sprite sheet (assets/character.png, 8 walk frames of
// 64×64) acting out what you're doing. Backgrounds are drawn in code at 160×80 and doubled,
// the sprite is drawn at full detail on top.
//
// Moods: idle (strolling where she last was), productive (travelling: fishing at the lake, then
// studying at a konbini under Mt Fuji, on a Tokyo street, in Akihabara and out in the
// countryside), wasted (on a train,
// doomscrolling), break (asleep). The outdoor sky follows the local time of day.
window.koritsuScene = (() => {
  const W = 160, H = 100, S = 2; // scene size in double pixels: 320x200 drawn
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
  // Most scenes are laid out in 160 rows and sit at the bottom of the frame; the rows above
  // continue their top edge (sky, wall or ceiling). The konbini uses the full height.
  const OY = SH - 160;
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

  // A bench's backrest (two slats on posts), drawn behind her so she reads as sitting.
  function bench(g, x, seat, w) {
    for (const px0 of [x + 2, x + w - 4]) rect(g, px0, seat - 15, 2, 15, "#5e4030");
    for (const y of [seat - 14, seat - 8]) {
      rect(g, x, y, w, 3, "#8a5c3c");
      rect(g, x, y, w, 1, "#a8784e");
    }
  }

  // ---------- productive travels: a konbini under Mt Fuji, a Tokyo ramen street ----------
  // Each is [sky, land]: the sky keeps the hour's own colours; the land is tinted for night,
  // then its lit windows and signs are drawn over it (the "lights" functions) so they glow.
  const cp = (...codes) => String.fromCodePoint(...codes); // kanji without raw UTF-8 in the script

  // Darkens a layer for night, only where it's drawn (transparent areas stay transparent).
  function nightTint(cv, s, k) {
    if (s.dark <= 0.01) return;
    const g = cv.getContext("2d"), copy = layer();
    copy.getContext("2d").drawImage(cv, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = mix("#ffffff", "#2c3570", s.dark * k);
    g.fillRect(0, 0, SW, SH);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(copy, 0, 0);
    g.globalCompositeOperation = "source-over";
  }

  // Warm light on the snow around sunrise and sunset, 0..1.
  const alpenglow = (h) => Math.max(0, 1 - Math.min(Math.abs(h - 18.3), Math.abs(h - 6.2)) / 1.5);

  // Mt Fuji, pixel by pixel: gullies radiate from the summit, snow runs down them in fingers,
  // the sunlit flank is lighter, haze thickens toward the foot. Dawn and dusk turn it orange.
  function mountFuji(g, s) {
    const PEAK = 176, TOP = 10, BASE = 130, HALF = 240;
    const warm = alpenglow(s.hour) * (1 - s.rain);
    const tone = (day, dusk) => hex(mix(mix(day, dusk, warm), "#151a33", s.dark * 0.55));
    const C = {
      snowLit: tone("#f5f6fb", "#ffa27c"), snowMid: tone("#dfe3ef", "#f0866e"),
      snowShade: tone("#c3cadf", "#b88092"), snowDeep: tone("#a9b1cb", "#94657e"),
      rockLit: tone("#5a6390", "#c0645c"), rock: tone("#474d78", "#7c4e68"), rockDark: tone("#363b62", "#5a3a58"),
    };
    const haze = hex(s.bottom);
    const id = g.getImageData(0, 0, SW, BASE), d = id.data;
    for (let x = 0; x < SW; x++) {
      const dx = x - PEAK, dd = Math.abs(dx) / HALF;
      if (dd >= 1) continue;
      const top = Math.round(BASE - (BASE - TOP) * (1 - dd) ** 1.55) + (Math.abs(dx) < 7 ? 2 : 0);
      for (let y = Math.max(0, top); y < BASE; y++) {
        const dy = y - TOP + 5;
        const a = dx / dy + 0.05 * noise(y * 0.3 + x * 0.05); // constant along a line from the summit
        const ridge = 0.65 * noise(a * 7 + 11) + 0.35 * noise(a * 21 + 5);
        const snow = dy < 16 + 62 * ridge * ridge + 5 * noise(x * 0.6 + y * 0.4);
        const lit = dx > -dy * 0.1 + (ridge - 0.5) * 14;
        const gully = ridge < 0.4;
        const c = snow
          ? lit ? (gully ? C.snowMid : C.snowLit) : gully ? C.snowDeep : C.snowShade
          : lit ? (gully ? C.rock : C.rockLit) : gully ? C.rockDark : C.rock;
        const f = 0.32 * (y - TOP) / (BASE - TOP);
        const k = (y * SW + x) * 4;
        for (let i = 0; i < 3; i++) d[k + i] = c[i] + (haze[i] - c[i]) * f;
        d[k + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
  }

  // The konbini scene is drawn for the full 320×200 frame. Store rows:
  const ROOF = 108, FASCIA = 113, BANNER = 136, GLASS = 146, PAVE = 190;

  function fujiLayers(s) {
    const sky = layer(), g = sky.getContext("2d");
    bands(g, s.top, s.bottom, 0, 130, 8);
    stars(g, 0, 0, SW, 0, 70, s.dark * (1 - s.rain));
    celestial(g, s, 0, SW, 0, 56);
    mountFuji(g, s);

    const land = layer(), l = land.getContext("2d");
    // the dark roof of the building behind the store
    for (let x = 132; x < SW; x++) {
      const top = Math.round(92 + (SW - x) * 0.11);
      rect(l, x, top, 1, ROOF - top, "#26232f");
      if (x % 6 === 0) rect(l, x, top + 2, 1, ROOF - top - 2, "#2d2a38");
    }
    // poles, sagging wires, crows
    for (const [x, y] of [[66, 30], [292, 40]]) {
      rect(l, x, y, 4, ROOF - y, "#24212c");
      rect(l, x + 1, y, 1, ROOF - y, "#34303e");
      for (let k = y + 8; k < ROOF - 4; k += 9) rect(l, x - 1, k, 6, 1, "#1a1822");
      rect(l, x - 10, y + 8, 24, 2, "#24212c");
      rect(l, x + 4, y + 16, 6, 9, "#3a3644");
    }
    const wire = (y0, sag) => {
      for (let x = 0; x < SW; x++) {
        const [a, b] = x < 66 ? [-160, 66] : x < 292 ? [66, 292] : [292, 520];
        px(l, x, y0 + Math.round(sag * Math.sin(((x - a) / (b - a)) * Math.PI)), "#191720");
      }
    };
    for (const [y0, sag] of [[39, 4], [44, 5], [56, 6], [62, 6], [72, 5]]) wire(y0, sag);
    const crow = ["..oo.", ".oooo", "ooooo", ".ooo.", ".o.o."];
    for (const [cx, y0] of [[104, 42], [111, 43], [208, 51], [248, 61], [254, 61], [30, 71], [37, 71], [44, 71]]) paint(l, crow, cx, y0 - 5, { o: "#121019" });
    // the pole sign's post and frame (its face is lit later)
    rect(l, 30, 60, 4, ROOF - 60, "#3a3644");
    rect(l, 8, 20, 48, 38, "#8a8494");
    rect(l, 10, 60, 44, 10, "#8a8494");

    // roof slab, then the fascia: stripes, seams and a soffit
    rect(l, 0, ROOF, SW, 5, "#3a3644");
    rect(l, 0, ROOF, SW, 1, "#57516a");
    rect(l, 0, FASCIA, SW, 21, "#ece6ec");
    rect(l, 0, FASCIA + 5, SW, 3, "#ef7a5a");
    rect(l, 0, FASCIA + 9, SW, 4, "#2f9e8f");
    rect(l, 0, FASCIA + 14, SW, 3, "#2d4f8a");
    for (const x of [0, 80, 240]) rect(l, x, FASCIA, 2, 21, "#cfc6d2");
    rect(l, 0, FASCIA + 21, SW, 2, "#b9b0c0");
    // the storefront frame: columns between the windows and doors
    rect(l, 0, BANNER, SW, PAVE - BANNER, "#dcd4dc");
    for (const [x, w] of [[0, 4], [74, 4], [126, 3], [195, 3], [252, 4], [316, 4]]) {
      rect(l, x, BANNER, w, PAVE - BANNER, "#b3aab8");
      rect(l, x, BANNER, 1, PAVE - BANNER, "#cbc3cf");
    }
    // right wall: panels, recycling bins and a red post box
    rect(l, 256, GLASS, 60, PAVE - GLASS, "#e4dde4");
    for (let y = GLASS + 4; y < PAVE; y += 10) rect(l, 256, y, 60, 1, "#cfc6d2");
    for (const [x, c] of [[260, "#3fae5a"], [280, "#3f8fd8"]]) {
      rect(l, x, 160, 18, 30, "#8e939e");
      rect(l, x, 158, 18, 4, c);
      rect(l, x + 1, 158, 16, 1, mix(c, "#ffffff", 0.3));
      rect(l, x + 4, 166, 10, 2, "#2a2c34");
      rect(l, x + 5, 173, 8, 7, mix(c, "#ffffff", 0.15));
      rect(l, x + 7, 174, 4, 5, "#f4f6f8");
    }
    rect(l, 302, 152, 12, 38, "#c8323c");
    rect(l, 302, 152, 12, 3, "#e0525a");
    rect(l, 305, 159, 6, 2, "#2a1a1e");
    // a bench out front
    bench(l, 198, 178, 54);
    rect(l, 198, 178, 54, 3, "#9a6a46");
    rect(l, 198, 178, 54, 1, "#b88a60");
    rect(l, 198, 181, 54, 1, "#6e4a30");
    for (const x of [202, 246]) rect(l, x, 182, 2, PAVE - 182, "#4a4450");
    // pavement: tiles and the kerb
    rect(l, 0, PAVE, SW, SH - PAVE, "#8e8a96");
    rect(l, 0, PAVE, SW, 1, "#a9a5b2");
    for (let x = 0; x < SW; x += 20) rect(l, x, PAVE + 1, 1, SH - PAVE - 1, "#7f7b88");
    rect(l, 0, SH - 2, SW, 2, "#6e6a78");
    nightTint(land, s, 0.55);
    return [sky, land];
  }

  // The store's own light: pole sign, fascia logo, banner, the stocked shop seen through the glass.
  const GOODS = ["#ef7a5a", "#f2c84a", "#5b8cff", "#3fae5a", "#f392b2", "#ffffff", "#36a59a", "#e0484d", "#8a5ab0"];
  function shelves(ctx, x0, x1) {
    const h = PAVE - GLASS;
    rect(ctx, x0, GLASS, x1 - x0, h, "#f8f0e2");
    for (let x = x0 + 3; x < x1; x += 14) rect(ctx, x, GLASS + 1, 9, 1, "#ffffff"); // ceiling lights
    rect(ctx, x0, GLASS + 3, x1 - x0, 1, "#e6dccb");
    for (let r = 0; r < 4; r++) {
      const y = GLASS + 10 + r * 9;
      for (let x = x0 + 1; x < x1 - 1; x += 3) {
        const c = GOODS[Math.floor(hash(x * 7 + r * 13) * GOODS.length)];
        const tall = r === 0 && hash(x + 3) > 0.5; // bottles on the top shelf
        rect(ctx, x, y - (tall ? 2 : 0), 2, tall ? 7 : 5, c);
        if (tall) px(ctx, x, y - 3, "#fdfcf8");
      }
      rect(ctx, x0, y + 5, x1 - x0, 1, "#cdbfa8");
    }
    rect(ctx, x0, PAVE - 2, x1 - x0, 2, "#b9ab94");
  }
  function fujiLights(ctx, t) {
    // pole sign: the fox emblem, the name, and ATM 24H underneath
    rect(ctx, 10, 22, 44, 34, "#fbf8f4");
    foxMark(ctx, 27, 25);
    text(ctx, "KORITSU", 32 - Math.floor(textWidth("KORITSU") / 2), 41, "#2d4f8a");
    text(ctx, "MART", 32 - Math.floor(textWidth("MART") / 2), 48, "#ef7a5a");
    rect(ctx, 12, 61, 40, 8, "#c8323c");
    text(ctx, "ATM 24H", 32 - Math.floor(textWidth("ATM 24H") / 2), 62, "#ffffff");
    // fascia logo plate
    rect(ctx, 134, FASCIA - 2, 52, 25, "#b9b0c0");
    rect(ctx, 135, FASCIA - 1, 50, 23, "#fbf8f4");
    foxMark(ctx, 139, FASCIA + 5);
    text(ctx, "KORITSU", 152, FASCIA + 5, "#2d4f8a");
    text(ctx, "MART", 152, FASCIA + 12, "#ef7a5a");
    // downlights in the soffit
    for (let x = 10; x < SW; x += 26) rect(ctx, x, FASCIA + 21, 4, 1, "#fff6d8");

    // the shop through the glass: left windows, a window by the door, right window
    shelves(ctx, 4, 74);
    shelves(ctx, 78, 126);
    shelves(ctx, 198, 252);
    // magazine rack along the left window
    for (let x = 6; x < 72; x += 6) rect(ctx, x, PAVE - 10, 5, 8, GOODS[Math.floor(hash(x + 77) * GOODS.length)]);
    // the doors: a lighter aisle beyond, frames, emblem stickers, a mat
    rect(ctx, 129, GLASS, 66, PAVE - GLASS, "#fbf5ea");
    for (let x = 133; x < 192; x += 3) rect(ctx, x, GLASS + 12 + (x % 9 === 0 ? 2 : 0), 2, 4, GOODS[Math.floor(hash(x * 5) * GOODS.length)]);
    rect(ctx, 129, GLASS + 19, 66, 1, "#e0d6c4");
    for (const x of [129, 160, 162, 193]) rect(ctx, x, GLASS, 2, PAVE - GLASS, "#6a6470");
    rect(ctx, 129, GLASS, 66, 2, "#6a6470");
    foxMark(ctx, 139, GLASS + 22);
    foxMark(ctx, 171, GLASS + 22);
    rect(ctx, 156, GLASS + 26, 2, 7, "#9a96a0");
    rect(ctx, 164, GLASS + 26, 2, 7, "#9a96a0");
    rect(ctx, 134, PAVE - 2, 56, 2, "#5a4a52");
    // bunting strung across the windows
    for (let x = 4; x < 252; x += 4) {
      if (x > 126 && x < 198) continue;
      const c = ["#e0484d", "#3fae5a", "#ffffff"][(x / 4) % 3];
      rect(ctx, x, GLASS + 15, 3, 1, c);
      px(ctx, x + 1, GLASS + 16, c);
    }
    // posters on the glass: a night-sky poster, a NEW sticker, a mascot
    rect(ctx, 84, GLASS + 18, 16, 22, "#22356e");
    disc(ctx, 91, GLASS + 26, 4, "#ffd23a");
    disc(ctx, 93, GLASS + 25, 4, "#22356e");
    for (const [x, y] of [[87, 21], [97, 31], [88, 36]]) px(ctx, x, GLASS + y, "#ffffff");
    rect(ctx, 105, GLASS + 26, 15, 10, "#ffffff");
    rect(ctx, 106, GLASS + 27, 13, 3, "#e0484d");
    text(ctx, "NEW", 107, GLASS + 31, "#e0484d");
    paint(ctx, [".y..y.", "yyyyyy", "ywyywy", "yyyyyy", ".rrrr.", ".bbbb."], 230, GLASS + 22, { y: "#ffd84a", w: "#3a2a24", r: "#e0484d", b: "#5b8cff" });
    // counter corner: the till sign, and tobacco / alcohol notices
    const sign = (str, x, y, w, bg, fg) => {
      rect(ctx, x, y, w, 10, bg);
      const k = kanjiGlyph(str, 8, fg);
      ctx.drawImage(k.c, x + Math.round((w - k.w) / 2), y + 1);
    };
    sign(cp(0x30ec, 0x30b8), 260, BANNER, 52, "#3fae5a", "#ffffff"); // レジ
    sign(cp(0x305f, 0x3070, 0x3053), 258, GLASS + 1, 28, "#ffffff", "#e0484d"); // たばこ
    sign(cp(0x304a, 0x9152), 288, GLASS + 1, 26, "#ffffff", "#3fae5a"); // お酒

    // the banner: 50円 in yellow, おにぎり in white, rice balls in nori
    rect(ctx, 46, BANNER, 176, 10, "#1b1e33");
    rect(ctx, 48, BANNER + 1, 28, 8, "#ffd23a");
    text(ctx, "50", 51, BANNER + 3, "#1b1e33");
    const yen = kanjiGlyph(cp(0x5186), 8, "#1b1e33");
    ctx.drawImage(yen.c, 60, BANNER + 1);
    rect(ctx, 78, BANNER + 1, 92, 8, "#ffffff");
    const umai = kanjiGlyph(cp(0x304a, 0x3044, 0x3057, 0x3044, 0x3088), 8, "#1b1e33"); // おいしいよ
    ctx.drawImage(umai.c, 80, BANNER + 1);
    const onigiri = kanjiGlyph(cp(0x304a, 0x306b, 0x304e, 0x308a), 8, "#ffffff");
    ctx.drawImage(onigiri.c, 172, BANNER + 1);
    for (const x of [206, 214]) paint(ctx, ["..w..", ".www.", "wwwww", "nnnnn"], x, BANNER + 3, { w: "#ffffff", n: "#1f3a2a" });
    // a red flag: 新商品, new arrivals
    rect(ctx, 6, GLASS - 2, 1, PAVE - GLASS + 2, "#8e939e");
    rect(ctx, 7, GLASS - 1, 12, 36, "#c8323c");
    [0x65b0, 0x5546, 0x54c1].forEach((code, i) => {
      const k = kanjiGlyph(cp(code), 8, "#ffffff");
      ctx.drawImage(k.c, 13 - Math.round(k.w / 2), GLASS + 1 + i * 11);
    });
  }

  // An original fox-head emblem for the store, 10×10.
  function foxMark(ctx, x, y) {
    paint(ctx, [
      "o........o",
      "oo......oo",
      "owo....owo",
      "owwooooowo",
      "owwwwwwwwo",
      ".owewwewo.",
      ".owwwwwwo.",
      "..owwnwo..",
      "...owwo...",
      "....oo....",
    ], x, y, { o: "#ef7a5a", w: "#ffd6a8", e: "#2d4f8a", n: "#2a1a1e" });
  }

  // Far towers behind the ramen street: [x, width, height].
  const TOWERS = [];
  for (let x = -4, n = 0; x < SW; n++) {
    const w = 14 + Math.floor(hash(n * 5 + 1) * 24);
    TOWERS.push([x, w, 30 + Math.floor(hash(n * 3 + 7) * 54)]);
    x += w + 2;
  }
  const UPPER = []; // the main building's upper-floor windows: [x, y]
  for (const y of [26, 50]) for (let x = 72; x < 256; x += 23) UPPER.push([x, y]);

  function tokyoLayers(s) {
    const sky = layer(), g = sky.getContext("2d");
    bands(g, s.top, s.bottom, 0, 110, 6);
    stars(g, 0, 0, SW, 0, 40, s.dark * (1 - s.rain));
    celestial(g, s, 0, SW, 0, 50);

    const land = layer(), l = land.getContext("2d");
    for (const [x, w, h] of TOWERS) {
      rect(l, x, 100 - h, w, h + 10, mix("#3d4458", s.bottom, 0.25));
      rect(l, x, 100 - h, 1, h + 10, mix("#4a526a", s.bottom, 0.25));
    }
    // the building on the left, a tree and a street lamp
    rect(l, 0, 30, 66, 96, "#4a5060");
    for (let y = 38; y < 90; y += 16) rect(l, 6, y, 54, 9, "#2b3040");
    for (const [x, y, r] of [[30, 58, 18], [14, 70, 13], [48, 72, 14], [30, 80, 12]]) disc(l, x, y, r, "#24432f", Math.round(r * 0.8));
    for (const [x, y, r] of [[26, 52, 9], [44, 64, 7]]) disc(l, x, y, r, "#2f5a3c", Math.round(r * 0.8));
    rect(l, 28, 86, 4, 40, "#2b2a30");
    rect(l, 52, 34, 3, 92, "#3a3f4a");
    rect(l, 46, 30, 15, 3, "#3a3f4a");
    // the main building: facade, upper windows, AC units and a pipe
    rect(l, 66, 16, 198, 110, "#5a606f");
    rect(l, 66, 16, 198, 2, "#6c7282");
    for (const [x, y] of UPPER) rect(l, x, y, 16, 14, "#2b3040");
    for (const [x, y] of [[100, 42], [192, 66]]) {
      rect(l, x, y, 12, 8, "#c9ccd4");
      for (let k = 0; k < 4; k++) rect(l, x + 2 + k * 2, y + 2, 1, 4, "#8f939e");
    }
    rect(l, 258, 18, 3, 64, "#474c5a");
    // the ramen shop: awning, dark wood front, noren curtain, bench
    for (let x = 66; x < 264; x += 12) {
      rect(l, x, 80, 6, 9, "#e08a3c");
      rect(l, x + 6, 80, 6, 9, "#f4e6d0");
    }
    for (let x = 66; x < 264; x += 6) rect(l, x, 89, 4, 2, x % 12 === 6 ? "#f4e6d0" : "#e08a3c");
    rect(l, 66, 91, 198, 35, "#3a2a24");
    rect(l, 180, 92, 52, 15, "#1d2a4a");
    for (let x = 192; x < 232; x += 13) rect(l, x, 92, 1, 15, "#0f182e");
    const men = kanjiGlyph(cp(0x9eba), 10, "#f4f0e8"); // 麺
    l.drawImage(men.c, 206 - Math.round(men.w / 2), 94);
    bench(l, 120, 116, 58);
    rect(l, 120, 116, 58, 3, "#9a6a46");
    rect(l, 120, 119, 58, 1, "#6e4a30");
    for (const x of [124, 172]) rect(l, x, 120, 3, 8, "#2b2a30");
    // the building on the right, with vending machines
    rect(l, 264, 24, 56, 102, "#525868");
    for (let y = 32; y < 80; y += 18) rect(l, 270, y, 44, 10, "#2b3040");
    // pavement, kerb and road with a crossing
    rect(l, 0, 126, SW, 10, "#7d7a84");
    for (let x = 0; x < SW; x += 16) rect(l, x, 126, 1, 10, "#6e6b75");
    rect(l, 0, 136, SW, 3, "#a19ea8");
    rect(l, 0, 139, SW, 21, "#2a2b33");
    for (let x = 6; x < 150; x += 20) rect(l, x, 146, 12, 12, "#c9cad0");
    // a traffic cone
    paint(l, ["..o..", "..o..", ".oww.", ".ooo.", "owwwo", "ooooo"], 104, 120, { o: "#e8643c", w: "#f4f0e8" });
    nightTint(land, s, 0.6);
    return [sky, land];
  }

  // The ramen street's lights: windows, shop, lanterns, vending machines, the lamp and a neon sign.
  function tokyoLights(ctx, t, s) {
    const night = s.dark > 0.3;
    if (night) {
      for (const [i, [x, w, h]] of TOWERS.entries()) {
        for (let y = 104 - h; y < 96; y += 5) for (let k = 2; k < w - 2; k += 4) if (hash(i * 97 + y * 13 + k) > 0.62) px(ctx, x + k, y, "#ffe39a");
      }
      for (const [i, [x, y]] of UPPER.entries()) {
        if (hash(i + 40) > 0.4) {
          rect(ctx, x, y, 16, 14, "#ffd98a");
          rect(ctx, x + 7, y, 2, 14, "#c9a060");
        }
      }
    }
    // the shop window: warm light, a counter, bowls, steam
    rect(ctx, 92, 95, 84, 21, "#ffcf8a");
    rect(ctx, 92, 109, 84, 3, "#7a4a2a");
    for (const x of [102, 124, 146]) {
      rect(ctx, x, 106, 8, 3, "#f4f0e8");
      rect(ctx, x + 1, 109, 6, 1, "#c8323c");
      const rise = (t + x) % 12;
      if (rise < 9) px(ctx, x + 3 + (rise % 3 === 0 ? 1 : 0), 104 - rise, "#fff8ec");
    }
    for (const x of [92, 133, 175]) rect(ctx, x, 95, 1, 21, "#5a3a24");
    // a red lantern with ラーメン down it, and a round paper one
    rect(ctx, 240, 88, 12, 30, "#e8433a");
    rect(ctx, 240, 88, 12, 2, "#2b2a30");
    rect(ctx, 240, 116, 12, 2, "#2b2a30");
    [0x30e9, 0x4e28, 0x30e1, 0x30f3].forEach((code, i) => {
      const k = kanjiGlyph(cp(code), 7, "#fff6e0");
      ctx.drawImage(k.c, 246 - Math.round(k.w / 2), 89 + i * 7);
    });
    disc(ctx, 80, 99, 6, "#fff3e0", 7);
    rect(ctx, 74, 98, 13, 3, "#e0484d");
    // vending machines
    for (const [x, c] of [[270, "#d8343c"], [294, "#2e6ad8"]]) {
      rect(ctx, x, 90, 22, 36, c);
      rect(ctx, x + 2, 93, 18, 16, "#f4f6f8");
      for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) rect(ctx, x + 3 + k * 4 - (k === 4 ? 1 : 0), 94 + r * 5, 2, 3, ["#3fae5a", "#f2a65a", "#5b8cff", "#e0484d", "#f2d04a"][(k + r) % 5]);
      rect(ctx, x + 4, 116, 14, 5, "#1f2028");
    }
    // the street lamp
    rect(ctx, 47, 33, 13, 3, "#fff6d0");
    // neon: RAMEN, with the odd flicker
    const on = t % 53 !== 0 && t % 53 !== 2;
    rect(ctx, 134, 58, 50, 11, "#1a1626");
    text(ctx, "RAMEN", 159 - Math.floor(textWidth("RAMEN") / 2), 61, on ? "#ff7ab8" : "#6a3a58");
    // warm light on the pavement
    if (night) {
      ctx.globalAlpha = 0.2 * s.dark;
      rect(ctx, 80, 126, 110, 10, "#ffcf8a");
      rect(ctx, 266, 126, 54, 10, "#e8f0ff");
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Akihabara: towers, signs, an elevated railway and an arcade (full 320×200) ----------
  const SKYLINE = [];
  for (let x = -6, n = 0; x < SW; n++) {
    const w = 16 + Math.floor(hash(n * 9 + 2) * 22);
    SKYLINE.push([x, w, 40 + Math.floor(hash(n * 4 + 5) * 60)]);
    x += w + 1;
  }
  const AKIBA_WINDOWS = []; // lit at night: [x, y]
  for (const [x0, x1, y0, y1] of [[80, 136, 104, 176], [144, 210, 98, 140], [216, 258, 46, 140]]) {
    for (let y = y0; y < y1; y += 7) for (let x = x0; x < x1; x += 6) AKIBA_WINDOWS.push([x, y]);
  }

  function akibaLayers(s) {
    const sky = layer(), g = sky.getContext("2d");
    bands(g, s.top, s.bottom, 0, 170, 8);
    stars(g, 0, 0, SW, 0, 80, s.dark * (1 - s.rain));
    celestial(g, s, 0, SW, 0, 70);

    const back = layer(), b = back.getContext("2d");
    // hazy skyline
    for (const [x, w, h] of SKYLINE) {
      const c = mix("#6c5a68", s.bottom, 0.45);
      rect(b, x, 150 - h, w, h, c);
      for (let y = 154 - h; y < 150; y += 5) rect(b, x + 2, y, w - 4, 1, mix(c, "#ffffff", 0.08));
    }
    // a glass tower on the right, a banded tower beside it
    rect(b, 262, 6, 58, 170, "#3c4a58");
    for (let y = 10; y < 170; y += 4) for (let x = 265; x < 320; x += 4) rect(b, x, y, 2, 2, "#4f6072");
    rect(b, 262, 6, 2, 170, "#566a80");
    rect(b, 216, 40, 44, 136, "#8a7470");
    for (let y = 44; y < 176; y += 7) rect(b, 216, y, 44, 2, "#76625e");
    // the department store on the left, and the blocks between
    rect(b, 0, 16, 78, 160, "#7a5e52");
    for (let x = 4; x < 78; x += 10) rect(b, x, 20, 1, 156, "#6a5046");
    rect(b, 0, 16, 78, 3, "#8e7064");
    rect(b, 78, 98, 62, 78, "#a0867a");
    rect(b, 140, 92, 74, 84, "#8e6e60");
    for (const [x, y] of AKIBA_WINDOWS) rect(b, x, y, 4, 4, "#4a3a3a");
    // rooftop billboard frame and its legs
    for (const x of [156, 196]) rect(b, x, 86, 2, 8, "#3a3036");
    rect(b, 148, 58, 60, 28, "#3a3036");
    // the elevated railway: overhead line poles, the deck, arches below
    for (let x = 10; x < SW; x += 62) {
      rect(b, x, 112, 2, 26, "#2e282c");
      rect(b, x - 4, 114, 10, 1, "#2e282c");
    }
    for (let x = 0; x < SW; x++) px(b, x, 116 + Math.round(2 * Math.sin(((x % 62) / 62) * Math.PI)), "#221e22");
    rect(b, 0, 138, SW, 7, "#3a3236");
    rect(b, 0, 138, SW, 1, "#5a4e52");
    rect(b, 0, 145, SW, 31, "#2e282c");
    for (let x = 6; x < SW; x += 40) {
      rect(b, x, 154, 28, 22, "#1a1618");
      disc(b, x + 14, 154, 14, "#1a1618", 6);
    }
    nightTint(back, s, 0.5);

    const front = layer(), f = front.getContext("2d");
    // the arcade building, in front of the railway
    rect(f, 222, 84, 98, 92, "#b84a3a");
    for (let y = 92; y < 176; y += 8) rect(f, 222, y, 98, 1, "#9c3c30");
    for (let x = 226; x < 320; x += 12) rect(f, x, 84, 1, 92, "#9c3c30");
    rect(f, 238, 104, 66, 40, "#1e1a22"); // the screen's frame
    // the street below, and the footbridge railing in front
    rect(f, 0, 176, SW, 24, "#2c2a30");
    rect(f, 0, 176, SW, 3, "#4a4652");
    for (let x = 210; x < 310; x += 12) rect(f, x, 184, 7, 8, "#c9cad0");
    rect(f, 0, 168, SW, 2, "#8e8a96");
    for (let x = 4; x < SW; x += 12) rect(f, x, 170, 2, 18, "#6e6a78");
    rect(f, 0, 178, SW, 1, "#6e6a78");
    rect(f, 0, 188, SW, 12, "#5a5662");
    rect(f, 0, 188, SW, 1, "#7a7684");
    // a bench on the bridge
    bench(f, 132, 180, 56);
    rect(f, 132, 180, 56, 3, "#9a6a46");
    rect(f, 132, 180, 56, 1, "#b88a60");
    for (const x of [136, 182]) rect(f, x, 183, 2, 5, "#4a4450");
    nightTint(front, s, 0.5);
    return [sky, back, front];
  }

  // An orange-striped train along the viaduct, every so often.
  function viaductTrain(ctx, tf, s) {
    const x0 = Math.round(SW + 30 - ((tf * 5) % 1400));
    if (x0 > SW || x0 < -300) return;
    const night = s.dark > 0.3;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * 66;
      rect(ctx, x, 120, 64, 18, "#c9ccd4");
      rect(ctx, x, 120, 64, 1, "#e4e6ea");
      rect(ctx, x, 131, 64, 3, "#f08a2a");
      for (let k = 4; k < 60; k += 9) rect(ctx, x + k, 123, 6, 6, night ? "#ffe9a8" : "#3a4a5a");
      rect(ctx, x, 136, 64, 2, "#5d6066");
    }
    rect(ctx, x0 - 3, 122, 3, 14, "#c9ccd4");
    rect(ctx, x0 - 3, 124, 2, 5, night ? "#fff6c0" : "#3a4a5a");
  }

  // Signs on the buildings behind the railway, and windows at night.
  function akibaBack(ctx, t, s) {
    if (s.dark > 0.3) for (const [i, [x, y]] of AKIBA_WINDOWS.entries()) if (hash(i + 7) > 0.45) rect(ctx, x, y, 4, 4, "#ffd98a");
    // department store: the KORI sign up top, a duty-free banner down its side
    rect(ctx, 6, 22, 66, 18, "#24394a");
    text(ctx, "KORI", 28, 26, "#ffffff");
    foxMark(ctx, 14, 26);
    text(ctx, "DEPT", 28, 33, "#f08a2a");
    rect(ctx, 6, 48, 14, 76, "#fbf8f4");
    [0x514d, 0x7a0e].forEach((code, i) => { // 免税, down the banner
      const k = kanjiGlyph(cp(code), 9, "#c8323c");
      ctx.drawImage(k.c, 13 - Math.round(k.w / 2), 51 + i * 10);
    });
    ["T", "A", "X", "F", "R", "E", "E"].forEach((ch, i) => text(ctx, ch, 12, 70 + i * 7, "#2d4f8a"));
    // karaoke box sign, a book shop sign, a game banner
    rect(ctx, 82, 62, 56, 22, "#c8323c");
    rect(ctx, 84, 64, 52, 18, "#fbf8f4");
    const kara = kanjiGlyph(cp(0x30ab, 0x30e9, 0x30aa, 0x30b1), 11, "#c8323c"); // カラオケ
    ctx.drawImage(kara.c, 110 - Math.round(kara.w / 2), 66);
    rect(ctx, 86, 88, 48, 16, "#ffd84a");
    text(ctx, "BOOKS", 110 - Math.floor(textWidth("BOOKS") / 2), 91, "#2d4f8a");
    text(ctx, "100Y", 110 - Math.floor(textWidth("100Y") / 2), 98, "#c8323c");
    rect(ctx, 198, 96, 12, 40, "#f08a2a");
    [0x30b2, 0x30fc, 0x30e0].forEach((code, i) => { // ゲーム, down the banner
      const k = kanjiGlyph(cp(code === 0x30fc ? 0x4e28 : code), 8, "#ffffff");
      ctx.drawImage(k.c, 204 - Math.round(k.w / 2), 99 + i * 11);
    });
    // the rooftop billboard: two cans of a drink
    rect(ctx, 150, 60, 56, 24, "#f4f0e0");
    for (const [x, c] of [[160, "#e0484d"], [182, "#3f8fd8"]]) {
      rect(ctx, x, 63, 12, 18, c);
      rect(ctx, x, 63, 12, 2, "#d8d8dc");
      rect(ctx, x + 2, 69, 8, 6, "#ffffff");
    }
    text(ctx, "COLD", 196 - textWidth("COLD"), 76, "#2d4f8a");
  }

  // The arcade's bulbs, sign and screen (a little fox running), and traffic below.
  function akibaFront(ctx, t, tf, s) {
    rect(ctx, 226, 88, 90, 13, "#e0484d");
    text(ctx, "KORI GAMES", 271 - Math.floor(textWidth("KORI GAMES") / 2), 92, "#ffffff");
    for (let x = 224; x < 320; x += 6) {
      const on = (x / 6 + Math.floor(t / 3)) % 2 === 0;
      px(ctx, x, 86, on ? "#fff3b0" : "#9a6a3a");
      px(ctx, x + 3, 102, on ? "#9a6a3a" : "#fff3b0");
    }
    // the screen: sky, scrolling hills, a fox bounding along
    rect(ctx, 240, 106, 62, 36, "#7ec8f0");
    for (let x = 240; x < 302; x++) rect(ctx, x, 130 - Math.round(5 * noise((x + tf * 2) / 9)), 1, 12 + Math.round(5 * noise((x + tf * 2) / 9)), "#3fae5a");
    const hop = Math.abs(Math.sin(tf / 3)) * 6;
    foxMark(ctx, 262, Math.round(118 - hop));
    for (let k = 0; k < 3; k++) px(ctx, 296 - ((Math.floor(tf * 2) + k * 20) % 56), 112 + k * 4, "#ffffff");
    text(ctx, "AKIHABARA", 271 - Math.floor(textWidth("AKIHABARA") / 2), 148, "#ffffff");
    const akiba = kanjiGlyph(cp(0x79cb, 0x8449, 0x539f), 12, "#fbf8f4"); // 秋葉原
    ctx.drawImage(akiba.c, 271 - Math.round(akiba.w / 2), 155);
    // a van crossing the street now and then
    const vx = Math.round(((tf * 3) % 700) - 60);
    if (vx < SW) {
      rect(ctx, vx, 176, 26, 9, "#e8e6e0");
      rect(ctx, vx + 18, 177, 6, 4, "#3a4a5a");
      rect(ctx, vx + 24, 180, 2, 2, s.dark > 0.3 ? "#fff6c0" : "#d8d8dc");
    }
  }

  // ---------- Rural Japan: a lane under a big tree, a tram, an old shop (full 320×200) ----------
  // Countryside houses: [x, width, roof top, floors].
  const HOUSES = [[-8, 56, 58, 2], [50, 70, 40, 2], [124, 40, 76, 1]];
  // Their shoji windows: [x, y, w, h].
  const houseWindows = ([x, w, top, floors]) => {
    const out = [];
    const rows = floors === 2 ? [top + 18, top + 46] : [top + 20];
    for (const y of rows) for (let k = x + 7; k + 12 <= x + w - 4; k += 18) out.push([k, y, 12, 12]);
    return out;
  };
  function house(g, hs) {
    const [x, w, top, floors] = hs, wall = top + 12, ground = 150;
    rect(g, x, wall, w, ground - wall, "#e9e3d6");
    for (let k = x; k < x + w; k += 18) rect(g, k, wall, 2, ground - wall, "#5a4636");
    rect(g, x + w - 2, wall, 2, ground - wall, "#5a4636");
    rect(g, x, wall, w, 2, "#5a4636");
    if (floors === 2) {
      // a little tiled eave between the floors
      const mid = wall + 28;
      rect(g, x - 4, mid - 4, w + 8, 3, "#4c5160");
      rect(g, x - 4, mid - 1, w + 8, 1, "#2e313b");
    }
    for (const [wx, wy, ww, wh] of houseWindows(hs)) {
      rect(g, wx - 1, wy - 1, ww + 2, wh + 2, "#5a4636");
      rect(g, wx, wy, ww, wh, "#f1ead8");
      for (let k = wx + 3; k < wx + ww; k += 4) rect(g, k, wy, 1, wh, "#a8977e");
      rect(g, wx, wy + Math.floor(wh / 2), ww, 1, "#a8977e");
    }
    // hipped tile roof: a short ridge widening to overhanging eaves
    for (let r = 0; r < 12; r++) {
      const inset = Math.round((11 - r) * 1.3);
      rect(g, x - 6 + inset, top + r, w + 12 - inset * 2, 1, r % 3 === 2 ? "#3a3e4a" : "#4c5160");
    }
    rect(g, x - 6 + 14, top - 1, Math.max(4, w + 12 - 28), 2, "#2e313b");
    rect(g, x - 7, top + 12, w + 14, 1, "#2e313b");
  }

  function inakaLayers(s) {
    const sky = layer(), g = sky.getContext("2d");
    bands(g, s.top, s.bottom, 0, 150, 7);
    stars(g, 0, 0, SW, 0, 70, s.dark * (1 - s.rain));
    celestial(g, s, 0, SW, 0, 60);

    const back = layer(), b = back.getContext("2d");
    // hills, then houses with tiled gable roofs
    const hill = mix("#5f8a62", s.bottom, 0.35);
    for (let x = 0; x < SW; x++) {
      const h = Math.round(20 * noise(x / 34 + 2) + 8 * noise(x / 9));
      rect(b, x, 104 - h, 1, h + 40, hill);
    }
    for (const h of HOUSES) house(b, h);
    // the utility pole with its vertical signs, and wires
    rect(b, 22, 0, 6, 170, "#6e6a64");
    rect(b, 23, 0, 1, 170, "#86827c");
    rect(b, 12, 14, 26, 3, "#5a5650");
    for (const [y0, sag] of [[16, 8], [22, 9]]) for (let x = 28; x < SW; x++) px(b, x, y0 + Math.round(sag * Math.sin(((x - 28) / 300) * Math.PI)), "#3a3834");
    rect(b, 12, 40, 10, 44, "#fbf8f4");
    rect(b, 28, 56, 10, 34, "#fbf8f4");
    [0x7530, 0x4ee3].forEach((code, i) => { // 田代
      const k = kanjiGlyph(cp(code), 8, "#22252c");
      b.drawImage(k.c, 17 - Math.round(k.w / 2), 44 + i * 12);
    });
    const rent = kanjiGlyph(cp(0x8cb8), 8, "#c8323c"); // 貸
    b.drawImage(rent.c, 33 - Math.round(rent.w / 2), 60);
    // the tram's track
    rect(b, 0, 146, SW, 6, "#6a645e");
    rect(b, 0, 146, SW, 1, "#a8a29a");
    nightTint(back, s, 0.5);

    const front = layer(), f = front.getContext("2d");
    // a white guardrail along the track
    rect(f, 0, 138, 210, 3, "#eef0f2");
    rect(f, 0, 143, 210, 2, "#d0d4d8");
    for (let x = 4; x < 210; x += 22) rect(f, x, 138, 3, 18, "#c8ccd2");
    // the big tree
    rect(f, 198, 70, 10, 100, "#4a3a2c");
    rect(f, 200, 70, 2, 100, "#5e4a38");
    for (const [x, y, r, c] of [
      [150, 30, 30, "#2f6a3c"], [200, 12, 34, "#2f6a3c"], [250, 34, 30, "#2f6a3c"], [176, 62, 28, "#2a5e36"], [230, 70, 26, "#2a5e36"],
      [160, 22, 18, "#3f8a4a"], [206, 2, 20, "#3f8a4a"], [244, 22, 16, "#3f8a4a"], [186, 48, 14, "#4e9c58"], [222, 40, 12, "#4e9c58"],
    ]) disc(f, x, y, r, c, Math.round(r * 0.8));
    for (let i = 0; i < 70; i++) px(f, 130 + Math.floor(hash(i) * 150), Math.floor(hash(i + 50) * 90), "#6cba6a");
    // the old shop on the right: planks, eaves, posters, an air conditioner
    rect(f, 252, 26, 68, 150, "#4a3a30");
    for (let x = 254; x < 320; x += 5) rect(f, x, 30, 1, 146, "#3e3028");
    rect(f, 246, 24, 74, 6, "#2e2a30");
    rect(f, 262, 40, 22, 34, "#fbf8f4");
    rect(f, 263, 41, 20, 10, "#c8323c");
    text(f, "MART", 273 - Math.floor(textWidth("MART") / 2), 44, "#ffffff");
    for (const [x, y, c] of [[290, 50, "#ffd84a"], [292, 86, "#9fd2ff"], [264, 90, "#f392b2"]]) {
      rect(f, x, y, 18, 24, "#fbf8f4");
      rect(f, x + 2, y + 2, 14, 12, c);
      rect(f, x + 3, y + 16, 12, 1, "#8a8494");
      rect(f, x + 3, y + 19, 9, 1, "#8a8494");
    }
    rect(f, 290, 150, 26, 20, "#d0d2d6");
    for (let y = 153; y < 168; y += 3) rect(f, 292, y, 22, 1, "#a8aab0");
    // the temple marker stone: 狐坂寺, with an arrow
    rect(f, 214, 104, 16, 70, "#e8e6e0");
    rect(f, 214, 104, 16, 2, "#f6f4f0");
    rect(f, 228, 106, 2, 68, "#c8c6c0");
    [0x72d0, 0x5742, 0x5bfa].forEach((code, i) => {
      const k = kanjiGlyph(cp(code), 10, "#22252c");
      f.drawImage(k.c, 222 - Math.round(k.w / 2), 110 + i * 14);
    });
    rect(f, 216, 154, 12, 1, "#c8323c");
    paint(f, ["..o", "ooo", "..o"], 226, 153, { o: "#c8323c" });
    // shrubs, grass and the lane with a puddle
    for (const [x, y, r] of [[240, 166, 14], [262, 170, 12], [6, 168, 12], [44, 172, 10], [312, 166, 10]]) disc(f, x, y, r, "#356e40", Math.round(r * 0.7));
    rect(f, 0, 172, SW, 28, "#6d6a70");
    rect(f, 0, 172, SW, 1, "#8a8690");
    for (let x = 0; x < SW; x += 7) rect(f, x, 170, 1, 3, "#4e9c58");
    disc(f, 70, 190, 22, mix(s.bottom, "#6d6a70", 0.35), 3);
    // a bus-stop bench
    bench(f, 100, 178, 56);
    rect(f, 100, 178, 56, 3, "#9a6a46");
    rect(f, 100, 178, 56, 1, "#b88a60");
    for (const x of [104, 150]) rect(f, x, 181, 2, 9, "#4a4450");
    rect(f, 96, 150, 2, 40, "#8e939e");
    disc(f, 97, 148, 5, "#2e6ad8");
    nightTint(front, s, 0.5);
    return [sky, back, front];
  }

  // A pastel tram rolling along now and then, behind the tree and the rail.
  function tram(ctx, tf, s) {
    const x = Math.round(((tf * 1.6) % 800) - 120);
    if (x > SW) return;
    const night = s.dark > 0.3;
    rect(ctx, x, 104, 96, 42, "#f4d6e0");
    rect(ctx, x, 128, 96, 18, "#bfe3c4");
    rect(ctx, x, 104, 96, 2, "#fbeef2");
    for (let k = 14; k < 92; k += 13) rect(ctx, x + k, 112, 9, 12, night ? "#ffe9a8" : "#3a4a5a");
    rect(ctx, x + 88, 110, 8, 16, night ? "#ffe9a8" : "#5a6a7a");
    rect(ctx, x + 2, 110, 8, 30, "#9fd6a8");
    rect(ctx, x + 3, 112, 6, 12, night ? "#ffe9a8" : "#3a4a5a");
    rect(ctx, x + 40, 98, 16, 6, "#5d6066");
    rect(ctx, x + 47, 84, 1, 14, "#3a3834");
    rect(ctx, x + 94, 134, 2, 2, night ? "#fff6c0" : "#f4e7a0");
    text(ctx, "1203", x + 60, 132, "#3a4a5a");
  }

  // Warm windows in the houses and the shop once it's dark.
  function inakaLights(ctx, t, s) {
    if (s.dark <= 0.3) return;
    for (const h of HOUSES) {
      for (const [wx, wy, ww, wh] of houseWindows(h)) {
        if (hash(wx + wy) < 0.35) continue;
        rect(ctx, wx, wy, ww, wh, "#ffd98a");
        for (let k = wx + 3; k < wx + ww; k += 4) rect(ctx, k, wy, 1, wh, "#c9a060");
        rect(ctx, wx, wy + Math.floor(wh / 2), ww, 1, "#c9a060");
      }
    }
    ctx.globalAlpha = 0.5;
    rect(ctx, 262, 40, 22, 34, "#ffe9b0");
    ctx.globalAlpha = 1;
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

  // Productive, she travels: a new place every TRAVEL ms of unbroken productive time, so staying
  // on task takes her somewhere new. Each session starts at the lake. [seat x, seat top, feet when
  // standing, where she walks in from, what she holds]
  const PLACES = [
    { key: "lake", kanji: cp(0x6e56), name: "LAKE", x: 172, seat: DOCK_TOP, feet: DOCK_TOP, from: 112, hold: "rod" },
    { key: "inaka", kanji: cp(0x7530, 0x820e), name: "INAKA", x: 128, seat: 178, feet: 190, from: 66, hold: "book" },
    { key: "fuji", kanji: cp(0x5bcc, 0x58eb), name: "FUJI", x: 225, seat: 178, feet: 190, from: 168, hold: "book" },
    { key: "tokyo", kanji: cp(0x6771, 0x4eac), name: "TOKYO", x: 150, seat: 116, feet: 130, from: 88, hold: "book" },
    { key: "akiba", kanji: cp(0x79cb, 0x8449, 0x539f), name: "AKIBA", x: 160, seat: 180, feet: 190, from: 100, hold: "book" },
  ];
  // Scenes drawn for the whole 320×200 frame (the rest sit at its bottom).
  const FULL = new Set(["fuji", "akiba", "inaka"]);
  const TRAVEL = 10 * 60000, WALK_IN = 5000;

  // Where she is and where she's headed, top left while she travels.
  function placeTag(ctx, i, left) {
    const here = PLACES[i], next = PLACES[(i + 1) % PLACES.length];
    const k = kanjiGlyph(here.kanji, 9, "#ffffff");
    // `left` is null when she's set to stay put: just the name, no next stop.
    const after = left === null ? "" : `NEXT ${next.name} ${Math.max(1, Math.ceil(left / 60000))}M`;
    const w = 6 + k.w + 4 + textWidth(here.name) + (after ? 8 + textWidth(after) : 0) + 6;
    ctx.globalAlpha = 0.7;
    rect(ctx, 6, 6, w, 13, "#0a0812");
    ctx.globalAlpha = 1;
    ctx.drawImage(k.c, 11, 7);
    let x = 11 + k.w + 4;
    text(ctx, here.name, x, 10, "#ffffff");
    x += textWidth(here.name) + 8;
    if (after) text(ctx, after, x, 10, "#a9a3c4");
  }

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
    head = [cx, feetY - anims[name].ground + 6];
    const img = f.anims[name]?.[i];
    if (!img) return;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(feetY - anims[name].ground));
    if (faceRight) ctx.scale(-1, 1);
    ctx.drawImage(img, -FW / 2, 0);
    ctx.restore();
  }

  let head = [160, 80]; // top of her head in scene coordinates, for the thought bubble
  function drawFacing(ctx, img, cx, feetY, faceRight) {
    head = [cx, feetY - 58];
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
    head = [cx, top + 4];
    const sx = (x) => cx + FW / 2 - x, sy = (y) => top + y;
    // legs first so the hakama hem overlaps them; each swings opposite the other
    const SWING = [0, 1, 2, 1, 0, -1, -2, -1];
    LEGS.forEach(([x, w], i) => {
      const leg = f.legs[i];
      if (!leg) return;
      const sw = hold === "rod" ? SWING[(Math.floor(t / 2) + i * 4) % 8] : 0;
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
    head = [124, 64];
    const img = f.shut;
    if (!img) return;
    ctx.save();
    ctx.translate(100 + 48, 62);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 8, 0, 48, 34, 0, 0, 48, 34);
    ctx.restore();
  }

  // Fills the rows above a 160-row scene by continuing its top row upward; stars go in the sky.
  function extendTop(ctx, src, oy, s, sky) {
    if (!oy) return;
    ctx.drawImage(src, 0, 0, SW, 1, 0, -oy, SW, oy);
    if (sky) {
      ctx.save();
      ctx.translate(0, -oy);
      stars(ctx, t, 0, SW, 0, oy, s.dark * (1 - s.rain));
      ctx.restore();
    }
  }
  // Hanging ads in the train, in the space above the window.
  function hangingAds(ctx, oy, tf) {
    const y0 = -oy;
    rect(ctx, 0, y0 + 5, SW, 1, "#9aa2ab");
    const sway = Math.round(Math.sin(tf / 7));
    const ads = [
      [24, ["#ffe7c2", "#e8643c", "#2d4f8a"], "TRAVEL"],
      [128, ["#e8f4ff", "#3f8fd8", "#e0484d"], "SALE"],
      [232, ["#fff0f6", "#f392b2", "#3fae5a"], "MANGA"],
    ];
    for (const [x, [bg, a, b], word] of ads) {
      const ax = x + sway;
      rect(ctx, x + 6, y0 + 6, 1, 4, "#9aa2ab");
      rect(ctx, x + 58, y0 + 6, 1, 4, "#9aa2ab");
      rect(ctx, ax, y0 + 10, 64, 26, "#c9ccd4");
      rect(ctx, ax + 1, y0 + 11, 62, 24, bg);
      rect(ctx, ax + 3, y0 + 13, 22, 20, a);
      disc(ctx, ax + 14, y0 + 21, 5, b);
      rect(ctx, ax + 3, y0 + 28, 22, 5, mix(a, "#000000", 0.25));
      text(ctx, word, ax + 29, y0 + 15, b);
      rect(ctx, ax + 29, y0 + 23, 30, 1, mix(bg, "#000000", 0.25));
      rect(ctx, ax + 29, y0 + 26, 24, 1, mix(bg, "#000000", 0.25));
      rect(ctx, ax + 29, y0 + 29, 28, 1, mix(bg, "#000000", 0.25));
    }
  }

  // ---------- engine ----------
  const canvases = new Map();
  // place: "cycle" travels, or a PLACES key stays put. commute: "cycle", "station" or "train".
  let state = { mood: "idle", weather: "auto", sky: "auto", place: "cycle", commute: "cycle", character: {} };
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
        : scene === "fuji" ? fujiLayers(s)
        : scene === "tokyo" ? tokyoLayers(s)
        : scene === "akiba" ? akibaLayers(s)
        : scene === "inaka" ? inakaLayers(s)
        : lakeLayers(s);
      bg.key = key;
    }
    return bg.layers;
  }

  let lastStation = 0, routeStart = 0; // where she last got off; where the next commute starts
  let lastPlace = 0; // where her last productive stretch took her
  let shownScene = "", sceneAt = 0; // for the fade whenever the scene changes
  const idx = (i) => ((i % ROUTE.length) + ROUTE.length) % ROUTE.length;

  function drawScene(canvas) {
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
    const commute = state.commute || "cycle";
    // The commute alternates platform and train; set to one, she stays there (trains still come
    // and go at the station; the stops still go by on the train).
    const leg = !riding || commute === "station" ? 0 : Math.floor(since / (commute === "train" ? RIDE : LEG));
    const p = !riding || commute === "station" ? since % WAIT : commute === "train" ? WAIT + (since % RIDE) : since % LEG;
    const stop = riding ? routeStart + leg : lastStation;
    if (riding) lastStation = idx(stop + (p >= WAIT ? 1 : 0));
    const travelling = state.mood === "productive";
    const fixed = PLACES.findIndex((pl) => pl.key === state.place); // -1: travel between them
    const placeI = fixed >= 0 ? fixed : travelling ? Math.floor(since / TRAVEL) % PLACES.length : lastPlace;
    const at_ = fixed >= 0 ? since : since % TRAVEL;
    if (travelling) lastPlace = placeI;
    const spot = PLACES[placeI];
    const scene = place === "wasted" ? (p < WAIT ? `station-${idx(stop)}` : "train") : place === "break" ? "bedroom" : spot.key;
    const city = scene === "fuji" || scene === "tokyo" || scene === "akiba" || scene === "inaka";
    const indoors = scene === "bedroom", station = scene.startsWith("station");
    // Commuting, she steps off, waits and boards; kept at the station she just waits on the bench.
    const where = riding && station ? (commute === "cycle" ? onPlatform(p) : { sit: true }) : null;
    const napAnim = state.mood === "break" && !!f.anims["to-bed"];
    const outfit = state.character.outfit || "#e1262b";
    const breath = state.mood === "break" ? Math.floor(t / 8) % 2 : 0;
    const oy = FULL.has(scene) ? 0 : OY;
    ctx.save();
    ctx.translate(0, oy);

    if (indoors) {
      const room = background(scene, s)[0];
      ctx.drawImage(room, 0, 0);
      extendTop(ctx, room, oy, s, false);
      // the ceiling's edge
      ctx.globalAlpha = 0.35;
      rect(ctx, 0, -oy, SW, 4, "#000000");
      ctx.globalAlpha = 1;
      rect(ctx, 0, -oy + 4, SW, 1, "#00000033");
      if (napAnim || idle) blanket(ctx, outfit, 0, true); // a made bed (she naps on top of the covers)
    } else if (scene === "train") {
      const [outside, car] = background(scene, s);
      ctx.drawImage(outside, 0, 0);
      passing(ctx, tf, s, rain, snow);
      ctx.drawImage(car, 0, 0);
      extendTop(ctx, car, oy, s, false);
      hangingAds(ctx, oy, tf);
      straps(ctx, tf);
      nextStop(ctx, t, stop, p);
    } else if (station) {
      const [far, plat] = background(scene, s);
      ctx.drawImage(far, 0, 0);
      extendTop(ctx, far, oy, s, true);
      clouds(ctx, tf, s);
      // the train she came on pulls out; later the next one pulls in and opens its doors
      if (p < GONE) farTrain(ctx, TRAIN_STOP - 480 * Math.max(0, (p - LEAVE) / (GONE - LEAVE)) ** 2, service(stop - 1)[1], p < DOWN, s);
      else if (p >= ARRIVE) farTrain(ctx, TRAIN_STOP + 480 * (1 - Math.min(1, (p - ARRIVE) / (DOORS - ARRIVE))) ** 2, service(stop)[1], p >= DOORS && p < SHUT, s);
      if (where?.door) walker(ctx, t, f, where); // in the doorway, behind the platform
      ctx.drawImage(plat, 0, 0);
      if (!s.rain) petals(ctx, tf);
    } else if (city) {
      const [skyLayer, land, front] = background(scene, s);
      ctx.drawImage(skyLayer, 0, 0);
      extendTop(ctx, skyLayer, oy, s, true);
      clouds(ctx, tf, s);
      ctx.drawImage(land, 0, 0);
      if (scene === "akiba") {
        akibaBack(ctx, t, s);
        viaductTrain(ctx, tf, s);
        ctx.drawImage(front, 0, 0);
        akibaFront(ctx, t, tf, s);
      } else if (scene === "inaka") {
        tram(ctx, tf, s);
        ctx.drawImage(front, 0, 0);
        inakaLights(ctx, t, s);
      } else (scene === "fuji" ? fujiLights : tokyoLights)(ctx, t, s);
    } else {
      const [skyLayer, land] = background(scene, s);
      ctx.drawImage(skyLayer, 0, 0);
      extendTop(ctx, skyLayer, oy, s, true);
      clouds(ctx, tf, s);
      ctx.drawImage(land, 0, 0);
      lakeLife(ctx, t, tf, s);
    }

    let zz = null;
    if (travelling) {
      // she walks in to her spot, then sits down to fish or study
      if (at_ < WALK_IN) drawFacing(ctx, f.frames[t % FRAMES], spot.from + ((spot.x - spot.from) * at_) / WALK_IN, spot.feet, true);
      else sitting(ctx, t, f, spot.hold, spot.x, spot.seat);
    } else if (napAnim) zz = napping(ctx, t, f, since);
    else if (state.mood === "break") lying(ctx, f);
    else if (scene === "train") sitting(ctx, t, f, "phone", SEATS[1] + 22, SEAT_TOP + (t % 24 === 0 ? 1 : 0)); // the odd bump on the rails
    else if (where?.sit) sitting(ctx, t, f, "phone", BENCH_X, 110);
    else if (where && !where.door) walker(ctx, t, f, where);
    else if (station && !riding) strolling(ctx, t, tf, f, PLATFORM_FEET);
    else if (indoors) strolling(ctx, t, tf, f, 140);
    else if (!station) strolling(ctx, t, tf, f, spot.feet);

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
        ctx.fillRect(0, -oy, SW, SH);
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
    } else if (station) {
      if (s.dark > 0.01) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = mix("#ffffff", "#2c3570", s.dark * 0.5);
        ctx.fillRect(0, -oy, SW, SH);
        ctx.globalCompositeOperation = "source-over";
      }
      stationLights(ctx, t, stop, p);
    }
    if (state.mood === "break" && (zz || !napAnim)) zzz(ctx, t, ...(zz || [148, 62]));
    ctx.restore();
    // where her head is, for the thought bubble laid over the canvas
    const hx = Math.round(head[0]), hy = Math.round(head[1] + oy), wrap = canvas.parentElement;
    if (wrap && (wrap.dataset.hx !== `${hx}` || wrap.dataset.hy !== `${hy}`)) {
      wrap.dataset.hx = hx;
      wrap.dataset.hy = hy;
      wrap.style.setProperty("--hx", hx);
      wrap.style.setProperty("--hy", hy);
    }

    // Weather falls through the whole frame, splashing on the ground of each place.
    if (!indoors && scene !== "train") {
      const ground = { fuji: PAVE, akiba: 176, inaka: 172, tokyo: 126 + oy }[scene] ?? (station ? PLATFORM + oy : HORIZON + 4 + oy);
      if (rain) rainfall(ctx, tf, s, ground);
      if (snow) snowfall(ctx, tf, s);
    }
    if (travelling) placeTag(ctx, placeI, fixed >= 0 ? null : TRAVEL - at_);
    // Every change of scene fades in from dark, so cuts never jump.
    if (scene !== shownScene) {
      shownScene = scene;
      sceneAt = clock;
    }
    const fade = 1 - (clock - sceneAt) / 500;
    if (fade > 0) {
      ctx.globalAlpha = fade;
      rect(ctx, 0, 0, SW, SH, "#05040a");
      ctx.globalAlpha = 1;
    }
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

  // Slanted rain: each drop drifts left as it falls, its streak trailing up and to the right
  // behind it, and splashes somewhere between `ground` and the bottom of the frame.
  function rainfall(ctx, t, s, ground) {
    const col = mix("#dce8ff", "#7c88b8", s.dark);
    ctx.fillStyle = col;
    for (let i = 0; i < 120; i++) {
      const speed = 10 + (i % 5);
      const land = ground + ((i * 53) % Math.max(1, SH - ground));
      const cycle = land + 30;
      const y = ((i * 37 + Math.floor(t * speed)) % cycle) - 30;
      const x = ((i * 71) % (SW + 70)) - 10 - y * 0.3;
      if (y < land) {
        ctx.globalAlpha = 0.3 + (i % 3) * 0.12;
        const len = 4 + (i % 4);
        for (let k = 0; k < len; k++) ctx.fillRect(Math.round(x + k * 0.3), Math.round(y - k), 1, 1);
      } else if (y < land + 6) {
        ctx.globalAlpha = 0.45;
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

  // Each canvas (the Track scene, the Settings preview) keeps its own state and timeline; draw()
  // swaps one in, draws, and swaps it back out.
  const views = new Map();
  function view(id) {
    if (!views.has(id)) {
      views.set(id, { state: { ...state }, moodAt: clock, lastStation: 0, routeStart: 0, lastPlace: 0, shownScene: "", sceneAt: 0 });
    }
    return views.get(id);
  }
  function draw(canvas) {
    const v = view(canvas.id);
    ({ state, moodAt, lastStation, routeStart, lastPlace, shownScene, sceneAt } = v);
    drawScene(canvas);
    Object.assign(v, { state, moodAt, lastStation, routeStart, lastPlace, shownScene, sceneAt });
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    // Hidden in the tray, or (unless set to animate in the background) another window has
    // focus: hold the frame and the clock, so nothing is missed and no CPU is spent.
    const background = [...views.values()].some((v) => v.state.background);
    const paused = document.hidden || (!background && !document.hasFocus());
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
    update(next, id) {
      const v = view(id);
      if (next.mood && next.mood !== v.state.mood) {
        v.moodAt = clock; // restart the transition animations
        if (next.mood === "wasted") v.routeStart = v.lastStation; // the commute carries on from where she got off
      }
      v.state = { ...v.state, ...next, character: next.character ?? v.state.character };
      const canvas = canvases.get(id);
      if (canvas) draw(canvas);
    },
  };
})();

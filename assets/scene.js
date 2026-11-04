// Pixel-art companion: the character sprite sheet (assets/character.png, 8 walk frames of
// 64×64) acting out what you're doing. Backgrounds are drawn in code at 160×80 and doubled,
// the sprite is drawn at full detail on top.
//
// Moods: idle (strolling on the dock), productive (fishing or reading), wasted (in bed,
// doomscrolling), break (asleep). The outdoor sky follows the local time of day.
window.koritsuScene = (() => {
  const W = 160, H = 80, S = 2, FPS = 8; // background resolution and its upscale
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
    hair: { base: "#fdd777", colors: ["#fdd777", "#c58146", "#974e1a"] }, // hair, ears and tail fur
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

  // Recoloured frames (plus a closed-eyes copy of frame 0 and a sitting pose), rebuilt when
  // the colours change.
  const cache = { key: null, frames: [], shut: null, sit: null, legs: [], hand: [12, 40] };

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

  function gradient(ctx, top, bottom, y0, y1, x0 = 0, x1 = W) {
    for (let y = y0; y < y1; y++) {
      ctx.fillStyle = mix(top, bottom, (y - y0) / Math.max(1, y1 - y0 - 1));
      ctx.fillRect(x0, y, x1 - x0, 1);
    }
  }

  const STARS = [[9, 5], [27, 13], [44, 4], [66, 10], [83, 3], [101, 15], [119, 7], [138, 12], [151, 4], [35, 22], [127, 20], [74, 24], [12, 30]];
  function stars(ctx, t, x0, x1, y0, y1, alpha = 1) {
    ctx.globalAlpha = alpha;
    for (const [x, y] of STARS) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      ctx.fillStyle = (x * 7 + t) % 23 < 2 ? "#6b6f9c" : "#e8e6ff";
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // Sun by day and moon by night, each on an arc across the sky. Hidden by rain clouds.
  function celestial(ctx, s, x0 = 0, x1 = W, y0 = 0, y1 = 44) {
    if (s.rain) return;
    const arc = (u) => [x0 + 4 + u * (x1 - x0 - 12), y1 - 4 - Math.sin(u * Math.PI) * (y1 - y0 - 10)];
    const h = s.hour;
    if (h >= 5.5 && h <= 19) {
      const [x, y] = arc((h - 5.5) / 13.5);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#fff3b0";
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 9, 9);
      ctx.globalAlpha = 1;
      paint(ctx, [".ooo.", "ooooo", "ooOoo", "ooooo", ".ooo."], Math.round(x), Math.round(y), { o: "#ffe27a", O: "#fff6c8" });
    }
    if (h >= 18.5 || h <= 6.5) {
      const [x, y] = arc(((h - 18.5 + 24) % 24) / 12);
      paint(ctx, [".ooo.", "owwwo", "owgwo", "owwwo", ".ooo."], Math.round(x), Math.round(y), MOON);
    }
  }

  const MOON = { o: "#d9d4b8", w: "#fff8d6", g: "#ece4c0" };
  function outdoors(ctx, t, s) {
    gradient(ctx, s.top, s.bottom, 0, 52);
    // clouds: white by day, fading at night; low grey ones when it rains
    const drift = Math.floor(t / 12);
    const puffs = s.rain
      ? [[0, 6, 40], [30, 2, 46], [70, 8, 38], [104, 3, 44], [140, 7, 34], [-20, 12, 30], [50, 14, 36], [120, 15, 40]]
      : [[14, 9, 20], [78, 4, 14], [118, 14, 24]];
    const light = s.rain ? mix("#9aa3b2", "#2a3040", s.dark) : mix("#ffffff", "#3a4070", s.dark);
    const shade = s.rain ? mix("#7a8392", "#1c2030", s.dark) : mix("#dbeefc", "#2a3060", s.dark);
    for (const [cx, cy, cw] of puffs) {
      const x = ((cx + drift) % (W + 40) + W + 40) % (W + 40) - 28;
      ctx.globalAlpha = s.rain ? 0.95 : 0.9 * (1 - 0.6 * s.dark);
      ctx.fillStyle = light;
      ctx.fillRect(x, cy, cw, 3);
      ctx.fillRect(x + 3, cy - 2, cw - 8, 2);
      ctx.fillStyle = shade;
      ctx.fillRect(x + 1, cy + 3, cw - 2, 1);
      ctx.globalAlpha = 1;
    }
    // far hills, two layers
    for (const [base, amp, col, f] of [[46, 5, "#7bbf7a", 13], [49, 3, "#4f9a5a", 7]]) {
      ctx.fillStyle = col;
      for (let x = 0; x < W; x++) {
        const h = amp + Math.round(amp * 0.6 * Math.sin(x / f) + Math.sin(x / 3.7));
        ctx.fillRect(x, base - h, 1, h + 6);
      }
    }
    // water with drifting highlights
    gradient(ctx, s.rain ? "#5a8ab0" : "#4aa3df", s.rain ? "#356289" : "#2a74bd", 52, H);
    ctx.fillStyle = s.rain ? "#9cc0dc" : "#bfe6ff";
    for (let i = 0; i < 14; i++) {
      const x = ((i * 29 + Math.floor(t / 2) * (i % 2 ? 1 : -1)) % (W + 12) + W + 12) % (W + 12) - 6;
      ctx.fillRect(x, 55 + ((i * 7) % 24), 4 + (i % 4), 1);
    }
    // grassy bank on the left
    ctx.fillStyle = "#8a5a3c";
    ctx.fillRect(0, 50, 42, H - 50);
    ctx.fillStyle = "#6e4630";
    for (let y = 54; y < H; y += 5) for (let x = (y % 10) / 2; x < 42; x += 7) ctx.fillRect(x, y, 4, 2);
    ctx.fillStyle = "#5cc45a";
    ctx.fillRect(0, 47, 43, 4);
    ctx.fillStyle = "#8be07c";
    for (let x = 1; x < 42; x += 3) ctx.fillRect(x, 46, 1, 1 + (x % 2));
    // dock
    ctx.fillStyle = "#c98a52";
    ctx.fillRect(40, 51, 58, 3);
    ctx.fillStyle = "#e0a46a";
    ctx.fillRect(40, 51, 58, 1);
    ctx.fillStyle = "#8c5a32";
    for (let x = 46; x < 98; x += 8) ctx.fillRect(x, 51, 1, 3);
    for (const px of [48, 70, 92]) {
      ctx.fillStyle = "#8c5a32";
      ctx.fillRect(px, 54, 3, 16);
      ctx.fillStyle = "#6e4426";
      ctx.fillRect(px + 2, 54, 1, 16);
    }
  }

  function bedroom(ctx, t, s) {
    ctx.fillStyle = "#2c2542";
    ctx.fillRect(0, 0, W, 60);
    ctx.fillStyle = "#251f38";
    for (let x = 0; x < W; x += 10) ctx.fillRect(x, 0, 1, 60);
    // window with the night sky
    ctx.fillStyle = "#1b1528";
    ctx.fillRect(12, 8, 36, 28);
    gradient(ctx, s.top, s.bottom, 9, 35, 13, 47);
    stars(ctx, t, 13, 47, 9, 35, s.dark * (1 - s.rain));
    celestial(ctx, s, 13, 47, 9, 35);
    ctx.fillStyle = "#1b1528";
    ctx.fillRect(29, 8, 2, 28);
    ctx.fillRect(12, 21, 36, 2);
    ctx.fillStyle = "#6b5a8e";
    ctx.fillRect(10, 36, 40, 2); // sill
    // shelf with a plant and books
    ctx.fillStyle = "#6e4630";
    ctx.fillRect(116, 18, 34, 3);
    paint(ctx, ["..gg..", ".gggg.", "gggggg", "..gg..", ".pppp.", ".pppp.", "..pp.."], 120, 11, { g: "#5cc45a", p: "#c96b4a" });
    paint(ctx, ["bb", "bb", "bb", "bb"], 134, 14, { b: "#5b8cff" });
    paint(ctx, ["rr", "rr", "rr", "rr"], 137, 14, { r: "#e8833a" });
    paint(ctx, ["yy", "yy", "yy"], 140, 15, { y: "#e8c84a" });
    // floor
    ctx.fillStyle = "#4e3528";
    ctx.fillRect(0, 60, W, H - 60);
    ctx.fillStyle = "#402a20";
    for (let x = 0; x < W; x += 14) ctx.fillRect(x, 60, 1, H - 60);
    ctx.fillStyle = "#5e4232";
    ctx.fillRect(0, 60, W, 1);
  }

  // Bed frame, mattress and pillow: behind the head. Blanket: in front, over the body.
  function bedBack(ctx) {
    ctx.fillStyle = "#6e4630";
    ctx.fillRect(48, 30, 5, 38); // headboard
    ctx.fillStyle = "#8a5a3c";
    ctx.fillRect(49, 30, 3, 1);
    ctx.fillStyle = "#6e4630";
    ctx.fillRect(148, 46, 4, 22); // footboard
    ctx.fillStyle = "#ece6f4";
    ctx.fillRect(53, 54, 95, 8); // mattress
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(53, 42, 26, 12); // pillow
    ctx.fillStyle = "#d8d0e6";
    ctx.fillRect(53, 52, 26, 2);
    ctx.fillRect(78, 43, 1, 10);
  }

  function blanket(ctx, outfit, breath) {
    const top = 47 - breath;
    const base = mix(outfit, "#6b7fd6", 0.55);
    ctx.fillStyle = base;
    ctx.fillRect(53, top, 95, 62 - top);
    ctx.fillRect(92, top - 3, 36, 3); // hip and knee hump
    ctx.fillRect(97, top - 4, 24, 1);
    ctx.fillStyle = mix(base, "#ffffff", 0.35);
    ctx.fillRect(53, top, 95, 2); // folded-over edge
    ctx.fillRect(97, top - 4, 24, 1);
    ctx.fillStyle = mix(base, "#1a1030", 0.3);
    ctx.fillRect(53, top + 2, 95, 1);
    for (let x = 62; x < 148; x += 12) ctx.fillRect(x, top + 4, 1, 62 - top - 4);
    ctx.fillStyle = "#3b2f3f";
    ctx.fillRect(53, 62, 95, 4);
  }

  // ---------- scenes (full-resolution coordinates: 320×160) ----------
  function line(ctx, x0, y0, x1, y1, color) {
    ctx.fillStyle = color;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
  }

  const DOCK_TOP = 51 * S;

  // Idle: strolls along the dock, pausing at each end.
  function strolling(ctx, t, f) {
    const P = 240, p = t % P, a = 104, b = 176;
    let x = a, flip = true, walking = false;
    if (p < 60) x = a;
    else if (p < 120) { x = a + ((b - a) * (p - 60)) / 60; walking = true; }
    else if (p < 180) { x = b; flip = false; }
    else { x = b - ((b - a) * (p - 180)) / 60; walking = true; flip = false; }
    const img = walking ? f.frames[t % FRAMES] : p % 48 === 47 ? f.shut : f.frames[0];
    // Sprite faces left as drawn; flip to face right.
    drawFacing(ctx, img, x, DOCK_TOP, flip);
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
  let state = { mood: "idle", productive: "fishing", weather: "auto", character: {} };
  let t = 0;
  const back = document.createElement("canvas"), front = document.createElement("canvas"), skyfx = document.createElement("canvas");
  back.width = front.width = skyfx.width = W;
  back.height = front.height = skyfx.height = H;

  function draw(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W * S, H * S);
    const f = frames(state.character);
    const b = back.getContext("2d"), fr = front.getContext("2d");
    b.clearRect(0, 0, W, H);
    fr.clearRect(0, 0, W, H);
    const now = new Date();
    const rain = rainAt(state.weather, now);
    const s = sky(now.getHours() + now.getMinutes() / 60, rain);
    const indoors = state.mood === "wasted" || state.mood === "break";
    if (indoors) {
      bedroom(b, t, s);
      bedBack(b);
      blanket(fr, state.character.outfit || "#e1262b", state.mood === "break" ? Math.floor(t / 8) % 2 : 0);
    } else {
      outdoors(b, t, s);
    }
    ctx.drawImage(back, 0, 0, W * S, H * S);
    if (state.mood === "productive") sitting(ctx, t, f, state.productive === "reading" ? "book" : "rod");
    else if (indoors) lying(ctx, t, f, state.mood === "break" ? "sleep" : "phone");
    else strolling(ctx, t, f);
    ctx.drawImage(front, 0, 0, W * S, H * S);
    if (indoors) {
      if (rain) windowRain(ctx, t);
    } else {
      // Night dims the whole picture evenly; the stars, sun and moon go on top so they shine.
      if (s.dark > 0.01) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = mix("#ffffff", "#2c3570", s.dark * 0.6);
        ctx.fillRect(0, 0, W * S, H * S);
        ctx.globalCompositeOperation = "source-over";
      }
      const fx = skyfx.getContext("2d");
      fx.clearRect(0, 0, W, H);
      stars(fx, t, 0, W, 0, 40, s.dark * (1 - s.rain));
      fx.save();
      fx.beginPath();
      fx.rect(0, 0, W, 40); // behind the hills
      fx.clip();
      celestial(fx, s);
      fx.restore();
      ctx.drawImage(skyfx, 0, 0, W * S, H * S);
      if (rain) rainfall(ctx, t, s);
    }
    if (state.mood === "wasted") phone(ctx, t);
    if (state.mood === "break") zzz(ctx, t);
  }

  // Slanted streaks falling across the whole scene, with rings where drops hit the water.
  function rainfall(ctx, t, s) {
    const col = mix("#dce8ff", "#7c88b8", s.dark);
    for (let i = 0; i < 90; i++) {
      const speed = 9 + (i % 4);
      const land = 108 + ((i * 53) % 52); // where this drop hits the water or dock
      const cycle = land + 20;
      const y = ((i * 37 + t * speed) % cycle) - 20;
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
      const y = 18 + ((i * 19 + t * (3 + (i % 3))) % 52);
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

  function zzz(ctx, t) {
    for (let i = 0; i < 3; i++) {
      const p = (t + i * 10) % 30;
      const zx = 148 + i * 12 + Math.floor(p / 3), zy = 62 - p;
      ctx.globalAlpha = 1 - p / 30;
      paint(ctx, ["oooooo", "....o.", "...o..", "..o...", ".o....", "oooooo"], zx, zy, { o: "#e8e6ff" });
      ctx.globalAlpha = 1;
    }
  }

  function redrawAll() {
    for (const c of canvases.values()) draw(c);
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  setInterval(() => {
    for (const [id, canvas] of canvases) {
      if (!canvas.isConnected) {
        canvases.delete(id);
        continue;
      }
      draw(canvas);
    }
    if (!reduced.matches) t++;
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
      state = { ...state, ...next, character: next.character ?? state.character };
      redrawAll();
    },
  };
})();

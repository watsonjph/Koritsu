// Synthesized sounds (Web Audio), so there are no audio files to ship.
// A "thock" is a creamy mechanical key: a low, fast-damped body tone plus a soft
// low-passed noise click, then a quieter echo for the key's release.
window.koritsu = (() => {
  let ctx;
  const ac = () => {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };

  function out(c, vol) {
    const g = c.createGain();
    g.gain.value = vol;
    g.connect(c.destination);
    return g;
  }

  function body(c, dest, t, freq, peak, decay, bend = 1.7) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * bend, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.025);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  function noise(c, dest, t, cutoff, peak, len) {
    const n = Math.floor(len * c.sampleRate);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 5;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = "lowpass";
    f.frequency.value = cutoff;
    f.Q.value = 0.8;
    g.gain.value = peak;
    src.connect(f).connect(g).connect(dest);
    src.start(t);
  }

  // Switch characters. pitch: body tone multiplier · decay: how long the body rings ·
  // cutoff/click: brightness and loudness of the contact noise · release: up-stroke level.
  // len: contact-noise length in seconds.
  const profiles = {
    creamy: { pitch: 1, decay: 0.11, cutoff: 1800, click: 0.5, release: 0.25, len: 0.035 },
    // Lubed, foam-dampened board: smoother and rounder than creamy, almost no rattle.
    buttery: { pitch: 0.85, decay: 0.13, cutoff: 1250, click: 0.3, release: 0.16, len: 0.04 },
    // Heavy, deep bottom-out: low body that rings longer.
    thocky: { pitch: 0.58, decay: 0.19, cutoff: 900, click: 0.42, release: 0.2, len: 0.045 },
    marble: { pitch: 0.75, decay: 0.17, cutoff: 1100, click: 0.35, release: 0.3, len: 0.035 },
    // Short and bright with a clean, tight click.
    crisp: { pitch: 1.35, decay: 0.045, cutoff: 7500, click: 0.85, release: 0.4, len: 0.018 },
    clacky: { pitch: 1.7, decay: 0.05, cutoff: 6000, click: 0.95, release: 0.55, len: 0.035 },
    topre: { pitch: 0.9, decay: 0.08, cutoff: 800, click: 0.18, release: 0.08, len: 0.035 },
  };

  function thock(vol, pitch, profile) {
    const p = profiles[profile] ?? profiles.creamy;
    const c = ac(), dest = out(c, vol), t = c.currentTime, f = pitch * p.pitch;
    body(c, dest, t, f, 0.9, p.decay);
    noise(c, dest, t, p.cutoff, p.click, p.len);
    // release: higher, softer, ~80ms later
    body(c, dest, t + 0.08, f * 1.35, p.release, 0.06);
    noise(c, dest, t + 0.08, p.cutoff * 1.4, p.click * 0.3, 0.02);
  }

  // A soft bubble: a sine that glides up and fades.
  function pop(vol, pitch) {
    const c = ac(), dest = out(c, vol), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(pitch * 2, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 5, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.1);
  }

  // Close-mic'd and soft: a breathy band of noise that swells in, a faint low tap under it,
  // then a tiny crinkle as the key returns.
  function asmr(vol, pitch) {
    const c = ac(), dest = out(c, vol), t = c.currentTime;
    const n = Math.floor(0.16 * c.sampleRate);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.min(1, x * 14) * (1 - x) ** 3;
    }
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = "bandpass";
    f.frequency.value = 3200;
    f.Q.value = 1.1;
    g.gain.value = 0.55;
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    body(c, dest, t + 0.005, pitch * 0.7, 0.28, 0.1);
    noise(c, dest, t + 0.07, 5200, 0.12, 0.012);
  }

  const key = (pitch, scale = 1) => (v, profile) =>
    profile === "pop" ? pop(v * scale, pitch)
      : profile === "asmr" ? asmr(v * scale, pitch)
      : thock(v * scale, pitch, profile);

  const sounds = {
    productive: key(190),
    wasted: key(150),
    stop: key(115),
    break: key(130),
    click: key(210, 0.6),
    tick: (v) => {
      const c = ac(), dest = out(c, v * 0.18), t = c.currentTime;
      body(c, dest, t, 1400, 0.6, 0.03, 1);
      noise(c, dest, t, 4000, 0.3, 0.01);
    },
    chime: (v) => {
      const c = ac(), dest = out(c, v * 0.5), t = c.currentTime;
      [659.25, 987.77].forEach((f, i) => body(c, dest, t + i * 0.16, f, 0.5, 0.9, 1));
    },
  };

  // A soft sine "note" with an optional quieter overtone; used to build the alerts below.
  function note(c, dest, t, f, peak, decay, type = "sine") {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // Phase-end alerts: longer and more musical than button clicks, so they're noticed.
  const alerts = {
    chime: (c, d, t) => [659.25, 987.77].forEach((f, i) => note(c, d, t + i * 0.16, f, 0.5, 0.9)),
    // Inharmonic partials make it read as struck metal.
    bell: (c, d, t) => [[880, 0.5, 1.8], [880 * 2.76, 0.18, 1.1], [880 * 5.4, 0.08, 0.6]].forEach(([f, p, dec]) => note(c, d, t, f, p, dec)),
    kalimba: (c, d, t) => [1046.5, 1318.5, 1568].forEach((f, i) => {
      note(c, d, t + i * 0.11, f, 0.45, 0.5, "triangle");
      note(c, d, t + i * 0.11, f * 4, 0.05, 0.08);
    }),
    marimba: (c, d, t) => [784, 587.33, 784].forEach((f, i) => {
      note(c, d, t + i * 0.14, f, 0.55, 0.35);
      note(c, d, t + i * 0.14, f * 4, 0.08, 0.06);
    }),
    // 8-bit "level up" to match the pixel character.
    arcade: (c, d, t) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(c, d, t + i * 0.07, f, 0.18, 0.12, "square")),
    gong: (c, d, t) => [[110, 0.6, 2.6], [110 * 1.48, 0.25, 2.0], [110 * 2.3, 0.15, 1.4], [110 * 3.9, 0.06, 0.9]].forEach(([f, p, dec]) => note(c, d, t, f, p, dec)),
  };

  return {
    alert(name, vol, profile) {
      try {
        if (name === "thock") {
          thock(vol, 160, profile);
          setTimeout(() => thock(vol, 200, profile), 140);
          return;
        }
        const c = ac(), dest = out(c, vol), t = c.currentTime;
        alerts[name]?.(c, dest, t);
      } catch (e) { console.warn("koritsu alert", e); }
    },
    play(name, vol, profile) {
      try { sounds[name]?.(vol, profile); } catch (e) { console.warn("koritsu sound", e); }
    },
  };
})();

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
  const profiles = {
    creamy: { pitch: 1, decay: 0.11, cutoff: 1800, click: 0.5, release: 0.25 },
    marble: { pitch: 0.75, decay: 0.17, cutoff: 1100, click: 0.35, release: 0.3 },
    clacky: { pitch: 1.7, decay: 0.05, cutoff: 6000, click: 0.95, release: 0.55 },
    topre: { pitch: 0.9, decay: 0.08, cutoff: 800, click: 0.18, release: 0.08 },
  };

  function thock(vol, pitch, profile) {
    const p = profiles[profile] ?? profiles.creamy;
    const c = ac(), dest = out(c, vol), t = c.currentTime, f = pitch * p.pitch;
    body(c, dest, t, f, 0.9, p.decay);
    noise(c, dest, t, p.cutoff, p.click, 0.035);
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

  const key = (pitch, scale = 1) => (v, profile) =>
    profile === "pop" ? pop(v * scale, pitch) : thock(v * scale, pitch, profile);

  const sounds = {
    productive: key(190),
    wasted: key(150),
    stop: key(115),
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

  return {
    play(name, vol, profile) {
      try { sounds[name]?.(vol, profile); } catch (e) { console.warn("koritsu sound", e); }
    },
  };
})();

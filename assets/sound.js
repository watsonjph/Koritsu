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

  function thock(vol, pitch) {
    const c = ac(), dest = out(c, vol), t = c.currentTime;
    body(c, dest, t, pitch, 0.9, 0.11);
    noise(c, dest, t, 1800, 0.5, 0.035);
    // release: higher, softer, ~80ms later
    body(c, dest, t + 0.08, pitch * 1.35, 0.25, 0.06);
    noise(c, dest, t + 0.08, 2600, 0.15, 0.02);
  }

  const sounds = {
    productive: (v) => thock(v, 190),
    wasted: (v) => thock(v, 150),
    stop: (v) => thock(v, 115),
    click: (v) => thock(v * 0.6, 210),
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
    play(name, vol) {
      try { sounds[name]?.(vol); } catch (e) { console.warn("koritsu sound", e); }
    },
  };
})();

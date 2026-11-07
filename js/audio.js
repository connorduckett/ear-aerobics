/* Ear Aerobics — playback engine.
 * Plays N sample-aligned loops at once and crossfades between them, so A/B
 * switching is instant, click-free and keeps the musical position. */
window.EA = window.EA || {};

EA.audio = (() => {
  let ctx = null;
  let master = null;
  let voices = [];
  let bufs = [];
  let active = 0;
  let playing = false;
  let startAt = 0;
  let volume = 0.6;
  const subs = new Set();

  try {
    const v = parseFloat(localStorage.getItem('earAerobics.volume'));
    if (!isNaN(v)) volume = v;
  } catch (e) { /* storage unavailable */ }

  const emit = () => subs.forEach((f) => f());

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume * volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setVolume(v) {
    volume = v;
    try { localStorage.setItem('earAerobics.volume', String(v)); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02);
  }

  function ramp(param, to, dur) {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(to, t + dur);
  }

  function killVoices() {
    if (!ctx) return;
    const t = ctx.currentTime;
    voices.forEach(({ s, g }) => {
      ramp(g.gain, 0, 0.03);
      try { s.stop(t + 0.05); } catch (e) { /* already stopped */ }
    });
    voices = [];
  }

  function startVoices(offset) {
    const t = ctx.currentTime + 0.04;
    const dur = bufs[0].duration;
    offset = offset % dur;
    voices = bufs.map((b, i) => {
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(i === active ? 1 : 0, t + 0.03);
      s.connect(g);
      g.connect(master);
      s.start(t, offset % b.duration);
      return { s, g };
    });
    startAt = t - offset;
  }

  const position = () => (ctx ? Math.max(0, ctx.currentTime - startAt) : 0);

  function play() {
    if (!bufs.length) return;
    ensure();
    killVoices();
    startVoices(0);
    playing = true;
    emit();
  }

  function stop() {
    killVoices();
    playing = false;
    emit();
  }

  const toggle = () => (playing ? stop() : play());

  /** Swap the loaded buffers. Keeps playing (and the loop position) if already playing. */
  function setBuffers(list, opts = {}) {
    const pos = playing ? position() : 0;
    bufs = list;
    if (typeof opts.active === 'number') active = opts.active;
    if (active >= list.length) active = 0;
    if (playing && list.length) {
      killVoices();
      startVoices(opts.restart ? 0 : pos);
    }
    emit();
  }

  function select(i) {
    if (i < 0 || i >= bufs.length) return;
    active = i;
    if (playing && ctx) voices.forEach((v, j) => ramp(v.g.gain, j === i ? 1 : 0, 0.015));
    emit();
  }

  function clear() {
    stop();
    bufs = [];
    active = 0;
  }

  // ---- answer sound effects -------------------------------------------------
  let sfxOn = true;
  try { sfxOn = localStorage.getItem('earAerobics.sfx') !== 'off'; } catch (e) { /* ignore */ }

  function setSfx(on) {
    sfxOn = on;
    try { localStorage.setItem('earAerobics.sfx', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  function tone(out, t, { freq, type = 'sine', amp, dur, attack = 0.004, glideTo, filter }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 'good' = bright two-note ding, 'bad' = dull low thud. */
  function sfx(kind) {
    if (!sfxOn) return;
    ensure();
    const t = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(master);
    if (kind === 'good') {
      [[1568, 0], [2093, 0.1]].forEach(([f, dt]) => {
        tone(out, t + dt, { freq: f, amp: 0.22, dur: 0.75 });
        tone(out, t + dt, { freq: f * 2.76, amp: 0.05, dur: 0.25 }); // bell partial
      });
    } else {
      tone(out, t, { freq: 155, type: 'square', amp: 0.2, dur: 0.18, glideTo: 120, filter: 500 });
      tone(out, t + 0.17, { freq: 110, type: 'square', amp: 0.2, dur: 0.32, glideTo: 85, filter: 420 });
    }
  }

  return {
    ensure, play, stop, toggle, select, setBuffers, clear, setVolume, sfx, setSfx,
    get sfxOn() { return sfxOn; },
    get ctx() { return ctx; },
    get master() { return master; },
    get volume() { return volume; },
    get playing() { return playing; },
    get active() { return active; },
    get count() { return bufs.length; },
    onChange(f) { subs.add(f); return () => subs.delete(f); },
  };
})();

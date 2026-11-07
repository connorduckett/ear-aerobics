/* Ear Aerobics — practice audio.
 * Everything is synthesized in the browser (no copyrighted audio is shipped),
 * plus users can load their own song. All sources are loudness-normalized so
 * compressor thresholds behave consistently. */
window.EA = window.EA || {};

EA.sources = (() => {
  const { dsp } = EA;
  const SR = 44100;
  const STEP = 60 / 120 / 4; // 16th note at 120 BPM
  const LOOP = STEP * 64; // 4 bars = 8 s
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const list = [
    { id: 'mix', name: 'Full mix' },
    { id: 'drums', name: 'Drums' },
    { id: 'keys', name: 'Bass & keys' },
    { id: 'vocal', name: 'Vocal' },
    { id: 'pink', name: 'Pink noise' },
    { id: 'user', name: 'Your audio' },
  ];

  const cache = new Map();
  let userName = null;

  function noiseBuffer(c, secs) {
    const b = c.createBuffer(1, Math.floor(secs * c.sampleRate), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function envGain(c, t, peakV, dur, attack = 0.002) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peakV, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  function panner(c, pan) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  function hitNoise(c, out, noise, t, o) {
    const s = c.createBufferSource();
    s.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 0.7;
    const g = envGain(c, t, o.gain, o.dur);
    s.connect(f).connect(g).connect(panner(c, o.pan || 0)).connect(out);
    s.start(t, Math.random() * 1.0);
    s.stop(t + o.dur + 0.05);
  }

  function kick(c, out, noise, t, v = 1) {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const g = envGain(c, t, 0.95 * v, 0.55, 0.003);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    hitNoise(c, out, noise, t, { type: 'bandpass', freq: 4000, q: 0.8, gain: 0.2 * v, dur: 0.015 });
  }

  function snare(c, out, noise, t, v = 1) {
    hitNoise(c, out, noise, t, { type: 'bandpass', freq: 2200, q: 0.6, gain: 0.6 * v, dur: 0.22, pan: -0.05 });
    hitNoise(c, out, noise, t, { type: 'highpass', freq: 6000, gain: 0.22 * v, dur: 0.12, pan: -0.05 });
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.1);
    const g = envGain(c, t, 0.45 * v, 0.13);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.15);
  }

  function hat(c, out, noise, t, v = 1, open = false) {
    hitNoise(c, out, noise, t, { type: 'highpass', freq: 7500, gain: (open ? 0.16 : 0.2) * v, dur: open ? 0.32 : 0.05, pan: 0.3 });
  }

  function scheduleDrums(c, out, noise) {
    for (let bar = 0; bar < 4; bar++) {
      const base = bar * 16;
      const at = (step) => (base + step) * STEP;
      const kicks = bar % 2 === 0 ? [0, 6, 8] : [0, 8, 10, 14];
      kicks.forEach((s) => kick(c, out, noise, at(s)));
      [4, 12].forEach((s) => snare(c, out, noise, at(s)));
      if (bar % 2 === 1) snare(c, out, noise, at(15), 0.22);
      for (let s = 0; s < 16; s += 2) {
        if (bar === 3 && s === 14) hat(c, out, noise, at(s), 0.9, true);
        else hat(c, out, noise, at(s), s % 4 === 0 ? 0.9 : 0.6);
      }
      [13, 15].forEach((s) => { if (!(bar === 3 && s === 15)) hat(c, out, noise, at(s), 0.35); });
      // tambourine-ish shimmer on the backbeat, panned left for stereo interest
      [4, 12].forEach((s) => hitNoise(c, out, noise, at(s), { type: 'bandpass', freq: 9000, q: 1.5, gain: 0.12, dur: 0.18, pan: -0.45 }));
    }
  }

  const PROG = [
    { root: 45, chord: [57, 60, 64] }, // Am
    { root: 41, chord: [57, 60, 65] }, // F
    { root: 48, chord: [55, 60, 64] }, // C
    { root: 43, chord: [55, 59, 62] }, // G
  ];

  function scheduleMusic(c, out) {
    PROG.forEach((ch, bar) => {
      const t0 = bar * 16 * STEP;
      const barLen = 16 * STEP;

      // Pad: detuned saws through a soft low-pass
      const padF = c.createBiquadFilter();
      padF.type = 'lowpass';
      padF.frequency.value = 1600;
      padF.Q.value = 0.5;
      padF.connect(out);
      ch.chord.forEach((m, i) => {
        const pan = panner(c, [-0.45, 0, 0.45][i]);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.08);
        g.gain.setValueAtTime(0.05, t0 + barLen - 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + barLen + 0.35);
        g.connect(pan).connect(padF);
        [-7, 7].forEach((cents) => {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = cents;
          o.connect(g);
          o.start(t0);
          o.stop(t0 + barLen + 0.4);
        });
      });

      // Bass: filtered saw with a plucky filter envelope
      [[0, 0, 0.22], [3, 0, 0.2], [6, 0, 0.2], [8, 0, 0.22], [10, 12, 0.2], [14, 0, 0.12]].forEach(([s, oct, dur]) => {
        const t = t0 + s * STEP;
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(ch.root + oct);
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 2;
        f.frequency.setValueAtTime(1300, t);
        f.frequency.exponentialRampToValueAtTime(220, t + 0.18);
        const g = envGain(c, t, 0.32, dur + 0.08, 0.004);
        o.connect(f).connect(g).connect(out);
        o.start(t);
        o.stop(t + dur + 0.1);
      });

      // Pluck arpeggio, alternating left/right
      [0, 1, 2, 1, 0, 2, 1, 2].forEach((idx, k) => {
        const t = t0 + k * 2 * STEP;
        const o = c.createOscillator();
        o.type = 'square';
        o.frequency.value = mtof(ch.chord[idx] + 12);
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(3200, t);
        f.frequency.exponentialRampToValueAtTime(700, t + 0.2);
        const g = envGain(c, t, 0.07, 0.28, 0.003);
        o.connect(f).connect(g).connect(panner(c, k % 2 ? 0.35 : -0.35)).connect(out);
        o.start(t);
        o.stop(t + 0.3);
      });

      // Bell on the downbeat for top-end content
      const bt = t0;
      const bell = c.createOscillator();
      bell.type = 'sine';
      bell.frequency.value = mtof(ch.chord[2] + 24);
      const bg = envGain(c, bt, 0.05, 1.3, 0.004);
      bell.connect(bg).connect(panner(c, 0.15)).connect(out);
      bell.start(bt);
      bell.stop(bt + 1.35);
    });
  }

  // Formant frequencies (F1, F2, F3) for a few vowels
  const VOWELS = { a: [800, 1150, 2900], e: [450, 1900, 2600], i: [300, 2300, 3000], o: [480, 820, 2800], u: [350, 700, 2500] };
  // Synthetic vocal phrase: b = start beat, d = length in beats, s = sibilant onset, se = sibilant ending
  const PHRASE = [
    { b: 0, d: 0.9, m: 64, v: 'i', s: 1 }, { b: 1, d: 0.9, m: 67, v: 'e' }, { b: 2, d: 0.45, m: 69, v: 'a', s: 1 },
    { b: 2.5, d: 0.45, m: 67, v: 'o' }, { b: 3, d: 1.5, m: 64, v: 'a', se: 1 },
    { b: 6, d: 0.9, m: 62, v: 'o', s: 1 }, { b: 7, d: 0.9, m: 64, v: 'i', s: 1 }, { b: 8, d: 0.45, m: 67, v: 'e' },
    { b: 8.5, d: 0.45, m: 69, v: 'a', s: 1 }, { b: 9, d: 1.6, m: 67, v: 'u', se: 1 },
    { b: 12, d: 0.9, m: 64, v: 'e', s: 1 }, { b: 13, d: 1.3, m: 62, v: 'a', s: 1, se: 1 },
  ];

  function scheduleVocal(c, out, noise) {
    const BEAT = STEP * 4;
    const end = LOOP + 1;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = mtof(PHRASE[0].m);
    const vib = c.createOscillator();
    vib.frequency.value = 5.3;
    const vibG = c.createGain();
    vibG.gain.value = 22;
    vib.connect(vibG).connect(osc.detune);
    const env = c.createGain();
    env.gain.value = 0;
    env.connect(panner(c, 0)).connect(out);
    const formants = [0, 1, 2].map((k) => {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = [6, 11, 15][k];
      f.frequency.value = VOWELS.a[k];
      const g = c.createGain();
      g.gain.value = [1.4, 0.9, 0.55][k];
      osc.connect(f).connect(g).connect(env);
      return f;
    });
    PHRASE.forEach((n, idx) => {
      const t = n.b * BEAT;
      const on = t + (n.s ? 0.09 : 0.01);
      const off = t + n.d * BEAT;
      osc.frequency.setTargetAtTime(mtof(n.m), on - 0.01, 0.025);
      formants.forEach((f, k) => f.frequency.setTargetAtTime(VOWELS[n.v][k], on - 0.02, 0.03));
      env.gain.setTargetAtTime(0.55, on, 0.02);
      env.gain.setTargetAtTime(0, off - 0.04, 0.035);
      if (n.s) {
        hitNoise(c, out, noise, t, { type: 'highpass', freq: 4800, gain: 0.45, dur: 0.13 });
        hitNoise(c, out, noise, t, { type: 'bandpass', freq: 7200, q: 2, gain: 0.5, dur: 0.11 });
      }
      if (n.se) {
        hitNoise(c, out, noise, off, { type: 'highpass', freq: 5000, gain: 0.4, dur: 0.16 });
        hitNoise(c, out, noise, off, { type: 'bandpass', freq: 6800, q: 2, gain: 0.45, dur: 0.14 });
      }
      const prev = PHRASE[idx - 1];
      if (!prev || n.b - (prev.b + prev.d) > 1) {
        // breath before a new phrase
        hitNoise(c, out, noise, (t - 0.4 + LOOP) % LOOP, { type: 'bandpass', freq: 1600, q: 0.7, gain: 0.06, dur: 0.32 });
      }
    });
    osc.start(0);
    vib.start(0);
    osc.stop(end);
    vib.stop(end);

    // Low noise floor (hiss + hum) between phrases, so a gate has something to remove
    const hiss = c.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const hf = c.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 7000;
    const hg = c.createGain();
    hg.gain.value = 0.003;
    hiss.connect(hf).connect(hg).connect(out);
    hiss.start(0);
    hiss.stop(end);
    [[60, 0.002], [180, 0.0008]].forEach(([f, a]) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(out);
      o.start(0);
      o.stop(end);
    });
  }

  async function renderLoop({ drums, music, vocal }) {
    const tail = 1.5;
    const len = Math.round(LOOP * SR);
    const off = new OfflineAudioContext(2, len + Math.round(tail * SR), SR);
    const master = off.createGain();
    master.connect(off.destination);
    const noise = noiseBuffer(off, 2);
    if (drums) scheduleDrums(off, master, noise);
    if (music) scheduleMusic(off, master);
    if (vocal) scheduleVocal(off, master, noise);
    const r = await off.startRendering();
    // Fold the decay tail back onto the start so the loop is seamless.
    const out = dsp.mk(2, len, SR);
    for (let c = 0; c < 2; c++) {
      const d = r.getChannelData(c);
      const o = new Float32Array(len);
      o.set(d.subarray(0, len));
      for (let i = len; i < d.length; i++) o[i - len] += d[i];
      out.copyToChannel(o, c);
    }
    return dsp.normalize(out);
  }

  function pinkNoise() {
    const len = Math.round(LOOP * SR);
    const out = dsp.mk(2, len, SR);
    for (let c = 0; c < 2; c++) {
      const d = out.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    }
    return dsp.normalize(out);
  }

  function get(id) {
    if (!cache.has(id)) {
      let p;
      if (id === 'mix') p = renderLoop({ drums: true, music: true });
      else if (id === 'drums') p = renderLoop({ drums: true, music: false });
      else if (id === 'keys') p = renderLoop({ drums: false, music: true });
      else if (id === 'vocal') p = renderLoop({ vocal: true });
      else if (id === 'pink') p = Promise.resolve(pinkNoise());
      else return Promise.reject(new Error('Load an audio file first.'));
      cache.set(id, p);
    }
    return cache.get(id);
  }

  /** Decode a user file, take a ~12 s excerpt (skipping the intro), fade and normalize it. */
  async function setUserFile(file) {
    const ab = await file.arrayBuffer();
    const dec = new OfflineAudioContext(2, SR, SR);
    const buf = await dec.decodeAudioData(ab);
    const maxSecs = 12;
    const startSec = buf.duration > maxSecs ? Math.min(buf.duration * 0.3, buf.duration - maxSecs) : 0;
    const start = Math.floor(startSec * buf.sampleRate);
    const len = Math.min(buf.length - start, Math.floor(maxSecs * buf.sampleRate));
    const ch = Math.min(2, buf.numberOfChannels);
    const out = dsp.mk(ch, len, buf.sampleRate);
    const fade = Math.floor(0.02 * buf.sampleRate);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c).slice(start, start + len);
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        d[i] *= g;
        d[len - 1 - i] *= g;
      }
      out.copyToChannel(d, c);
    }
    dsp.normalize(out);
    cache.set('user', Promise.resolve(out));
    userName = file.name;
    return out;
  }

  function preload() {
    ['mix', 'drums', 'keys', 'vocal', 'pink'].forEach((id) => get(id).catch(() => {}));
  }

  return { list, get, setUserFile, preload, get userName() { return userName; }, hasUser: () => cache.has('user') };
})();

/* Ear Aerobics — real-time plugin DSP for the Sandbox.
 *
 * The processors run in an AudioWorklet. The worklet code is built from the
 * functions below and loaded from a Blob URL, so it also works when the app is
 * opened straight from disk. biquadCoefs() and staticGain() are shared with the
 * UI so the drawn curves always match what you hear.
 */
window.EA = window.EA || {};

/** RBJ cookbook biquad. Returns normalized [b0, b1, b2, a1, a2]. */
function biquadCoefs(type, f, q, gainDb, sr) {
  f = Math.min(Math.max(f, 10), sr * 0.49);
  q = Math.max(q, 0.05);
  if (type === 'hp1' || type === 'lp1') {
    // first-order (6 dB/oct) sections, used to build the strip's 18 dB/oct high-pass
    const K = Math.tan((Math.PI * f) / sr);
    const a1 = (K - 1) / (K + 1);
    return type === 'hp1' ? [1 / (1 + K), -1 / (1 + K), 0, a1, 0] : [K / (1 + K), K / (1 + K), 0, a1, 0];
  }
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'bell') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else if (type === 'lowshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
  } else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  } else if (type === 'lowcut') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'highcut') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'bandpass') {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    return [1, 0, 0, 0, 0];
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Static gain curve (dB, <= 0) for compressor / gate / expander at input level x (dB). */
function staticGain(p, x) {
  if (p.mode === 'gate') return x < p.threshold ? -p.range : 0;
  if (p.mode === 'expand') return x < p.threshold ? Math.max(-p.range, (x - p.threshold) * (p.ratio - 1)) : 0;
  const over = x - p.threshold;
  const knee = p.knee || 0;
  const slope = 1 / p.ratio - 1;
  if (2 * over < -knee) return 0;
  if (knee > 0 && 2 * Math.abs(over) <= knee) return (slope * Math.pow(over + knee / 2, 2)) / (2 * knee);
  return slope * over;
}

/**
 * Filter + EQ coefficients for the channel strip (SSL EV2 style). Always returns
 * three filter slots (18 dB/oct HPF = 1st + 2nd order, 12 dB/oct LPF) and four EQ
 * slots, with unity coefficients for anything switched off.
 */
function stripCoefs(p, sr) {
  const U = [1, 0, 0, 0, 0];
  const on = (g) => p.eqIn && Math.abs(g) > 0.05;
  const hpOn = p.hpf > 21, lpOn = p.lpf < 19500;
  return {
    filt: [
      hpOn ? biquadCoefs('hp1', p.hpf, 0.707, 0, sr) : U,
      hpOn ? biquadCoefs('lowcut', p.hpf, 1, 0, sr) : U,
      lpOn ? biquadCoefs('highcut', p.lpf, 0.707, 0, sr) : U,
    ],
    eq: [
      on(p.lfG) ? biquadCoefs(p.lfBell ? 'bell' : 'lowshelf', p.lfF, p.lfBell ? 0.8 : 0.71, p.lfG, sr) : U,
      on(p.lmfG) ? biquadCoefs('bell', p.lmfF, p.lmfQ, p.lmfG, sr) : U,
      on(p.hmfG) ? biquadCoefs('bell', p.hmfF, p.hmfQ, p.hmfG, sr) : U,
      on(p.hfG) ? biquadCoefs(p.hfBell ? 'bell' : 'highshelf', p.hfF, p.hfBell ? 0.8 : 0.71, p.hfG, sr) : U,
    ],
  };
}

function eaWorkletBody() {
  const dbToLin = (d) => Math.pow(10, d / 20);
  const coef = (ms) => Math.exp(-1 / (Math.max(ms, 0.01) * 0.001 * sampleRate));
  const UNITY = [1, 0, 0, 0, 0];
  const METER_EVERY = 1024;

  class BQ {
    constructor() { this.c = UNITY; this.z = [0, 0, 0, 0]; }
    set(c) { this.c = c; }
    run(x, ch) {
      const c = this.c, z = this.z, i = ch * 2;
      const y = c[0] * x + z[i];
      z[i] = c[1] * x - c[3] * y + z[i + 1];
      z[i + 1] = c[2] * x - c[4] * y;
      return y;
    }
  }

  function chans(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length;
    if (!inp || !inp.length) return { silent: true, out, n };
    return { L: inp[0], R: inp[1] || inp[0], oL: out[0], oR: out[1] || out[0], out, n };
  }

  // ---------------- 6-band parametric / dynamic EQ (Q6 / F6 style) --------
  class EQ extends AudioWorkletProcessor {
    constructor() {
      super();
      this.p = { bypass: false, out: 0, bands: [] };
      this.f = Array.from({ length: 6 }, () => ({ main: new BQ(), sc: new BQ(), env: 0, d: 0, key: '', scKey: '' }));
      this.cnt = 0;
      this.port.onmessage = (e) => { this.p = e.data; };
    }
    process(inputs, outputs) {
      const io = chans(inputs, outputs);
      if (io.silent) { io.out.forEach((o) => o.fill(0)); return true; }
      const { L, R, oL, oR, n } = io;
      const p = this.p, bands = p.bands || [];
      if (p.bypass) {
        oL.set(L); if (oR !== oL) oR.set(R);
        this.f.forEach((F) => { F.d = 0; });
      } else {
        for (let b = 0; b < bands.length; b++) {
          const B = bands[b], F = this.f[b];
          F.d = 0;
          if (!B.on) continue;
          if (B.dyn && B.range !== 0) {
            const scType = B.type === 'lowshelf' ? 'highcut' : B.type === 'highshelf' ? 'lowcut' : B.type === 'bell' ? 'bandpass' : null;
            if (scType) {
              const scKey = scType + B.freq + '|' + B.q;
              if (F.scKey !== scKey) { F.sc.set(biquadCoefs(scType, B.freq, scType === 'bandpass' ? Math.max(B.q, 0.7) : 0.707, 0, sampleRate)); F.scKey = scKey; }
              const atk = coef(B.attack), rel = coef(B.release);
              let env = F.env;
              for (let i = 0; i < n; i++) {
                const s = Math.abs(F.sc.run((L[i] + R[i]) * 0.5, 0));
                env = s > env ? atk * env + (1 - atk) * s : rel * env + (1 - rel) * s;
              }
              F.env = env;
              const over = 20 * Math.log10(env + 1e-9) - B.thresh;
              if (over > 0) F.d = B.range < 0 ? Math.max(B.range, -over * 0.75) : Math.min(B.range, over * 0.75);
            }
          }
          const g = B.type === 'lowcut' || B.type === 'highcut' ? 0 : B.gain + F.d;
          const key = B.type + '|' + B.freq + '|' + B.q + '|' + g.toFixed(2);
          if (F.key !== key) { F.main.set(biquadCoefs(B.type, B.freq, B.q, g, sampleRate)); F.key = key; }
        }
        const og = dbToLin(p.out || 0);
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i];
          for (let b = 0; b < bands.length; b++) {
            if (!bands[b].on) continue;
            const m = this.f[b].main;
            l = m.run(l, 0);
            r = m.run(r, 1);
          }
          oL[i] = l * og;
          if (oR !== oL) oR[i] = r * og;
        }
      }
      this.cnt += n;
      if (this.cnt >= METER_EVERY) { this.cnt = 0; this.port.postMessage({ bands: this.f.map((F) => F.d) }); }
      return true;
    }
  }

  // ---------------- Compressor / gate / expander (C1 style) ----------------
  class Dyn extends AudioWorkletProcessor {
    constructor() {
      super();
      this.p = { bypass: false, mode: 'comp', threshold: -20, ratio: 4, attack: 10, release: 120, knee: 0, makeup: 0, range: 40, hold: 0, scHp: 20, scLp: 20000 };
      this.hp = new BQ(); this.lp = new BQ(); this.key = '';
      this.det = 0; this.g = 0; this.holdCnt = 0;
      this.cnt = 0; this.inPk = 0; this.outPk = 0; this.minG = 0;
      this.port.onmessage = (e) => { this.p = e.data; };
    }
    process(inputs, outputs) {
      const io = chans(inputs, outputs);
      if (io.silent) { io.out.forEach((o) => o.fill(0)); return true; }
      const { L, R, oL, oR, n } = io;
      const p = this.p;
      const key = p.scHp + '|' + p.scLp;
      if (key !== this.key) {
        this.hp.set(p.scHp > 21 ? biquadCoefs('lowcut', p.scHp, 0.707, 0, sampleRate) : UNITY);
        this.lp.set(p.scLp < 19500 ? biquadCoefs('highcut', p.scLp, 0.707, 0, sampleRate) : UNITY);
        this.key = key;
      }
      const comp = p.mode === 'comp';
      const atk = coef(p.attack), rel = coef(p.release), detRel = coef(comp ? 5 : 12);
      const makeup = dbToLin(p.makeup || 0);
      const holdN = (p.hold || 0) * 0.001 * sampleRate;
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R[i];
        const sl = this.lp.run(this.hp.run(l, 0), 0);
        const sr = this.lp.run(this.hp.run(r, 1), 1);
        const rect = Math.max(Math.abs(sl), Math.abs(sr));
        this.det = rect > this.det ? rect : this.det * detRel;
        const lvl = 20 * Math.log10(this.det + 1e-9);
        let target = staticGain(p, lvl);
        if (!comp) {
          if (target > -0.01) this.holdCnt = holdN;
          else if (this.holdCnt > 0) { this.holdCnt--; target = 0; }
        }
        const c = comp ? (target < this.g ? atk : rel) : (target > this.g ? atk : rel);
        this.g = c * this.g + (1 - c) * target;
        const gl = p.bypass ? 1 : dbToLin(this.g) * makeup;
        const ol = l * gl, or = r * gl;
        oL[i] = ol;
        if (oR !== oL) oR[i] = or;
        const ai = Math.max(Math.abs(l), Math.abs(r)), ao = Math.max(Math.abs(ol), Math.abs(or));
        if (ai > this.inPk) this.inPk = ai;
        if (ao > this.outPk) this.outPk = ao;
        if (this.g < this.minG) this.minG = this.g;
      }
      this.cnt += n;
      if (this.cnt >= METER_EVERY) {
        this.port.postMessage({ inPk: this.inPk, outPk: this.outPk, gr: p.bypass ? 0 : this.minG, lvl: 20 * Math.log10(this.det + 1e-9), g: this.g });
        this.cnt = 0; this.inPk = 0; this.outPk = 0; this.minG = 0;
      }
      return true;
    }
  }

  // ---------------- De-esser (Waves DeEsser style) --------------------------
  class DeEss extends AudioWorkletProcessor {
    constructor() {
      super();
      this.p = { bypass: false, freq: 6000, threshold: -30, range: 8, split: true, bp: false, audition: false };
      this.sc = new BQ(); this.split = new BQ(); this.key = '';
      this.det = 0; this.g = 0; this.cnt = 0; this.minG = 0; this.scPk = 0;
      this.port.onmessage = (e) => { this.p = e.data; };
    }
    process(inputs, outputs) {
      const io = chans(inputs, outputs);
      if (io.silent) { io.out.forEach((o) => o.fill(0)); return true; }
      const { L, R, oL, oR, n } = io;
      const p = this.p;
      const key = p.freq + '|' + p.bp;
      if (key !== this.key) {
        this.sc.set(biquadCoefs(p.bp ? 'bandpass' : 'lowcut', p.freq, p.bp ? 2 : 0.707, 0, sampleRate));
        this.split.set(biquadCoefs('lowcut', p.freq, 0.707, 0, sampleRate));
        this.key = key;
      }
      const atk = coef(0.5), rel = coef(60), detRel = coef(5);
      for (let i = 0; i < n; i++) {
        const l = L[i], r = R[i];
        const sl = this.sc.run(l, 0), sr = this.sc.run(r, 1);
        const rect = Math.max(Math.abs(sl), Math.abs(sr));
        if (rect > this.scPk) this.scPk = rect;
        this.det = rect > this.det ? rect : this.det * detRel;
        const lvl = 20 * Math.log10(this.det + 1e-9);
        const target = -Math.min(p.range, Math.max(0, lvl - p.threshold));
        const c = target < this.g ? atk : rel;
        this.g = c * this.g + (1 - c) * target;
        if (this.g < this.minG) this.minG = this.g;
        let ol = l, or = r;
        if (p.audition) { ol = sl; or = sr; }
        else if (!p.bypass) {
          const G = dbToLin(this.g);
          if (p.split) {
            const hl = this.split.run(l, 0), hr = this.split.run(r, 1);
            ol = l - hl + hl * G;
            or = r - hr + hr * G;
          } else { ol = l * G; or = r * G; }
        }
        oL[i] = ol;
        if (oR !== oL) oR[i] = or;
      }
      this.cnt += n;
      if (this.cnt >= METER_EVERY) {
        this.port.postMessage({ gr: p.bypass ? 0 : this.minG, scPk: this.scPk });
        this.cnt = 0; this.minG = 0; this.scPk = 0;
      }
      return true;
    }
  }

  // ---------------- Channel strip (SSL EV2 Channel style) ------------------
  // preamp gain + saturation + self-noise -> filters -> EQ <-> dynamics -> fader
  const NOISE = Math.pow(10, -110 / 20) * Math.sqrt(12); // input-referred hiss, -110 dBFS RMS
  const PROTECT_DB = -10; // monitor protection: hold the output's RMS at or below this

  class Strip extends AudioWorkletProcessor {
    constructor() {
      super();
      this.p = null;
      this.F = [new BQ(), new BQ(), new BQ()];
      this.E = [new BQ(), new BQ(), new BQ(), new BQ()];
      this.key = '';
      this.cDet = 0; this.cG = 0; this.gDet = 0; this.gG = 0; this.hold = 0;
      this.ms = 0; this.prot = 0;
      this.cnt = 0; this.inPk = 0; this.outPk = 0; this.cMin = 0; this.gMin = 0; this.pMin = 0;
      this.port.onmessage = (e) => { this.p = e.data; };
    }
    coefs(p) {
      const key = [p.hpf, p.lpf, p.eqIn, p.lfG, p.lfF, p.lfBell, p.lmfG, p.lmfF, p.lmfQ, p.hmfG, p.hmfF, p.hmfQ, p.hfG, p.hfF, p.hfBell].join('|');
      if (key === this.key) return;
      this.key = key;
      const c = stripCoefs(p, sampleRate);
      c.filt.forEach((k, i) => this.F[i].set(k));
      c.eq.forEach((k, i) => this.E[i].set(k));
    }
    process(inputs, outputs) {
      const io = chans(inputs, outputs);
      const p = this.p;
      if (io.silent || !p) { io.out.forEach((o) => o.fill(0)); return true; }
      const { L, R, oL, oR, n } = io;
      this.coefs(p);
      const F = this.F, E = this.E;
      const g = dbToLin(p.gain) * (p.polarity ? -1 : 1);
      const fader = p.fader <= -59.9 ? 0 : dbToLin(p.fader);
      const cP = { mode: 'comp', threshold: p.cThr, ratio: p.cRatio, knee: p.cRatio >= 19.5 ? 0 : 4 };
      const gP = { mode: p.gMode === 'expand' ? 'expand' : 'gate', threshold: p.gThr, range: p.gRange, ratio: 2 };
      const cAtk = coef(p.cFast ? 0.3 : 8), cRel = coef(p.cRel * 1000), cDetRel = coef(5);
      const gAtk = coef(p.gFast ? 0.1 : 2), gRel = coef(p.gRel * 1000), gDetRel = coef(12);
      const holdN = 0.02 * sampleRate;
      const msC = coef(100), pAtk = coef(5), pRel = coef(400);
      const dyn = !p.bypass && (p.compIn || p.gateIn);
      if (!p.gateIn) this.gG = 0;
      if (!p.compIn) this.cG = 0;

      for (let i = 0; i < n; i++) {
        // preamp: gain (with self-noise), then soft saturation when driven past full scale
        let l = (L[i] + (Math.random() - 0.5) * NOISE) * g;
        let r = (R[i] + (Math.random() - 0.5) * NOISE) * g;
        const a = Math.max(Math.abs(l), Math.abs(r));
        if (a > this.inPk) this.inPk = a;
        l = Math.tanh(l);
        r = Math.tanh(r);

        if (!p.bypass) {
          let fl = l, fr = r;
          for (let k = 0; k < 3; k++) { fl = F[k].run(fl, 0); fr = F[k].run(fr, 1); }
          if (!p.filtSc) { l = fl; r = fr; }
          if (!p.dynPre) for (let k = 0; k < 4; k++) { l = E[k].run(l, 0); r = E[k].run(r, 1); }
          if (dyn) {
            const rect = p.filtSc ? Math.max(Math.abs(fl), Math.abs(fr)) : Math.max(Math.abs(l), Math.abs(r));
            let gain = 0;
            if (p.gateIn) {
              this.gDet = rect > this.gDet ? rect : this.gDet * gDetRel;
              let t = staticGain(gP, 20 * Math.log10(this.gDet + 1e-9));
              if (t > -0.01) this.hold = holdN;
              else if (this.hold > 0) { this.hold--; t = 0; }
              const c = t > this.gG ? gAtk : gRel;
              this.gG = c * this.gG + (1 - c) * t;
              if (this.gG < this.gMin) this.gMin = this.gG;
              gain += this.gG;
            }
            if (p.compIn) {
              this.cDet = rect > this.cDet ? rect : this.cDet * cDetRel;
              const t = staticGain(cP, 20 * Math.log10(this.cDet + 1e-9));
              const c = t < this.cG ? cAtk : cRel;
              this.cG = c * this.cG + (1 - c) * t;
              if (this.cG < this.cMin) this.cMin = this.cG;
              gain += this.cG;
            }
            const G = dbToLin(gain);
            l *= G;
            r *= G;
          }
          if (p.dynPre) for (let k = 0; k < 4; k++) { l = E[k].run(l, 0); r = E[k].run(r, 1); }
        }

        // fader, then the converter's hard ceiling
        l *= fader;
        r *= fader;
        const ao = Math.max(Math.abs(l), Math.abs(r));
        if (ao > this.outPk) this.outPk = ao;
        l = l > 1 ? 1 : l < -1 ? -1 : l;
        r = r > 1 ? 1 : r < -1 ? -1 : r;

        // monitor protection so a cranked preamp can't blast the listener
        this.ms = msC * this.ms + (1 - msC) * 0.5 * (l * l + r * r);
        const over = 10 * Math.log10(this.ms + 1e-12) - PROTECT_DB;
        const tgt = over > 0 ? -over : 0;
        const pc = tgt < this.prot ? pAtk : pRel;
        this.prot = pc * this.prot + (1 - pc) * tgt;
        if (this.prot < this.pMin) this.pMin = this.prot;
        if (this.prot < -0.01) { const pg = dbToLin(this.prot); l *= pg; r *= pg; }

        oL[i] = l;
        if (oR !== oL) oR[i] = r;
      }
      this.cnt += n;
      if (this.cnt >= METER_EVERY) {
        this.port.postMessage({ inPk: this.inPk, outPk: this.outPk, cgr: this.cMin, ggr: this.gMin, gOpen: !p.gateIn || this.gG > -3, prot: this.pMin });
        this.cnt = 0; this.inPk = 0; this.outPk = 0; this.cMin = 0; this.gMin = 0; this.pMin = 0;
      }
      return true;
    }
  }

  registerProcessor('ea-strip', Strip);
  registerProcessor('ea-eq', EQ);
  registerProcessor('ea-dyn', Dyn);
  registerProcessor('ea-deess', DeEss);
}

EA.pluginDsp = (() => {
  /** |H(f)| in dB for a biquad coefficient set. */
  function magDb(c, f, sr) {
    const w = (2 * Math.PI * f) / sr;
    const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c[0] + c[1] * cw + c[2] * c2, ni = -(c[1] * sw + c[2] * s2);
    const dr = 1 + c[3] * cw + c[4] * c2, di = -(c[3] * sw + c[4] * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-20);
  }

  let url = null;
  function moduleUrl() {
    if (!url) {
      const code = `${biquadCoefs.toString()}\n${staticGain.toString()}\n${stripCoefs.toString()}\n(${eaWorkletBody.toString()})();`;
      url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    }
    return url;
  }

  return { biquadCoefs, staticGain, stripCoefs, magDb, moduleUrl };
})();

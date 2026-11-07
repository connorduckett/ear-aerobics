/* Ear Aerobics — DSP helpers (offline rendering, level analysis, normalization) */
window.EA = window.EA || {};

EA.dsp = (() => {
  const mk = (ch, len, sr) => new AudioBuffer({ numberOfChannels: ch, length: len, sampleRate: sr });

  function rms(b) {
    let s = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    }
    return Math.sqrt(s / (b.length * b.numberOfChannels)) || 1e-9;
  }

  function peak(b) {
    let p = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > p) p = v;
      }
    }
    return p;
  }

  function scale(b, g) {
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
    return b;
  }

  /** Scale `b` so its RMS matches `ref` (loudness matching). */
  const matchRms = (b, ref) => scale(b, rms(ref) / rms(b));

  /** Scale every buffer by the same factor so none exceeds `ceil`. Returns the factor. */
  function headroom(bufs, ceil = 0.89) {
    const p = Math.max(...bufs.map(peak));
    const g = p > ceil ? ceil / p : 1;
    if (g < 1) bufs.forEach((b) => scale(b, g));
    return g;
  }

  function safety(b, ceil = 0.98) {
    const p = peak(b);
    if (p > ceil) scale(b, ceil / p);
    return b;
  }

  function normalize(b, targetRms = 0.1, maxPeak = 0.7) {
    scale(b, targetRms / rms(b));
    const p = peak(b);
    if (p > maxPeak) scale(b, maxPeak / p);
    return b;
  }

  const monoCache = new WeakMap();
  /** Sum to a true 1-channel buffer (so StereoPanner applies an equal-power pan law). */
  function toMono(b) {
    if (b.numberOfChannels === 1) return b;
    if (monoCache.has(b)) return monoCache.get(b);
    const m = mk(1, b.length, b.sampleRate);
    const o = m.getChannelData(0);
    const n = b.numberOfChannels;
    for (let c = 0; c < n; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) o[i] += d[i] / n;
    }
    monoCache.set(b, m);
    return m;
  }

  /**
   * Render a looping buffer through a processing chain.
   * Renders two passes and keeps the second, so filter/compressor state is
   * already settled at the loop point (seamless looping, no start-up artifacts).
   * `build(ctx, sourceNode)` must connect the source and return the last node.
   */
  async function render(src, build, channels = 2) {
    const len = src.length;
    const sr = src.sampleRate;
    const off = new OfflineAudioContext(channels, len * 2, sr);
    const s = off.createBufferSource();
    s.buffer = src;
    s.loop = true;
    const out = build(off, s);
    out.connect(off.destination);
    s.start(0);
    const r = await off.startRendering();
    const res = mk(channels, len, sr);
    for (let c = 0; c < channels; c++) res.copyToChannel(r.getChannelData(c).subarray(len, len * 2), c);
    return res;
  }

  const dbToGain = (d) => Math.pow(10, d / 20);

  return { mk, rms, peak, scale, matchRms, headroom, safety, normalize, toMono, render, dbToGain };
})();

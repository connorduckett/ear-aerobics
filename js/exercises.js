/* Ear Aerobics — exercise definitions.
 *
 * Each exercise:
 *   question(levelCfg)     -> { options?: [values], answer, ...params }
 *   render(src, q, value)  -> processed AudioBuffer for a given answer value
 *   build(src, q)          -> optional override returning the full buffer list
 *   label(value, q)        -> button label (discrete exercises)
 *   mode: 'ab' (reference vs processed) or 'which' (pick A or B)
 *
 * Continuous exercises (continuous: true) have no option buttons. The player
 * places a marker on an axis and earns credit based on how close it lands:
 * full credit inside `tol.perfect`, sliding to zero at `tol.zero`.
 */
window.EA = window.EA || {};

EA.exercises = (() => {
  const { dsp } = EA;

  const fmt = {
    hz: (v) => (v >= 1000 ? parseFloat((v / 1000).toFixed(2)) + 'k' : String(v)),
    hzLong: (v) => (v >= 1000 ? parseFloat((v / 1000).toFixed(2)) + ' kHz' : v + ' Hz'),
    db: (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + ' dB',
    pan: (v) => (Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)),
    ms: (v) => (v >= 1 ? v + ' s' : parseFloat((v * 1000).toFixed(1)) + ' ms'),
    ratio: (v) => v + ':1',
  };

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const range = (from, to, step) => {
    const out = [];
    for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  };
  const randLog = (lo, hi) => lo * Math.pow(hi / lo, Math.random());
  /** Round to two significant figures: 347 -> 350, 2480 -> 2500, 1234 -> 1200. */
  const niceHz = (v) => {
    const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(Math.round(v / p) * p);
  };

  // ---- continuous answer axes ---------------------------------------------
  const FREQ_AXIS = {
    kind: 'log', min: 80, max: 12000,
    ticks: [80, 125, 250, 500, 1000, 2000, 4000, 8000, 12000],
    minor: [90, 100, 150, 200, 300, 400, 600, 700, 800, 900, 1500, 3000, 5000, 6000, 7000, 10000],
    snap: niceHz, fmt: fmt.hzLong, short: fmt.hz,
    dist: (a, b) => Math.abs(Math.log2(a / b)),
    distText: (d) => (d < 0.005 ? 'dead on' : `${d.toFixed(2)} octaves off`),
    widen: (center, w, dir) => center * Math.pow(2, dir * w),
  };
  const PAN_AXIS = {
    kind: 'lin', min: -1, max: 1,
    ticks: [-1, -0.5, 0, 0.5, 1],
    minor: range(-0.9, 0.9, 0.1).filter((v) => Math.abs(v) > 0.01 && Math.abs(Math.abs(v) - 0.5) > 0.01),
    snap: (v) => Math.round(v * 100) / 100, fmt: fmt.pan, short: fmt.pan,
    dist: (a, b) => Math.abs(a - b),
    distText: (d) => (d < 0.005 ? 'dead on' : `${Math.round(d * 100)}% off`),
    widen: (center, w, dir) => center + dir * w,
  };
  const FREQ_TOL = [
    { perfect: 1 / 3, zero: 2, txt: 'full credit within ⅓ octave' },
    { perfect: 1 / 4, zero: 1.5, txt: 'full credit within ¼ octave' },
    { perfect: 1 / 6, zero: 1, txt: 'full credit within ⅙ octave' },
    { perfect: 1 / 12, zero: 2 / 3, txt: 'full credit within 1/12 octave' },
  ];
  const PAN_TOL = [
    { perfect: 0.1, zero: 0.6, txt: 'full credit within 10%' },
    { perfect: 0.07, zero: 0.45, txt: 'full credit within 7%' },
    { perfect: 0.05, zero: 0.3, txt: 'full credit within 5%' },
    { perfect: 0.03, zero: 0.2, txt: 'full credit within 3%' },
  ];

  // ---- processing builders -------------------------------------------------
  const peaking = (freq, gain, q) => (c, s) => {
    const f = c.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    s.connect(f);
    return f;
  };

  // 4th-order Butterworth (24 dB/oct) from two cascaded biquads
  const butter = (type, freq) => (c, s) => {
    let node = s;
    [0.5412, 1.3066].forEach((q) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      node.connect(f);
      node = f;
    });
    return node;
  };

  const gain = (db) => (c, s) => {
    const g = c.createGain();
    g.gain.value = dsp.dbToGain(db);
    s.connect(g);
    return g;
  };

  const pan = (v) => (c, s) => {
    const p = c.createStereoPanner();
    p.pan.value = v;
    s.connect(p);
    return p;
  };

  // DynamicsCompressorNode has a fixed 6 ms look-ahead; delay the dry signal to match
  // so switching A/B never jumps in time (which would be a giveaway).
  const COMP_LOOKAHEAD = 0.006;
  const delayed = (c, s) => {
    const d = c.createDelay(0.05);
    d.delayTime.value = COMP_LOOKAHEAD;
    s.connect(d);
    return d;
  };

  const compressor = (p) => (c, s) => {
    const k = c.createDynamicsCompressor();
    k.threshold.value = p.threshold;
    k.knee.value = p.knee ?? 0;
    k.ratio.value = p.ratio;
    k.attack.value = p.attack;
    k.release.value = p.release;
    s.connect(k);
    return k;
  };

  // ---- shared bits for the compressor family -------------------------------
  const dynBase = {
    cat: 'dyn',
    mode: 'ab',
    match: true,
    partial: true,
    defaultSource: 'drums',
    abLabels: ['Dry', 'Compressed'],
    renderRef: (src) => dsp.render(src, delayed),
  };
  const dynContext = (p, skip) =>
    [
      skip !== 'threshold' && `Threshold ${fmt.db(p.threshold)}`,
      skip !== 'ratio' && `Ratio ${fmt.ratio(p.ratio)}`,
      skip !== 'attack' && `Attack ${fmt.ms(p.attack)}`,
      skip !== 'release' && `Release ${fmt.ms(p.release)}`,
    ].filter(Boolean).join(' · ') + ' · loudness matched';

  const freqBase = {
    cat: 'eq', mode: 'ab', continuous: true, axis: FREQ_AXIS,
    label: (v) => fmt.hz(v),
    longLabel: (v) => fmt.hzLong(v),
  };

  const list = [
    // ======================= EQ & FREQUENCY =======================
    {
      ...freqBase,
      id: 'peak', name: 'Peak Finder', icon: 'peak',
      blurb: 'A bell boost is hiding somewhere between 80 Hz and 12 kHz. Pinpoint it. The closer you get, the more points.',
      defaultSource: 'pink',
      abLabels: ['Flat', "EQ'd"],
      tips: [
        'Flip between Flat and EQ’d. Listen for which part of the spectrum suddenly "sticks out".',
        'Lows (80–150 Hz) feel like weight and thump; 250–500 Hz sounds boxy or muddy.',
        '1–2 kHz is nasal and honky; 3–5 kHz is presence and bite; 8–12 kHz is air and sizzle.',
        'Get in the right octave first, then refine. Arrow keys nudge your marker.',
      ],
      levels: [
        { desc: `+12 dB · ${FREQ_TOL[0].txt}`, gain: 12, q: 1.4, tol: FREQ_TOL[0] },
        { desc: `+9 dB · ${FREQ_TOL[1].txt}`, gain: 9, q: 2, tol: FREQ_TOL[1] },
        { desc: `+6 dB · ${FREQ_TOL[2].txt}`, gain: 6, q: 2, tol: FREQ_TOL[2] },
        { desc: `+6 dB narrow · ${FREQ_TOL[3].txt}`, gain: 6, q: 3, tol: FREQ_TOL[3] },
      ],
      question: (L) => ({ answer: niceHz(randLog(90, 11000)), gain: L.gain, q: L.q, tol: L.tol }),
      prompt: (q) => `Where is the +${q.gain} dB boost?`,
      render: (src, q, v) => dsp.render(src, peaking(v, q.gain, q.q)),
    },
    {
      ...freqBase,
      id: 'dip', name: 'Dip Finder', icon: 'dip',
      blurb: 'Something has been scooped out. Cuts are harder to hear than boosts. Find the exact frequency.',
      defaultSource: 'pink',
      abLabels: ['Flat', "EQ'd"],
      tips: [
        'Cuts are about what is missing. Listen to Flat first, then notice what disappears.',
        'A low cut makes things thinner; a 300 Hz cut cleans up; a 3 kHz cut makes things distant and soft.',
        'Try listening for a "hole" in the noise, like a notch where the hiss changes color.',
      ],
      levels: [
        { desc: `−15 dB · ${FREQ_TOL[0].txt}`, gain: -15, q: 1.4, tol: FREQ_TOL[0] },
        { desc: `−12 dB · ${FREQ_TOL[1].txt}`, gain: -12, q: 2, tol: FREQ_TOL[1] },
        { desc: `−9 dB · ${FREQ_TOL[2].txt}`, gain: -9, q: 2, tol: FREQ_TOL[2] },
        { desc: `−9 dB narrow · ${FREQ_TOL[3].txt}`, gain: -9, q: 3, tol: FREQ_TOL[3] },
      ],
      question: (L) => ({ answer: niceHz(randLog(90, 11000)), gain: L.gain, q: L.q, tol: L.tol }),
      prompt: (q) => `Where is the ${Math.abs(q.gain)} dB cut?`,
      render: (src, q, v) => dsp.render(src, peaking(v, q.gain, q.q)),
    },
    {
      ...freqBase,
      id: 'filter', name: 'Filter Sweep', icon: 'filter',
      blurb: 'A 24 dB/oct high-pass or low-pass filter is on. Place the cutoff as precisely as you can.',
      defaultSource: 'mix',
      abLabels: ['Flat', 'Filtered'],
      tips: [
        'High-pass: listen for where the bottom end stops. Is the kick gone? The bass? The snare body?',
        'Low-pass: listen for where the top stops. Are the hats dull? Is the snare muffled?',
        'Reference points: kick and bass weight sit around 80–150 Hz, snare body near 200 Hz, hats live above 6 kHz.',
      ],
      levels: FREQ_TOL.map((tol, i) => ({ desc: `${['Wide', 'Moderate', 'Tight', 'Pro'][i]} scoring · ${tol.txt}`, tol })),
      question: (L) => {
        const type = Math.random() < 0.5 ? 'highpass' : 'lowpass';
        const answer = niceHz(type === 'highpass' ? randLog(90, 2500) : randLog(800, 11000));
        return { answer, type, tol: L.tol };
      },
      prompt: (q) => `A ${q.type === 'highpass' ? 'high-pass' : 'low-pass'} filter was applied. Where is the cutoff?`,
      render: (src, q, v) => dsp.render(src, butter(q.type, v)),
    },

    // ======================= LEVEL =======================
    {
      id: 'gain', name: 'Gain Detective', cat: 'level', icon: 'gain', mode: 'ab', partial: false, layout: 'two',
      blurb: 'The Changed version has been turned up or down. Two choices. Which one is the real change?',
      defaultSource: 'mix',
      abLabels: ['Reference', 'Changed'],
      tips: [
        '1 dB is about the smallest change most people notice on music; 3 dB is clear; 6 dB is obvious.',
        'Both choices move in the same direction, so you’re judging the size of the jump, not up vs down.',
        'Switch back and forth quickly. Long gaps make level memory unreliable.',
      ],
      levels: [
        { desc: 'Choices 4 dB apart', gap: 4, max: 10 },
        { desc: 'Choices 3 dB apart', gap: 3, max: 8 },
        { desc: 'Choices 2 dB apart', gap: 2, max: 6 },
        { desc: 'Choices 1 dB apart', gap: 1, max: 4 },
      ],
      question: (L) => {
        for (;;) {
          const sign = Math.random() < 0.5 ? -1 : 1;
          const a = sign * (1 + Math.floor(Math.random() * L.max));
          const cands = [a + sign * L.gap, a - sign * L.gap].filter((x) => Math.sign(x) === sign && Math.abs(x) <= L.max);
          if (!cands.length) continue;
          const other = pick(cands);
          return { options: [a, other].sort((x, y) => x - y), answer: a };
        }
      },
      label: (v) => fmt.db(v),
      longLabel: (v) => fmt.db(v),
      prompt: (q) => `Was the level changed by ${fmt.db(q.options[0])} or ${fmt.db(q.options[1])}?`,
      render: (src, q, v) => dsp.render(src, gain(v)),
    },

    // ======================= STEREO =======================
    {
      id: 'pan', name: 'Pan Position', cat: 'stereo', icon: 'pan', mode: 'ab', continuous: true, axis: PAN_AXIS,
      blurb: 'A mono signal has been panned. Pinpoint exactly where it sits between the speakers.',
      defaultSource: 'mix',
      abLabels: ['Center', 'Panned'],
      tips: [
        'Sit in the sweet spot. Speakers and your head should form an equilateral triangle. Headphones work too.',
        'Use the Center reference to find "home", then judge how far the image moved.',
        'Hard-panned (L100/R100) sources come from only one speaker. Close your eyes and point.',
      ],
      levels: PAN_TOL.map((tol, i) => ({ desc: `${['Wide', 'Moderate', 'Tight', 'Pro'][i]} scoring · ${tol.txt}`, tol })),
      question: (L) => ({ answer: Math.round((Math.random() * 2 - 1) * 20) / 20, tol: L.tol }),
      label: (v) => fmt.pan(v),
      longLabel: (v) => fmt.pan(v),
      prompt: () => 'Where is the sound panned?',
      prep: (src) => dsp.toMono(src),
      renderRef: (src) => dsp.render(src, pan(0)),
      render: (src, q, v) => dsp.render(src, pan(v)),
    },

    // ======================= DYNAMICS =======================
    {
      ...dynBase,
      id: 'squeeze', name: 'Spot the Squeeze', icon: 'squeeze', mode: 'which', partial: false,
      blurb: 'One of these is compressed, one isn’t. They’re loudness-matched, so trust your ears.',
      abLabels: ['A', 'B'],
      tips: [
        'Compressed audio has smaller differences between loud and quiet. Transients feel flatter, the tail feels louder.',
        'Listen to the snare: does the crack jump out, or is it pushed down against the room and decay?',
        'Volume won’t help you here. Both versions are matched to the same RMS level.',
      ],
      levels: [
        { desc: 'Heavy: 10:1 at −36 dB', p: { ratio: 10, threshold: -36, attack: 0.001, release: 0.06 } },
        { desc: 'Firm: 6:1 at −30 dB', p: { ratio: 6, threshold: -30, attack: 0.003, release: 0.1 } },
        { desc: 'Moderate: 3:1 at −26 dB', p: { ratio: 3, threshold: -26, attack: 0.01, release: 0.15 } },
        { desc: 'Gentle: 2:1 at −24 dB', p: { ratio: 2, threshold: -24, attack: 0.02, release: 0.2 } },
      ],
      question: (L) => ({ options: [0, 1], answer: Math.random() < 0.5 ? 0 : 1, p: L.p }),
      label: (v) => (v === 0 ? 'A' : 'B'),
      longLabel: (v) => (v === 0 ? 'A' : 'B'),
      prompt: () => 'One of these is compressed. Which one?',
      build: async (src, q) => {
        const dry = await dsp.render(src, delayed);
        const wet = await dsp.render(src, compressor(q.p));
        dsp.matchRms(wet, dry);
        q.scale = dsp.headroom([dry, wet]);
        return q.answer === 0 ? [wet, dry] : [dry, wet];
      },
    },
    {
      ...dynBase,
      id: 'ratio', name: 'Ratio', icon: 'comp',
      blurb: 'Same threshold, different ratio. How hard is the compressor clamping down?',
      tips: [
        'Ratio sets how much the signal is reduced once it crosses the threshold. 2:1 is gentle, 20:1 is limiting.',
        'High ratios flatten the peaks completely. Hits lose their "bounce" and sound pinned.',
        'Low ratios keep the shape of transients but tighten up the overall level.',
      ],
      levels: [
        { desc: '1.5, 4 or 20:1', opts: [1.5, 4, 20] },
        { desc: '4 ratios', opts: [1.5, 3, 6, 20] },
        { desc: '6 ratios', opts: [1.5, 2, 3, 4, 6, 10] },
        { desc: '9 ratios', opts: [1.5, 2, 2.5, 3, 4, 6, 8, 12, 20] },
      ],
      base: { threshold: -30, attack: 0.005, release: 0.12 },
      question(L) { return { options: L.opts, answer: pick(L.opts), p: this.base }; },
      label: (v) => fmt.ratio(v),
      longLabel: (v) => fmt.ratio(v),
      prompt: () => 'What compression ratio is on B?',
      context: (q) => dynContext(q.p, 'ratio'),
      render: (src, q, v) => dsp.render(src, compressor({ ...q.p, ratio: v })),
    },
    {
      ...dynBase,
      id: 'attack', name: 'Attack', icon: 'attack',
      blurb: 'How quickly does the compressor grab the transient? Fast clamps, slow lets the punch through.',
      tips: [
        'Fast attack (under 3 ms) catches the very front of hits. Drums go soft and dull, the crack disappears.',
        'Slow attack (30 ms+) lets the initial transient through before clamping. Drums can sound punchier than dry.',
        'Focus on the first few milliseconds of the kick and snare.',
      ],
      levels: [
        { desc: '1 ms vs 80 ms', opts: [0.001, 0.08] },
        { desc: '3 attack times', opts: [0.001, 0.01, 0.08] },
        { desc: '5 attack times', opts: [0.0005, 0.003, 0.01, 0.03, 0.08] },
        { desc: '8 attack times', opts: [0.0005, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.15] },
      ],
      base: { threshold: -30, ratio: 8, release: 0.15 },
      question(L) { return { options: L.opts, answer: pick(L.opts), p: this.base }; },
      label: (v) => fmt.ms(v),
      longLabel: (v) => fmt.ms(v),
      prompt: () => 'What attack time is the compressor using?',
      context: (q) => dynContext(q.p, 'attack'),
      render: (src, q, v) => dsp.render(src, compressor({ ...q.p, attack: v })),
    },
    {
      ...dynBase,
      id: 'release', name: 'Release', icon: 'release',
      blurb: 'How fast does the compressor let go? Listen to what happens between the hits.',
      tips: [
        'Fast release recovers between hits. Decays and room sound swell up, which can sound "pumpy" or grainy.',
        'Slow release stays clamped. The whole groove sits lower and smoother, with less breathing.',
        'Listen to the space after each snare. Does the tail rise back up, or stay pressed down?',
      ],
      levels: [
        { desc: '40 ms vs 800 ms', opts: [0.04, 0.8] },
        { desc: '3 release times', opts: [0.04, 0.2, 0.8] },
        { desc: '5 release times', opts: [0.025, 0.075, 0.2, 0.5, 1] },
        { desc: '8 release times', opts: [0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1] },
      ],
      base: { threshold: -30, ratio: 8, attack: 0.002 },
      question(L) { return { options: L.opts, answer: pick(L.opts), p: this.base }; },
      label: (v) => fmt.ms(v),
      longLabel: (v) => fmt.ms(v),
      prompt: () => 'What release time is the compressor using?',
      context: (q) => dynContext(q.p, 'release'),
      render: (src, q, v) => dsp.render(src, compressor({ ...q.p, release: v })),
    },
    {
      ...dynBase,
      id: 'threshold', name: 'Threshold', icon: 'comp',
      blurb: 'Where does compression kick in? Lower thresholds mean more of the signal gets squashed.',
      tips: [
        'A high threshold only touches the loudest peaks. A low threshold compresses almost everything.',
        'Listen for how much of the groove is affected: just the snare hits, or the kick, bass and pads too?',
        'The source sits around −20 dB RMS, so thresholds above that only catch peaks.',
      ],
      levels: [
        { desc: '3 thresholds', opts: [-40, -24, -10] },
        { desc: '8 dB steps', opts: [-40, -32, -24, -16] },
        { desc: '5 dB steps', opts: [-40, -35, -30, -25, -20, -15] },
        { desc: '3 dB steps', opts: range(-42, -12, 3) },
      ],
      base: { ratio: 6, attack: 0.003, release: 0.12 },
      question(L) { return { options: L.opts, answer: pick(L.opts), p: this.base }; },
      label: (v) => String(v),
      longLabel: (v) => fmt.db(v),
      prompt: () => 'Where is the threshold set (dB)?',
      context: (q) => dynContext(q.p, 'threshold'),
      render: (src, q, v) => dsp.render(src, compressor({ ...q.p, threshold: v })),
    },
  ];

  const byId = Object.fromEntries(list.map((e) => [e.id, e]));

  // ---- generic build helpers -----------------------------------------------
  async function build(ex, src, q) {
    if (ex.build) return ex.build(src, q);
    const a = await (ex.renderRef ? ex.renderRef(src, q) : dsp.render(src, (c, s) => s));
    const b = await ex.render(src, q, q.answer);
    if (ex.match) dsp.matchRms(b, a);
    q.scale = dsp.headroom([a, b]);
    return [a, b];
  }

  async function buildPick(ex, src, q, v, ref) {
    if (ex.buildPick) return ex.buildPick(src, q, v);
    const c = await ex.render(src, q, v);
    if (ex.match) dsp.matchRms(c, ref);
    else dsp.scale(c, q.scale || 1);
    return c; // caller runs a shared headroom pass over all buffers so levels stay comparable
  }

  function grade(ex, q, v) {
    if (ex.continuous) {
      const d = ex.axis.dist(v, q.answer);
      const { perfect, zero } = q.tol;
      if (d <= perfect) return 1;
      return Math.max(0, Math.round((1 - (d - perfect) / (zero - perfect)) * 100) / 100);
    }
    if (v === q.answer) return 1;
    if (!ex.partial || q.options.length < 5) return 0;
    const d = Math.abs(q.options.indexOf(v) - q.options.indexOf(q.answer));
    return d === 1 ? 0.5 : 0;
  }

  return { list, byId, fmt, build, buildPick, grade };
})();

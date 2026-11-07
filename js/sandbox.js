/* Ear Aerobics — Sandbox: free play with real-time processors modeled on
 * classic Waves plugins (Q6, F6, C1 comp, C1 gate, DeEsser). */
window.EA = window.EA || {};

EA.sandbox = (() => {
  const { audio, sources, pluginDsp } = EA;
  const { biquadCoefs, staticGain, magDb } = pluginDsp;

  // ------------------------------------------------------------ formatting
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtHz = (v) => (v >= 1000 ? parseFloat((v / 1000).toFixed(v >= 10000 ? 1 : 2)) + ' kHz' : Math.round(v) + ' Hz');
  const fmtHzS = (v) => (v >= 1000 ? parseFloat((v / 1000).toFixed(1)) + 'k' : String(Math.round(v)));
  const fmtDb = (v) => (v > 0.05 ? '+' : '') + v.toFixed(1) + ' dB';
  const fmtMs = (v) => (v < 1 ? v.toFixed(2) + ' ms' : v < 10 ? v.toFixed(1) + ' ms' : v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(2) + ' s');
  const fmtRatio = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + ':1';
  const fmtQ = (v) => v.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const P = (key, label, min, max, def, o = {}) => ({ key, label, min, max, def, scale: 'lin', fmt: (v) => v.toFixed(1), ...o });

  // ------------------------------------------------------------ parameter specs
  const EQ_P = {
    freq: P('b.freq', 'Freq', 20, 20000, 1000, { scale: 'log', fmt: fmtHz, help: 'The center frequency of a bell, or the corner frequency of a shelf or cut. Boost a band and sweep it to find where an instrument lives, then decide what to do there.' }),
    gain: P('b.gain', 'Gain', -18, 18, 0, { fmt: fmtDb, bipolar: true, help: 'How much this band boosts or cuts. Small cuts usually sound more natural than big boosts. Double-click any knob to reset it.' }),
    q: P('b.q', 'Q', 0.1, 10, 1, { scale: 'log', fmt: fmtQ, help: 'Bandwidth. A high Q is a narrow, surgical notch for problem frequencies. A low Q is a broad, musical tone shape.' }),
    thresh: P('b.thresh', 'Thresh', -60, 0, -24, { fmt: fmtDb, help: 'Dynamic: the level, measured only inside this band’s frequency range, above which the band starts moving.' }),
    range: P('b.range', 'Range', -18, 18, 0, { fmt: fmtDb, bipolar: true, help: 'Dynamic: the most extra cut (negative) or boost (positive) the band adds when it goes over the threshold. 0 = static EQ band.' }),
    attack: P('b.attack', 'Attack', 0.5, 200, 10, { scale: 'log', fmt: fmtMs, help: 'Dynamic: how fast the band reacts when the frequency range gets loud.' }),
    release: P('b.release', 'Release', 10, 2000, 150, { scale: 'log', fmt: fmtMs, help: 'Dynamic: how fast the band returns to its static setting once the level drops.' }),
  };
  const OUT_P = P('out', 'Output', -18, 18, 0, { fmt: fmtDb, bipolar: true, help: 'Overall output trim. Use it to level-match against bypass, because louder always sounds "better".' });
  const BAND_COLORS = ['#ff6b6b', '#ffb547', '#c8ff3e', '#39d0ff', '#a78bfa', '#ff6fae'];
  const BAND_TYPES = [['bell', 'Bell'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf'], ['lowcut', 'Low cut'], ['highcut', 'High cut']];
  const TYPE_SHORT = { bell: 'Bell', lowshelf: 'LS', highshelf: 'HS', lowcut: 'LC', highcut: 'HC' };
  const TYPE_HELP = 'Bell boosts or cuts around a center frequency. Shelves lift or lower everything above (high) or below (low) the corner. Cuts remove everything below (low cut / high-pass) or above (high cut / low-pass).';

  function defaultBands() {
    return [
      { type: 'lowshelf', freq: 80, q: 0.71 }, { type: 'bell', freq: 250, q: 1 }, { type: 'bell', freq: 800, q: 1 },
      { type: 'bell', freq: 2500, q: 1 }, { type: 'bell', freq: 6000, q: 1 }, { type: 'highshelf', freq: 10000, q: 0.71 },
    ].map((b) => ({ on: true, gain: 0, thresh: -24, range: 0, attack: 10, release: 150, ...b }));
  }

  const COMP_PARAMS = [
    P('threshold', 'Threshold', -60, 0, -20, { fmt: fmtDb, help: 'The level where compression starts. Anything louder gets turned down. Lower threshold = more of the signal is compressed.' }),
    P('ratio', 'Ratio', 1, 20, 4, { scale: 'log', fmt: fmtRatio, help: 'How hard it turns down signal above the threshold. At 4:1, going 4 dB over the threshold comes out only 1 dB over. 20:1 is basically a limiter.' }),
    P('attack', 'Attack', 0.1, 100, 10, { scale: 'log', fmt: fmtMs, help: 'How fast it clamps down. Fast attack catches transients (softer, rounder). Slow attack lets the hit through first (punchier).' }),
    P('release', 'Release', 10, 1000, 120, { scale: 'log', fmt: fmtMs, help: 'How fast it lets go. Fast release brings up room and sustain (can pump). Slow release is smoother but can make things sound squashed.' }),
    P('knee', 'Knee', 0, 24, 3, { fmt: fmtDb, help: 'Soft knee eases into compression around the threshold. Hard knee (0) clamps the moment it crosses. Watch the curve bend.' }),
    P('makeup', 'Makeup', 0, 24, 0, { fmt: fmtDb, help: 'Gain added after compression to make up for the level it took away. Match the bypassed level to judge fairly.' }),
    P('scHp', 'SC HPF', 20, 500, 20, { scale: 'log', fmt: (v) => (v < 21 ? 'Off' : fmtHz(v)), help: 'Sidechain high-pass filter. Stops low end (like the kick or bass) from triggering compression, so the mix doesn’t pump on every kick.' }),
  ];
  const GATE_PARAMS = [
    P('threshold', 'Threshold', -80, 0, -60, { fmt: fmtDb, help: 'Below this level the gate closes (or the expander starts turning down). Set it just above the noise floor, below the quietest note you want to keep.' }),
    P('range', 'Range', 0, 80, 40, { fmt: (v) => '−' + v.toFixed(0) + ' dB', help: 'How far it turns down when closed. A full range mutes the noise completely. A small range (10–15 dB) sounds more natural.' }),
    P('ratio', 'Ratio', 1, 8, 2, { scale: 'log', fmt: fmtRatio, help: 'Expander only: how steeply it turns signal down below the threshold. A gate is effectively an infinite ratio.' }),
    P('attack', 'Attack', 0.05, 50, 0.5, { scale: 'log', fmt: fmtMs, help: 'How fast the gate opens. Too slow chops off the start of each hit; too fast can click.' }),
    P('hold', 'Hold', 0, 500, 30, { fmt: fmtMs, help: 'How long the gate stays open after the signal drops below the threshold, so it doesn’t chatter.' }),
    P('release', 'Release', 5, 2000, 150, { scale: 'log', fmt: fmtMs, help: 'How fast the gate closes. Short release is tight but can cut off decays; long release lets tails ring out.' }),
    P('scHp', 'Key HPF', 20, 2000, 20, { scale: 'log', fmt: (v) => (v < 21 ? 'Off' : fmtHz(v)), help: 'Key (sidechain) filter. On a snare gate, cut the low end so kick bleed doesn’t open it.' }),
    P('scLp', 'Key LPF', 1000, 20000, 20000, { scale: 'log', fmt: (v) => (v > 19500 ? 'Off' : fmtHz(v)), help: 'Key low-pass. Stops hi-hat or cymbal bleed from opening the gate.' }),
  ];
  const DEESS_PARAMS = [
    P('freq', 'Freq', 2000, 16000, 6000, { scale: 'log', fmt: fmtHz, help: 'Where the de-esser listens. Sibilance usually sits at 5–8 kHz for most voices. Use Audition to hear exactly what it’s reacting to.' }),
    P('threshold', 'Threshold', -60, 0, -30, { fmt: fmtDb, help: 'How loud the "s" energy has to get before it’s reduced. Lower = more de-essing. Watch the reduction meter flick on each "s".' }),
    P('range', 'Range', 0, 24, 8, { fmt: (v) => '−' + v.toFixed(1) + ' dB', help: 'The most it will ever turn down. Too much makes the singer sound lispy, like they lost their teeth.' }),
  ];

  // ------------------------------------------------------------ plugins
  const PLUGINS = [
    {
      id: 'eq6', name: 'EQ-6', model: 'Q6', kind: 'eq', proc: 'ea-eq', dynamic: false, source: 'mix',
      tagline: 'Parametric EQ',
      about: 'A 6-band parametric EQ. Each band can be a bell, shelf or cut filter. EQ changes the tonal balance by turning specific frequency ranges up or down. It’s the most-used tool in mixing.',
      tryThis: [
        'Boost band 3 by +12 dB with a high Q, then drag it left and right across the graph. Hear how the "color" moves. This is the classic sweep-and-destroy technique.',
        'Turn band 1 into a Low cut and raise it until the mix gets thin. Back it off until you just notice. That’s usually where it should be.',
        'Load the "Telephone" preset and hit B to bypass. Notice how much of a sound’s identity is in the mids.',
      ],
      presets: {
        'Warm vocal': [{ type: 'lowcut', freq: 90, q: 0.71 }, { gain: -3, freq: 280, q: 1.2 }, { gain: 0 }, { gain: 2.5, freq: 3200, q: 0.8 }, { gain: 0 }, { gain: 3, freq: 11000 }],
        'Smiley curve': [{ gain: 5, freq: 80 }, { gain: 0 }, { gain: -4, freq: 700, q: 0.6 }, { gain: 0 }, { gain: 0 }, { gain: 5, freq: 8000 }],
        'Telephone': [{ type: 'lowcut', freq: 450, q: 0.71 }, { gain: 0 }, { gain: 6, freq: 1500, q: 1 }, { gain: 0 }, { gain: 0 }, { type: 'highcut', freq: 3000, q: 0.71 }],
        'Kick thump & click': [{ type: 'bell', gain: 6, freq: 60, q: 1.4 }, { gain: -6, freq: 380, q: 2 }, { gain: 0 }, { gain: 4, freq: 4000, q: 2 }, { gain: 0 }, { gain: 0 }],
        'Find the mud (sweep)': [{ gain: 0 }, { gain: 12, freq: 300, q: 4 }, { gain: 0 }, { gain: 0 }, { gain: 0 }, { gain: 0 }],
      },
    },
    {
      id: 'dyneq6', name: 'DynEQ-6', model: 'F6', kind: 'eq', proc: 'ea-eq', dynamic: true, source: 'mix',
      tagline: 'Dynamic EQ',
      about: 'A 6-band dynamic EQ: each band is an EQ and a compressor in one. A band only cuts (or boosts) when that frequency range gets louder than its threshold. It fixes problems only when they happen, leaving the rest of the sound untouched.',
      tryThis: [
        'Load "Tame low-mid buildup". Watch the live curve (solid) dip below the static curve (dashed) only on the busy parts.',
        'On band 5, set Range to −9 dB and slowly lower the threshold. Hear the hats and cymbals soften only when they get loud.',
        'Set Range positive on band 1 to make the kick bloom only when it hits. That’s upward dynamic EQ.',
      ],
      presets: {
        'Tame low-mid buildup': [{ gain: 0 }, { freq: 280, q: 1.4, thresh: -34, range: -9, attack: 15, release: 200 }, { gain: 0 }, { gain: 0 }, { gain: 0 }, { gain: 0 }],
        'Soften harsh highs': [{ gain: 0 }, { gain: 0 }, { gain: 0 }, { freq: 3500, q: 2, thresh: -40, range: -6, attack: 3, release: 120 }, { freq: 8000, q: 1.2, thresh: -42, range: -9, attack: 2, release: 100 }, { gain: 0 }],
        'Kick bloom (upward)': [{ type: 'bell', freq: 60, q: 1.4, thresh: -30, range: 6, attack: 2, release: 120 }, { gain: 0 }, { gain: 0 }, { gain: 0 }, { gain: 0 }, { gain: 0 }],
        'Vocal de-harsh': [{ gain: 0 }, { gain: 0 }, { gain: 0 }, { freq: 2800, q: 2.5, thresh: -38, range: -6, attack: 5, release: 150 }, { freq: 6500, q: 3, thresh: -42, range: -10, attack: 1, release: 80 }, { gain: 0 }],
      },
    },
    {
      id: 'comp1', name: 'Comp-1', model: 'C1 Compressor', kind: 'dyn', proc: 'ea-dyn', mode: 'comp', source: 'drums',
      tagline: 'Compressor', params: COMP_PARAMS,
      about: 'A compressor automatically turns the signal down when it gets louder than the threshold. That makes the loud and quiet parts closer together. Use it to control peaks, add punch, glue a mix together, or bring out sustain.',
      tryThis: [
        'Start with ratio 4:1 and pull the threshold down until the GR meter shows 3–6 dB on the hits. Then use Makeup to match the bypass level.',
        'With heavy compression, sweep Attack from 0.1 ms to 50 ms. Hear the snare go from soft and flat to cracking and punchy.',
        'Sweep Release from 10 ms to 1 s. Fast release makes the room and cymbals "breathe" back up between hits.',
      ],
      presets: {
        'Gentle glue': { threshold: -18, ratio: 2, attack: 30, release: 200, knee: 6, makeup: 2, scHp: 20 },
        'Punchy drums (slow attack)': { threshold: -30, ratio: 4, attack: 30, release: 120, knee: 3, makeup: 5, scHp: 20 },
        'Drum smash': { threshold: -38, ratio: 12, attack: 0.3, release: 60, knee: 0, makeup: 12, scHp: 20 },
        'Vocal leveler': { threshold: -26, ratio: 3, attack: 5, release: 150, knee: 6, makeup: 5, scHp: 100 },
        'Limiter-ish': { threshold: -12, ratio: 20, attack: 0.1, release: 50, knee: 0, makeup: 6, scHp: 20 },
      },
    },
    {
      id: 'gate1', name: 'Gate-1', model: 'C1 Gate', kind: 'dyn', proc: 'ea-dyn', mode: 'gate', source: 'vocal',
      tagline: 'Gate / Expander', params: GATE_PARAMS,
      toggles: [{ key: 'type', label: 'Mode', def: 'gate', options: [['gate', 'Gate'], ['expand', 'Expander']], help: 'A gate shuts the signal off below the threshold. An expander turns it down gradually (by the ratio), which sounds more natural.' }],
      about: 'A gate is the opposite of a compressor. It turns the signal down when it gets quieter than the threshold. Use it to remove hiss, hum and bleed between notes, or to tighten drums. The vocal source has a quiet hiss-and-hum floor between phrases to clean up.',
      tryThis: [
        'On the Vocal source, raise the threshold until the hiss between phrases disappears but the words don’t get chopped.',
        'Set a long Release (500 ms+) and hear the tail fade naturally. Then make it 5 ms and hear it get cut off.',
        'Switch to Expander with a 2:1 ratio and 15 dB range for a gentler, more natural cleanup.',
      ],
      presets: {
        'Noise cleanup': { type: 'gate', threshold: -32, range: 40, ratio: 2, attack: 1, hold: 60, release: 250, scHp: 20, scLp: 20000 },
        'Tight drum gate': { type: 'gate', threshold: -26, range: 60, ratio: 2, attack: 0.2, hold: 15, release: 60, scHp: 120, scLp: 20000 },
        'Gentle expander': { type: 'expand', threshold: -32, range: 18, ratio: 2, attack: 2, hold: 40, release: 200, scHp: 20, scLp: 20000 },
        'Chopper (too much!)': { type: 'gate', threshold: -18, range: 80, ratio: 2, attack: 0.05, hold: 0, release: 5, scHp: 20, scLp: 20000 },
      },
    },
    {
      id: 'deess', name: 'De-Esser', model: 'DeEsser', kind: 'deess', proc: 'ea-deess', source: 'vocal',
      tagline: 'De-esser', params: DEESS_PARAMS,
      toggles: [
        { key: 'mode', label: 'Mode', def: 'split', options: [['split', 'Split'], ['wide', 'Wideband']], help: 'Split turns down only the high frequencies above the de-ess frequency. Wideband turns down the whole signal, which is more natural on gentle settings but can duck the whole vocal.' },
        { key: 'filter', label: 'Sidechain', def: 'hp', options: [['hp', 'High-pass'], ['bp', 'Band-pass']], help: 'High-pass reacts to everything above the frequency. Band-pass reacts only around the frequency, for targeting one harsh spot.' },
        { key: 'audition', label: 'Monitor', def: 'off', options: [['off', 'Output'], ['on', 'Audition SC']], help: 'Audition lets you hear only what the de-esser is listening to. Sweep the frequency until you hear mostly "sss".' },
      ],
      about: 'A de-esser is a compressor that only listens to the harsh "s", "sh" and "t" sounds in a vocal and turns them down when they jump out. It’s a fast, frequency-focused compressor.',
      tryThis: [
        'Turn on Audition SC and sweep the frequency until you hear mostly the "s" sounds, then switch back to Output.',
        'Lower the threshold until the reduction meter hits 4–8 dB on each "s". Toggle B to hear the difference.',
        'Push Range to 24 dB with a low threshold to hear the "lisp" effect of over-de-essing.',
      ],
      presets: {
        'Natural vocal': { freq: 6500, threshold: -34, range: 6, mode: 'split', filter: 'hp', audition: 'off' },
        'Aggressive': { freq: 5500, threshold: -44, range: 14, mode: 'split', filter: 'hp', audition: 'off' },
        'Wideband gentle': { freq: 7000, threshold: -36, range: 5, mode: 'wide', filter: 'bp', audition: 'off' },
        'Lisp (overdone)': { freq: 4500, threshold: -55, range: 24, mode: 'split', filter: 'hp', audition: 'off' },
      },
    },
  ];
  const PL = Object.fromEntries(PLUGINS.map((p) => [p.id, p]));

  function defaultState(pl) {
    if (pl.kind === 'eq') return { out: 0, bands: defaultBands() };
    const st = {};
    pl.params.forEach((p) => { st[p.key] = p.def; });
    (pl.toggles || []).forEach((t) => { st[t.key] = t.def; });
    return st;
  }
  const state = Object.fromEntries(PLUGINS.map((p) => [p.id, defaultState(p)]));

  function applyPreset(pl, preset) {
    const st = defaultState(pl);
    if (pl.kind === 'eq') st.bands = st.bands.map((b, i) => ({ ...b, ...(preset[i] || {}) }));
    else Object.assign(st, preset);
    state[pl.id] = st;
  }

  // ------------------------------------------------------------ audio graph
  let root = null, mounted = false, current = 'eq6', sourceId = null, bypass = false, selBand = 2;
  let src = null, playing = false, inGain = null, analyser = null, outGain = null, moduleReady = null;
  const nodes = {};
  let meter = {}, disp = { in: -90, out: -90, gr: 0 }, raf = 0, specBuf = null, drag = null, cvDrag = null;

  function message(id) {
    const pl = PL[id], st = state[id];
    if (pl.kind === 'eq') return { bypass, out: st.out, bands: st.bands.map((b) => ({ ...b, dyn: pl.dynamic })) };
    if (pl.id === 'comp1') return { bypass, mode: 'comp', ...st, scLp: 20000 };
    if (pl.id === 'gate1') return { bypass, ...st, mode: st.type === 'expand' ? 'expand' : 'gate', makeup: 0, knee: 0 };
    return { bypass, freq: st.freq, threshold: st.threshold, range: st.range, split: st.mode === 'split', bp: st.filter === 'bp', audition: st.audition === 'on' };
  }
  const send = () => { if (nodes[current]) nodes[current].port.postMessage(message(current)); };

  async function ensureGraph() {
    const ctx = audio.ensure();
    if (!ctx.audioWorklet) throw new Error('This browser blocks real-time plugins when the app is opened directly as a file.');
    if (!moduleReady) moduleReady = ctx.audioWorklet.addModule(pluginDsp.moduleUrl());
    await moduleReady;
    if (!inGain) {
      inGain = ctx.createGain();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0.82;
      specBuf = new Float32Array(analyser.frequencyBinCount);
      outGain = ctx.createGain();
      analyser.connect(outGain);
      outGain.connect(audio.master);
    }
    connectCurrent();
  }

  function getNode(id) {
    if (!nodes[id]) {
      const n = new AudioWorkletNode(audio.ctx, PL[id].proc, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      n.port.onmessage = (e) => { if (current === id) meter = e.data; };
      nodes[id] = n;
    }
    return nodes[id];
  }

  function connectCurrent() {
    if (!inGain) return;
    inGain.disconnect();
    Object.values(nodes).forEach((n) => n.disconnect());
    const n = getNode(current);
    inGain.connect(n);
    n.connect(analyser);
    send();
  }

  async function startSource() {
    stopSource();
    const buf = await sources.get(sourceId);
    if (!mounted) return;
    const ctx = audio.ctx;
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(inGain);
    src.start();
    playing = true;
  }
  function stopSource() {
    if (src) { try { src.stop(); } catch (e) { /* stopped */ } src.disconnect(); src = null; }
    playing = false;
  }

  async function togglePlay() {
    if (playing) { stopSource(); renderTransport(); return; }
    try {
      await ensureGraph();
      await startSource();
    } catch (e) {
      console.error(e);
      alert('Could not start the audio engine: ' + (e.message || e) + '\nTry opening the app through the local server (see README).');
    }
    renderTransport();
  }

  // ------------------------------------------------------------ param access
  function spec(key) {
    const pl = PL[current];
    if (pl.kind === 'eq') return key === 'out' ? OUT_P : EQ_P[key.slice(2)];
    return pl.params.find((p) => p.key === key);
  }
  function getV(key) {
    const st = state[current];
    return key.startsWith('b.') ? st.bands[selBand][key.slice(2)] : st[key];
  }
  function setV(key, v) {
    const st = state[current];
    if (key.startsWith('b.')) st.bands[selBand][key.slice(2)] = v;
    else st[key] = v;
    send();
  }
  const toNorm = (p, v) => (p.scale === 'log' ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromNorm = (p, n) => {
    n = clamp(n, 0, 1);
    const v = p.scale === 'log' ? p.min * Math.pow(p.max / p.min, n) : p.min + (p.max - p.min) * n;
    return clamp(p.step ? Math.round(v / p.step) * p.step : v, p.min, p.max);
  };

  // ------------------------------------------------------------ knobs
  const polar = (a, r) => [32 + r * Math.sin((a * Math.PI) / 180), 32 - r * Math.cos((a * Math.PI) / 180)];
  function arc(a0, a1, r) {
    if (a1 < a0) [a0, a1] = [a1, a0];
    if (a1 - a0 < 0.5) a1 = a0 + 0.5;
    const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  function knobGeom(p, v) {
    const ang = -135 + 270 * toNorm(p, v);
    const start = p.bipolar ? -135 + 270 * toNorm(p, 0) : -135;
    const [px, py] = polar(ang, 17);
    return { val: arc(start, ang, 24), px, py };
  }
  function knobHTML(key, extra = '') {
    const p = spec(key), v = getV(key), g = knobGeom(p, v);
    return `<div class="knob ${extra}" data-knob="${key}" tabindex="0" role="slider" aria-label="${esc(p.label)}" aria-valuetext="${esc(p.fmt(v))}">
      <svg viewBox="0 0 64 64"><path class="kb-track" d="${arc(-135, 135, 24)}"/><path class="kb-val" d="${g.val}"/><circle class="kb-cap" cx="32" cy="32" r="15"/><line class="kb-ptr" x1="32" y1="32" x2="${g.px.toFixed(2)}" y2="${g.py.toFixed(2)}"/></svg>
      <div class="kb-value">${esc(p.fmt(v))}</div><div class="kb-label">${esc(p.label)}</div>
    </div>`;
  }
  function updateKnob(el) {
    const key = el.dataset.knob, p = spec(key);
    if (!p) return;
    const v = getV(key), g = knobGeom(p, v);
    el.querySelector('.kb-val').setAttribute('d', g.val);
    const ptr = el.querySelector('.kb-ptr');
    ptr.setAttribute('x2', g.px.toFixed(2));
    ptr.setAttribute('y2', g.py.toFixed(2));
    el.querySelector('.kb-value').textContent = p.fmt(v);
    el.setAttribute('aria-valuetext', p.fmt(v));
  }
  const updateAllKnobs = () => root.querySelectorAll('.knob').forEach(updateKnob);

  function segHTML(key, options, value, help, cls = '') {
    return `<div class="seg ${cls}" data-help="${esc(help || '')}">${options.map(([v, label]) => `<button class="${String(value) === String(v) ? 'sel' : ''}" data-set="${key}" data-val="${v}">${esc(label)}</button>`).join('')}</div>`;
  }

  // ------------------------------------------------------------ rendering
  function mount(el) {
    root = el;
    mounted = true;
    if (!sourceId) sourceId = PL[current].source;
    el.innerHTML = `
      <section class="sandbox" id="sb">
        <div class="sb-intro">
          <div class="eyebrow">Free play</div>
          <h1>Sandbox</h1>
          <p class="muted">Real-time processors modeled on the classic Waves tools. Turn the knobs, drag the EQ points, and press <kbd>B</kbd> to bypass and compare. <kbd>Space</kbd> plays and stops.</p>
        </div>
        <div class="card sb-transport" id="sbTransport"></div>
        <div class="plugin-tabs" id="sbTabs"></div>
        <div class="sb-main">
          <div class="card plugin" id="sbPlugin"></div>
          <aside class="card learn" id="sbLearn"></aside>
        </div>
        <input type="file" id="sbFile" accept="audio/*,.mp3,.wav,.wave,.aif,.aiff,.aifc,.m4a,.mp4,.aac,.flac,.ogg,.oga,.opus,.webm,.caf" hidden>
      </section>`;
    const sb = el.querySelector('#sb');
    sb.addEventListener('click', onClick);
    sb.addEventListener('change', onChange);
    sb.addEventListener('pointerdown', onPointerDown);
    sb.addEventListener('pointermove', onPointerMove);
    sb.addEventListener('pointerup', onPointerUp);
    sb.addEventListener('pointercancel', onPointerUp);
    sb.addEventListener('dblclick', onDblClick);
    sb.addEventListener('wheel', onWheel, { passive: false });
    sb.addEventListener('keydown', onKnobKey);
    sb.addEventListener('mouseover', onHover);
    sb.addEventListener('focusin', onHover);
    window.addEventListener('keydown', onKey);
    renderTransport();
    renderTabs();
    renderPlugin();
    renderLearn();
    raf = requestAnimationFrame(frame);
  }

  function unmount() {
    mounted = false;
    cancelAnimationFrame(raf);
    stopSource();
    window.removeEventListener('keydown', onKey);
  }

  function renderTransport() {
    const t = root && root.querySelector('#sbTransport');
    if (!t) return;
    t.innerHTML = `
      <button class="play ${playing ? 'on' : ''}" data-sb="play" aria-label="${playing ? 'Stop' : 'Play'}">${playing
        ? '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'}</button>
      <div class="sb-src">
        <div class="sb-label">Source</div>
        <div class="seg wrap">${sources.list.map((s) => `<button class="${sourceId === s.id ? 'sel' : ''}" data-src="${s.id}">${esc(s.id === 'user' && sources.userName ? sources.userName.slice(0, 18) : s.name)}</button>`).join('')}</div>
      </div>
      <button class="bypass ${bypass ? 'on' : ''}" data-sb="bypass" title="Bypass (B)"><span class="led"></span>${bypass ? 'Bypassed' : 'Active'} <kbd>B</kbd></button>`;
  }

  function renderTabs() {
    root.querySelector('#sbTabs').innerHTML = PLUGINS.map((p) => `
      <button class="ptab ${p.id === current ? 'sel' : ''}" data-plugin="${p.id}">
        <strong>${esc(p.name)}</strong><span>${esc(p.tagline)}</span>
      </button>`).join('');
  }

  function renderLearn() {
    const pl = PL[current];
    root.querySelector('#sbLearn').innerHTML = `
      <div class="eyebrow">Modeled on Waves ${esc(pl.model)}</div>
      <h3>What it does</h3>
      <p class="about">${esc(pl.about)}</p>
      <h3>Try this</h3>
      <ol>${pl.tryThis.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="help-box" id="sbHelp"><span class="muted">Hover over or turn any control to see what it does.</span></div>`;
  }

  function showHelp(label, text) {
    const h = root.querySelector('#sbHelp');
    if (h && text) h.innerHTML = `<strong>${esc(label)}</strong><p>${esc(text)}</p>`;
  }

  function renderPlugin() {
    const pl = PL[current];
    const presets = Object.keys(pl.presets);
    let body = '';
    if (pl.kind === 'eq') {
      body = `<canvas class="graph eq-graph" data-cv></canvas>
        <p class="graph-hint">Drag a numbered point to set frequency and gain · scroll over it to change Q${pl.dynamic ? ' · dashed = static curve, solid = live dynamic curve' : ''}</p>
        <div class="band-tabs" id="bandTabs"></div>
        <div class="band-ui" id="bandUi"></div>`;
    } else if (pl.kind === 'dyn') {
      body = `<div class="dyn-top">
          <canvas class="graph transfer" data-cv></canvas>
          ${metersHTML(true)}
        </div>
        ${togglesHTML(pl)}
        <div class="knobs">${pl.params.map((p) => knobHTML(p.key, pl.id === 'gate1' && p.key === 'ratio' && state.gate1.type !== 'expand' ? 'disabled' : '')).join('')}</div>`;
    } else {
      body = `<canvas class="graph eq-graph" data-cv></canvas>
        <p class="graph-hint">The shaded area is what the de-esser listens to · drag on the graph to move the frequency</p>
        <div class="deess-row">${togglesHTML(pl)}${metersHTML(false)}</div>
        <div class="knobs">${pl.params.map((p) => knobHTML(p.key)).join('')}</div>`;
    }
    root.querySelector('#sbPlugin').innerHTML = `
      <div class="plugin-head">
        <div><h2>${esc(pl.name)}</h2><span class="muted">${esc(pl.tagline)} · modeled on Waves ${esc(pl.model)}</span></div>
        <div class="plugin-actions">
          <select data-preset aria-label="Presets"><option value="">Presets…</option>${presets.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
          <button class="btn sm" data-sb="reset">Reset</button>
        </div>
      </div>
      ${body}`;
    if (pl.kind === 'eq') { renderBandTabs(); renderBandUi(); }
  }

  function metersHTML(full) {
    return `<div class="meters">
      ${full ? '<div class="meter" data-m="in"><div class="m-bar"><i></i></div><span>IN</span></div>' : ''}
      <div class="meter gr" data-m="gr"><div class="m-bar"><i></i></div><span>GR</span></div>
      ${full ? '<div class="meter" data-m="out"><div class="m-bar"><i></i></div><span>OUT</span></div>' : ''}
      <div class="gr-read"><span>Gain reduction</span><strong data-gr>0.0 dB</strong>${current === 'gate1' ? '<div class="gate-led" data-gate>CLOSED</div>' : ''}</div>
    </div>`;
  }

  function togglesHTML(pl) {
    if (!pl.toggles) return '';
    return `<div class="toggles">${pl.toggles.map((t) => `<div class="tgl"><span class="sb-label">${esc(t.label)}</span>${segHTML(t.key, t.options, state[pl.id][t.key], t.help)}</div>`).join('')}</div>`;
  }

  function renderBandTabs() {
    const st = state[current];
    root.querySelector('#bandTabs').innerHTML = st.bands.map((b, i) => `
      <button class="band-tab ${i === selBand ? 'sel' : ''} ${b.on ? '' : 'off'}" data-band="${i}" style="--bc:${BAND_COLORS[i]}">
        <span class="bn">${i + 1}</span><span class="bt">${TYPE_SHORT[b.type]} ${fmtHzS(b.freq)}</span>
      </button>`).join('');
  }

  function renderBandUi() {
    const pl = PL[current], b = state[current].bands[selBand];
    const isCut = b.type === 'lowcut' || b.type === 'highcut';
    root.querySelector('#bandUi').innerHTML = `
      <div class="band-row" style="--bc:${BAND_COLORS[selBand]}">
        <button class="band-power ${b.on ? 'on' : ''}" data-set="b.on" data-val="${!b.on}" data-help="Turns this band on or off.">Band ${selBand + 1} ${b.on ? 'On' : 'Off'}</button>
        ${segHTML('b.type', BAND_TYPES, b.type, TYPE_HELP, 'types')}
      </div>
      <div class="knobs">
        ${knobHTML('b.freq')}${knobHTML('b.gain', isCut ? 'disabled' : '')}${knobHTML('b.q')}
        ${pl.dynamic ? `<span class="kdiv"></span>${['b.thresh', 'b.range', 'b.attack', 'b.release'].map((k) => knobHTML(k, isCut ? 'disabled' : '')).join('')}` : ''}
        <span class="kdiv"></span>${knobHTML('out')}
      </div>`;
  }

  // ------------------------------------------------------------ events
  function onClick(e) {
    const t = e.target;
    const sbBtn = t.closest('[data-sb]');
    if (sbBtn) {
      const a = sbBtn.dataset.sb;
      if (a === 'play') togglePlay();
      else if (a === 'bypass') toggleBypass();
      else if (a === 'reset') { state[current] = defaultState(PL[current]); renderPlugin(); send(); }
      return;
    }
    const srcBtn = t.closest('[data-src]');
    if (srcBtn) { setSource(srcBtn.dataset.src); return; }
    const plBtn = t.closest('[data-plugin]');
    if (plBtn) { switchPlugin(plBtn.dataset.plugin); return; }
    const bandBtn = t.closest('[data-band]');
    if (bandBtn) { selBand = +bandBtn.dataset.band; renderBandTabs(); renderBandUi(); return; }
    const setBtn = t.closest('[data-set]');
    if (setBtn) {
      let v = setBtn.dataset.val;
      if (v === 'true' || v === 'false') v = v === 'true';
      setV(setBtn.dataset.set, v);
      if (PL[current].kind === 'eq') { renderBandTabs(); renderBandUi(); } else renderPlugin();
    }
  }

  function onChange(e) {
    if (e.target.matches('[data-preset]')) {
      const name = e.target.value;
      if (!name) return;
      applyPreset(PL[current], PL[current].presets[name]);
      renderPlugin();
      send();
      showHelp(`Preset: ${name}`, 'Loaded. Press B to bypass and hear what it’s doing, then tweak from here.');
    } else if (e.target.id === 'sbFile') {
      const f = e.target.files[0];
      if (!f) return;
      sources.setUserFile(f).then(() => setSource('user')).catch(() => alert('Sorry, that file could not be decoded. Try a WAV, MP3, AAC or FLAC file.'));
    }
  }

  function setSource(id) {
    if (id === 'user' && !sources.hasUser()) { const fi = root.querySelector('#sbFile'); fi.value = ''; fi.click(); return; }
    sourceId = id;
    renderTransport();
    if (playing) startSource().then(renderTransport);
  }

  function switchPlugin(id) {
    if (id === current) return;
    current = id;
    meter = {};
    if (sourceId !== 'user' && PL[id].source !== sourceId) {
      sourceId = PL[id].source;
      if (playing) startSource().then(renderTransport);
    }
    connectCurrent();
    renderTransport();
    renderTabs();
    renderPlugin();
    renderLearn();
  }

  function toggleBypass() {
    bypass = !bypass;
    send();
    renderTransport();
  }

  function onKey(e) {
    if (!mounted || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === 'b') toggleBypass();
  }

  function onKnobKey(e) {
    const k = e.target.closest('.knob');
    if (!k || k.classList.contains('disabled')) return;
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const p = spec(k.dataset.knob);
    setV(p.key, fromNorm(p, toNorm(p, getV(p.key)) + dir * (e.shiftKey ? 0.05 : 0.01)));
    updateKnob(k);
    afterKnob(p.key);
  }

  function onHover(e) {
    const k = e.target.closest('.knob');
    if (k) { const p = spec(k.dataset.knob); if (p) showHelp(p.label, p.help); return; }
    const h = e.target.closest('[data-help]');
    if (h && h.dataset.help) {
      const label = h.closest('.tgl') ? h.closest('.tgl').querySelector('.sb-label').textContent : h.classList.contains('types') ? 'Band type' : 'Band power';
      showHelp(label, h.dataset.help);
    }
  }

  /** Keep secondary UI (band tab labels) in sync after a knob changes. */
  function afterKnob(key) {
    if (key === 'b.freq') {
      const tab = root.querySelector(`.band-tab[data-band="${selBand}"] .bt`);
      const b = state[current].bands[selBand];
      if (tab) tab.textContent = `${TYPE_SHORT[b.type]} ${fmtHzS(b.freq)}`;
    }
  }

  function onPointerDown(e) {
    const k = e.target.closest('.knob');
    if (k && !k.classList.contains('disabled')) {
      e.preventDefault();
      k.focus();
      k.setPointerCapture(e.pointerId);
      const p = spec(k.dataset.knob);
      drag = { el: k, p, y: e.clientY, n: toNorm(p, getV(p.key)) };
      showHelp(p.label, p.help);
      return;
    }
    const cv = e.target.closest('[data-cv]');
    if (cv) canvasDown(cv, e);
  }
  function onPointerMove(e) {
    if (drag) {
      const dy = drag.y - e.clientY;
      setV(drag.p.key, fromNorm(drag.p, drag.n + dy / (e.shiftKey ? 900 : 200)));
      updateKnob(drag.el);
      afterKnob(drag.p.key);
      return;
    }
    if (cvDrag) canvasMove(e);
  }
  function onPointerUp() { drag = null; cvDrag = null; }

  function onDblClick(e) {
    const k = e.target.closest('.knob');
    if (!k || k.classList.contains('disabled')) return;
    const p = spec(k.dataset.knob);
    setV(p.key, p.key.startsWith('b.') ? defaultBands()[selBand][p.key.slice(2)] : p.def);
    updateKnob(k);
    afterKnob(p.key);
  }

  function onWheel(e) {
    const k = e.target.closest('.knob');
    if (k && !k.classList.contains('disabled')) {
      e.preventDefault();
      const p = spec(k.dataset.knob);
      setV(p.key, fromNorm(p, toNorm(p, getV(p.key)) - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.015)));
      updateKnob(k);
      afterKnob(p.key);
      return;
    }
    const cv = e.target.closest('[data-cv]');
    if (cv && PL[current].kind === 'eq') {
      const i = nearestBand(cv, e);
      if (i < 0) return;
      e.preventDefault();
      if (i !== selBand) { selBand = i; renderBandTabs(); renderBandUi(); }
      const b = state[current].bands[i];
      b.q = clamp(b.q * Math.exp(-Math.sign(e.deltaY) * 0.08), 0.1, 10);
      send();
      updateAllKnobs();
    }
  }

  // ------------------------------------------------------------ graph geometry
  const FMIN = 20, FMAX = 20000, DBR = 18;
  const xOfF = (f, W) => (W * Math.log(f / FMIN)) / Math.log(FMAX / FMIN);
  const fOfX = (x, W) => FMIN * Math.pow(FMAX / FMIN, clamp(x / W, 0, 1));
  const yOfDb = (d, H) => H / 2 - (d * (H / 2 - 16)) / DBR;
  const dbOfY = (y, H) => ((H / 2 - y) * DBR) / (H / 2 - 16);

  function cvPoint(cv, e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
  }
  function nodePos(b, W, H) {
    const cut = b.type === 'lowcut' || b.type === 'highcut';
    return { x: xOfF(b.freq, W), y: yOfDb(cut ? 0 : b.gain, H) };
  }
  function nearestBand(cv, e) {
    const { x, y, W, H } = cvPoint(cv, e);
    let best = -1, bd = 18;
    state[current].bands.forEach((b, i) => {
      const p = nodePos(b, W, H);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function canvasDown(cv, e) {
    const pl = PL[current];
    if (pl.kind === 'eq') {
      const i = nearestBand(cv, e);
      if (i < 0) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      if (i !== selBand) { selBand = i; renderBandTabs(); renderBandUi(); }
      cvDrag = { cv, kind: 'eq' };
      showHelp('Band ' + (i + 1), 'Drag left/right for frequency and up/down for gain. Scroll to change the Q (width).');
    } else if (pl.kind === 'deess') {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      cvDrag = { cv, kind: 'deess' };
      canvasMove(e);
    }
  }
  function canvasMove(e) {
    const { cv, kind } = cvDrag;
    const { x, y, W, H } = cvPoint(cv, e);
    if (kind === 'eq') {
      const b = state[current].bands[selBand];
      b.freq = Math.round(clamp(fOfX(x, W), 20, 20000));
      if (b.type !== 'lowcut' && b.type !== 'highcut') b.gain = Math.round(clamp(dbOfY(y, H), -18, 18) * 10) / 10;
      afterKnob('b.freq');
    } else {
      state.deess.freq = Math.round(clamp(fOfX(x, W), 2000, 16000));
    }
    send();
    updateAllKnobs();
  }

  // ------------------------------------------------------------ drawing
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, W: w, H: h };
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function drawFreqGrid(g, W, H, dbLines) {
    g.font = '10px Inter, system-ui, sans-serif';
    g.lineWidth = 1;
    [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000].forEach((f) => {
      const x = Math.round(xOfF(f, W)) + 0.5;
      const major = [100, 1000, 10000].includes(f);
      g.strokeStyle = major ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    });
    g.fillStyle = 'rgba(235,238,245,0.45)';
    [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f, l]) => g.fillText(l, xOfF(f, W) + 3, H - 5));
    if (dbLines) {
      [-12, -6, 0, 6, 12].forEach((d) => {
        const y = Math.round(yOfDb(d, H)) + 0.5;
        g.strokeStyle = d === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.fillText((d > 0 ? '+' : '') + d, 4, y - 3);
      });
    }
  }

  function drawSpectrum(g, W, H) {
    if (!playing || !analyser) return;
    analyser.getFloatFrequencyData(specBuf);
    const sr = audio.ctx.sampleRate, binHz = sr / analyser.fftSize;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) {
      const f0 = fOfX(x, W), f1 = fOfX(x + 2, W);
      let b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
      let m = -140;
      for (let b = b0; b < b1 && b < specBuf.length; b++) if (specBuf[b] > m) m = specBuf[b];
      // tilt +3 dB/oct so pink-ish music looks flat
      m += 3 * Math.log2(f0 / 1000);
      const y = H - clamp((m + 90) / 75, 0, 1) * H * 0.8;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = 'rgba(57, 208, 255, 0.10)';
    g.fill();
    g.strokeStyle = 'rgba(57, 208, 255, 0.35)';
    g.lineWidth = 1;
    g.stroke();
  }

  function bandCoefs(b, extra, sr) {
    const cut = b.type === 'lowcut' || b.type === 'highcut';
    return biquadCoefs(b.type, b.freq, b.q, cut ? 0 : b.gain + extra, sr);
  }

  function drawEQ(cv) {
    const f = fit(cv);
    if (!f) return;
    const { g, W, H } = f;
    const pl = PL[current], st = state[current];
    const sr = audio.ctx ? audio.ctx.sampleRate : 48000;
    drawFreqGrid(g, W, H, true);
    drawSpectrum(g, W, H);
    const live = pl.dynamic && meter.bands && !bypass;
    const coefsStatic = st.bands.map((b) => (b.on ? bandCoefs(b, 0, sr) : null));
    const coefsLive = live ? st.bands.map((b, i) => (b.on ? bandCoefs(b, meter.bands[i] || 0, sr) : null)) : null;
    const curve = (coefs) => {
      const pts = [];
      for (let x = 0; x <= W; x += 2) {
        const fr = fOfX(x, W);
        let d = st.out;
        coefs.forEach((c) => { if (c) d += magDb(c, fr, sr); });
        pts.push([x, yOfDb(clamp(d, -DBR - 6, DBR + 6), H)]);
      }
      return pts;
    };
    const stroke = (pts, color, width, dash) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash || []);
      g.stroke();
      g.setLineDash([]);
    };
    // selected band's own shape
    const sb = st.bands[selBand];
    if (sb.on) {
      const own = [];
      for (let x = 0; x <= W; x += 3) own.push([x, yOfDb(clamp(magDb(coefsStatic[selBand], fOfX(x, W), sr), -DBR - 6, DBR + 6), H)]);
      g.beginPath();
      g.moveTo(0, yOfDb(0, H));
      own.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(W, yOfDb(0, H));
      g.closePath();
      g.fillStyle = BAND_COLORS[selBand] + '22';
      g.fill();
    }
    const accent = css('--accent') || '#c8ff3e';
    const staticPts = curve(coefsStatic);
    if (live) {
      stroke(staticPts, 'rgba(235,238,245,0.45)', 1.5, [5, 4]);
      stroke(curve(coefsLive), accent, 2.5);
    } else {
      stroke(staticPts, bypass ? 'rgba(235,238,245,0.35)' : accent, 2.5);
    }
    // nodes
    st.bands.forEach((b, i) => {
      const p = nodePos(b, W, H);
      g.beginPath();
      g.arc(p.x, p.y, i === selBand ? 11 : 9, 0, Math.PI * 2);
      g.fillStyle = b.on ? BAND_COLORS[i] : '#3a4157';
      g.globalAlpha = b.on ? 1 : 0.7;
      g.fill();
      g.globalAlpha = 1;
      if (i === selBand) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      g.fillStyle = '#0b0d12';
      g.font = '600 11px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), p.x, p.y + 0.5);
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
      if (live && b.on && Math.abs(meter.bands[i] || 0) > 0.2) {
        g.beginPath();
        g.arc(p.x, yOfDb(b.gain + meter.bands[i], H), 4, 0, Math.PI * 2);
        g.strokeStyle = BAND_COLORS[i];
        g.lineWidth = 2;
        g.stroke();
      }
    });
  }

  function drawTransfer(cv) {
    const f = fit(cv);
    if (!f) return;
    const { g, W, H } = f;
    const pl = PL[current], st = state[current];
    const p = message(current);
    const MIN = -72, M = 26;
    const plotW = W - M - 8, plotH = H - M - 8;
    const X = (d) => M + ((d - MIN) / -MIN) * plotW;
    const Y = (d) => 8 + (1 - (clamp(d, MIN, 0) - MIN) / -MIN) * plotH;
    g.font = '10px Inter, system-ui, sans-serif';
    g.fillStyle = 'rgba(235,238,245,0.45)';
    for (let d = MIN; d <= 0; d += 12) {
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(X(d), 8); g.lineTo(X(d), 8 + plotH); g.stroke();
      g.beginPath(); g.moveTo(M, Y(d)); g.lineTo(M + plotW, Y(d)); g.stroke();
      g.fillText(String(d), 2, Y(d) + 3);
      g.fillText(String(d), X(d) - 8, H - 4);
    }
    // unity line
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(X(MIN), Y(MIN)); g.lineTo(X(0), Y(0)); g.stroke();
    // threshold
    g.strokeStyle = 'rgba(255,181,71,0.5)';
    g.beginPath(); g.moveTo(X(p.threshold), 8); g.lineTo(X(p.threshold), 8 + plotH); g.stroke();
    g.setLineDash([]);
    // curve
    const accent = css('--accent') || '#c8ff3e';
    g.beginPath();
    for (let d = MIN; d <= 0; d += 0.5) {
      const out = d + staticGain(p, d) + (p.makeup || 0);
      d === MIN ? g.moveTo(X(d), Y(out)) : g.lineTo(X(d), Y(out));
    }
    g.strokeStyle = bypass ? 'rgba(235,238,245,0.35)' : accent;
    g.lineWidth = 2.5;
    g.stroke();
    // live dot
    if (playing && meter.lvl !== undefined && meter.lvl > MIN) {
      const xin = clamp(meter.lvl, MIN, 0);
      const yout = xin + (bypass ? 0 : (meter.g || 0) + (p.makeup || 0));
      g.beginPath();
      g.arc(X(xin), Y(yout), 6, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
    }
    g.fillStyle = 'rgba(235,238,245,0.55)';
    g.fillText('IN (dB) →', M + plotW - 54, 8 + plotH - 6);
    g.save();
    g.translate(M + 10, 18);
    g.fillText('OUT', 0, 0);
    g.restore();
    void pl; void st;
  }

  function drawDeEss(cv) {
    const f = fit(cv);
    if (!f) return;
    const { g, W, H } = f;
    const st = state.deess;
    drawFreqGrid(g, W, H, false);
    drawSpectrum(g, W, H);
    const x0 = xOfF(st.freq, W);
    g.fillStyle = 'rgba(255, 111, 174, 0.14)';
    if (st.filter === 'bp') {
      const lo = xOfF(st.freq / Math.pow(2, 0.36), W), hi = xOfF(st.freq * Math.pow(2, 0.36), W);
      g.fillRect(lo, 0, hi - lo, H);
    } else g.fillRect(x0, 0, W - x0, H);
    g.strokeStyle = '#ff6fae';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, H); g.stroke();
    g.fillStyle = '#ff6fae';
    g.font = '600 12px Inter, system-ui, sans-serif';
    g.fillText(fmtHz(st.freq), Math.min(x0 + 6, W - 60), 16);
    const gr = bypass ? 0 : meter.gr || 0;
    if (gr < -0.3) {
      g.fillStyle = 'rgba(255, 93, 108, 0.9)';
      g.fillText(`↓ ${(-gr).toFixed(1)} dB`, Math.min(x0 + 6, W - 60), 32);
    }
  }

  const lin2db = (v) => (v > 0 ? 20 * Math.log10(v) : -90);

  function updateMeters() {
    const fall = 1.2;
    disp.in = Math.max(lin2db(meter.inPk || 0), disp.in - fall);
    disp.out = Math.max(lin2db(meter.outPk || 0), disp.out - fall);
    const gr = playing && !bypass ? meter.gr || 0 : 0;
    disp.gr = Math.min(gr, disp.gr + 0.6);
    const set = (k, h) => { const el = root.querySelector(`[data-m="${k}"] i`); if (el) el.style.height = (clamp(h, 0, 1) * 100).toFixed(1) + '%'; };
    set('in', (disp.in + 60) / 60);
    set('out', (disp.out + 60) / 60);
    set('gr', -disp.gr / (current === 'gate1' ? Math.max(12, state.gate1.range) : 24));
    const t = root.querySelector('[data-gr]');
    if (t) t.textContent = `${disp.gr < -0.05 ? '−' : ''}${Math.abs(disp.gr).toFixed(1)} dB`;
    const led = root.querySelector('[data-gate]');
    if (led) {
      const open = playing && (bypass || (meter.g !== undefined && meter.g > -3));
      led.classList.toggle('open', open);
      led.textContent = open ? 'OPEN' : 'CLOSED';
    }
  }

  function frame() {
    if (!mounted) return;
    raf = requestAnimationFrame(frame);
    if (!playing) { meter = PL[current].kind === 'eq' ? {} : { ...meter, inPk: 0, outPk: 0, gr: 0 }; }
    const cv = root.querySelector('[data-cv]');
    const kind = PL[current].kind;
    if (cv) {
      if (kind === 'eq') drawEQ(cv);
      else if (kind === 'dyn') drawTransfer(cv);
      else drawDeEss(cv);
    }
    if (kind !== 'eq') updateMeters();
  }

  return { mount, unmount, PLUGINS };
})();

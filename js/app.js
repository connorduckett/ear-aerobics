/* Ear Aerobics — UI, routing and session flow. */
(() => {
  'use strict';
  const { audio, sources, exercises, store } = EA;
  const app = document.getElementById('app');

  const CATS = [
    { id: 'eq', name: 'EQ & Frequency', blurb: 'Find boosts, cuts, filters and tones across the spectrum.' },
    { id: 'level', name: 'Level', blurb: 'Judge gain changes down to half a dB.' },
    { id: 'stereo', name: 'Stereo Image', blurb: 'Pinpoint where a sound sits between the speakers.' },
    { id: 'dyn', name: 'Dynamics', blurb: 'Hear what a compressor is doing to the signal.' },
  ];
  const catById = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const LEVELS = ['Easy', 'Medium', 'Hard', 'Pro'];
  const XP_MULT = [1, 1.5, 2, 3];
  const PRAISE = ['Nailed it.', 'Golden ears.', 'Spot on.', 'Clean hit.', 'Dialed in.', 'That’s the one.'];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ICONS = {
    peak: '<path d="M2 17C7 17 8 16 10 12C11 9 11.5 5 12 5S13 9 14 12C16 16 17 17 22 17"/>',
    dip: '<path d="M2 7C7 7 8 8 10 12C11 15 11.5 19 12 19S13 15 14 12C16 8 17 7 22 7"/>',
    filter: '<path d="M2 20C6 20 7 8 11 7H22"/>',
    tone: '<path d="M2 12C4 5 6 5 8 12S12 19 14 12S18 5 20 12L22 12"/>',
    gain: '<path d="M8 3v18M16 3v18"/><rect x="5" y="13" width="6" height="4" rx="1"/><rect x="13" y="6" width="6" height="4" rx="1"/>',
    pan: '<path d="M5 18a9 9 0 1 1 14 0"/><path d="M12 13l4-5"/>',
    squeeze: '<path d="M12 2v6M9 5l3 3 3-3M12 22v-6M9 19l3-3 3 3M4 12h16"/>',
    comp: '<path d="M3 21L12 12L21 8"/><path d="M3 3v18h18" opacity=".35"/>',
    attack: '<path d="M3 19H7L9 5L21 12"/>',
    release: '<path d="M3 19H6L8 5C12 5 14 19 21 19"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  let view = 'home';
  let setup = null;
  let session = null;
  let lastResults = null;
  let token = 0;

  // ---------------------------------------------------------------- helpers
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyWorkout() {
    const r = rng('ea-' + store.today());
    return CATS.map((cat) => {
      const pool = exercises.list.filter((e) => e.cat === cat.id);
      const ex = pool[Math.floor(r() * pool.length)];
      return { exId: ex.id, level: store.ex(ex.id).unlocked };
    });
  }

  const pct = (pts, n) => (n ? Math.round((100 * pts) / n) : 0);
  const gradeClass = (g) => (g >= 0.8 ? 'good' : g >= 0.3 ? 'close' : 'bad');

  // continuous axis helpers
  const axisPos = (ax, v) => (ax.kind === 'log' ? Math.log(v / ax.min) / Math.log(ax.max / ax.min) : (v - ax.min) / (ax.max - ax.min));
  const axisVal = (ax, p) => {
    p = Math.min(1, Math.max(0, p));
    return ax.snap(ax.kind === 'log' ? ax.min * Math.pow(ax.max / ax.min, p) : ax.min + (ax.max - ax.min) * p);
  };
  const posPct = (ax, v) => (Math.min(1, Math.max(0, axisPos(ax, v))) * 100).toFixed(3) + '%';

  // ---------------------------------------------------------------- routing
  function route() {
    const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
    const target = parts[0] || 'home';
    if (target !== 'session' && session) {
      audio.clear();
      session = null;
      token++;
    }
    if (view === 'sandbox' && target !== 'sandbox') EA.sandbox.unmount();
    const navKey = target === 'progress' || target === 'sandbox' ? target : 'home';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey));

    if (target === 'sandbox') {
      if (view !== 'sandbox') {
        audio.clear();
        view = 'sandbox';
        EA.sandbox.mount(app);
      }
    } else if (target === 'ex' && exercises.byId[parts[1]]) {
      view = 'setup';
      renderSetup(parts[1]);
    } else if (target === 'session' && session) {
      view = 'session';
      renderSession();
    } else if (target === 'results' && lastResults) {
      view = 'results';
      renderResults();
    } else if (target === 'progress') {
      view = 'progress';
      renderProgress();
    } else {
      view = 'home';
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- home
  function renderHome() {
    const d = store.data;
    const L = store.level();
    const wo = dailyWorkout();
    const done = d.workoutDay === store.today();
    const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    app.innerHTML = `
      <section class="hero">
        <div class="card workout">
          <div class="eyebrow">Daily workout · ${esc(dateLabel)}</div>
          <h1>${done ? 'Workout done. <span class="hl">Nice ears.</span>' : 'Warm up your <span class="hl">ears.</span>'}</h1>
          <p class="muted">Four quick drills, one from each muscle group. Five questions each, about five minutes.</p>
          <ul class="wo-list">
            ${wo.map((it) => {
              const ex = exercises.byId[it.exId];
              return `<li class="cat-${ex.cat}"><span class="wo-icon">${icon(ex.icon)}</span><span>${esc(ex.name)}</span><span class="chip">${LEVELS[it.level]}</span></li>`;
            }).join('')}
          </ul>
          <button class="btn primary lg" data-action="start-workout">${done ? 'Run it again' : 'Start workout'} <span aria-hidden="true">→</span></button>
        </div>
        <div class="card stats">
          <div class="lvl">
            <div class="lvl-badge"><span>LVL</span><strong>${L.lvl}</strong></div>
            <div class="lvl-info">
              <div class="lvl-xp"><strong>${d.xp}</strong> XP <span class="muted">· ${L.next - d.xp} to level ${L.lvl + 1}</span></div>
              <div class="bar"><i style="width:${Math.round(L.pct * 100)}%"></i></div>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat"><strong>${d.streak || 0}</strong><span>day streak</span></div>
            <div class="stat"><strong>${d.answered ? pct(d.points, d.answered) + '%' : '—'}</strong><span>accuracy</span></div>
            <div class="stat"><strong>${d.answered}</strong><span>reps</span></div>
          </div>
          <p class="safety">Use headphones or monitors at a comfortable level. Start the volume low. Boosts can be loud.</p>
        </div>
      </section>
      ${CATS.map((cat) => `
        <section class="cat-section cat-${cat.id}">
          <div class="cat-head"><h2>${cat.name}</h2><p class="muted">${cat.blurb}</p></div>
          <div class="ex-grid">
            ${exercises.list.filter((e) => e.cat === cat.id).map(exCard).join('')}
          </div>
        </section>`).join('')}
    `;
  }

  function exCard(ex) {
    const s = store.ex(ex.id);
    const best = Math.max(...s.best);
    return `
      <a class="ex-card cat-${ex.cat}" href="#/ex/${ex.id}">
        <div class="ex-icon">${icon(ex.icon)}</div>
        <div class="ex-body">
          <h3>${esc(ex.name)}</h3>
          <p>${esc(ex.blurb)}</p>
        </div>
        <div class="ex-meta">
          <div class="pips" title="${LEVELS[s.unlocked]} unlocked">${[0, 1, 2, 3].map((i) => `<i class="${i <= s.unlocked ? 'on' : ''}"></i>`).join('')}</div>
          <span>${s.sessions ? 'Best ' + best + '%' : 'New'}</span>
        </div>
      </a>`;
  }

  // ---------------------------------------------------------------- setup
  function renderSetup(id) {
    const ex = exercises.byId[id];
    const st = store.ex(id);
    if (!setup || setup.exId !== id) setup = { exId: id, level: st.unlocked, source: ex.defaultSource || 'mix', count: 10 };
    if (setup.level > st.unlocked) setup.level = st.unlocked;

    app.innerHTML = `
      <section class="setup cat-${ex.cat}">
        <a class="back" href="#/">← Gym</a>
        <div class="setup-head">
          <div class="ex-icon lg">${icon(ex.icon)}</div>
          <div>
            <div class="eyebrow">${catById[ex.cat].name}</div>
            <h1>${esc(ex.name)}</h1>
            <p class="muted">${esc(ex.blurb)}</p>
          </div>
        </div>
        <div class="setup-grid">
          <div class="card">
            <h3>Difficulty</h3>
            <div class="levels">
              ${ex.levels.map((l, i) => {
                const locked = i > st.unlocked;
                return `<button class="level ${i === setup.level ? 'sel' : ''}" ${locked ? 'disabled' : ''} data-action="set-level" data-i="${i}">
                  <span class="lv-name">${locked ? LOCK : ''}${LEVELS[i]}</span>
                  <span class="lv-desc">${esc(l.desc)}</span>
                  ${st.best[i] ? `<span class="lv-best">Best ${st.best[i]}%</span>` : ''}
                </button>`;
              }).join('')}
            </div>
            <p class="hint">Score ${Math.round(store.UNLOCK_PCT * 100)}% or better on a level to unlock the next one.</p>

            ${ex.noSource ? '' : `
              <h3>Sound source</h3>
              <div class="seg wrap">
                ${sources.list.map((s) => `<button class="${setup.source === s.id ? 'sel' : ''}" data-action="set-source" data-id="${s.id}">${s.name}</button>`).join('')}
              </div>
              <input type="file" id="userfile" accept="audio/*" hidden>
              ${setup.source === 'user' ? `<p class="hint file-hint">${sources.userName ? `Loaded: <strong>${esc(sources.userName)}</strong> · <a href="#" data-action="pick-file">change</a>` : '<a href="#" data-action="pick-file">Choose an audio file…</a>'}<br>A 12-second excerpt from about 30% into the song is used.</p>` : ''}
            `}

            <h3>Questions</h3>
            <div class="seg">
              ${[5, 10, 20].map((n) => `<button class="${setup.count === n ? 'sel' : ''}" data-action="set-count" data-n="${n}">${n}</button>`).join('')}
            </div>

            <button class="btn primary lg block" data-action="start">Start training <span aria-hidden="true">→</span></button>
          </div>
          <div class="card tips">
            <h3>What to listen for</h3>
            <ul>${ex.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            <h3>How it works</h3>
            <ul class="how">
              ${ex.mode === 'which'
                ? '<li>Press <kbd>Space</kbd> to play. Switch between <kbd>A</kbd> and <kbd>B</kbd> as often as you like.</li><li>Pick the one you think is compressed.</li>'
                : `<li>Press <kbd>Space</kbd> to play. Toggle <kbd>A</kbd> (${esc(ex.abLabels[0])}) and <kbd>B</kbd> (${esc(ex.abLabels[1])}) to compare.</li>${ex.continuous
                  ? '<li>Click or drag on the strip to place your answer, fine-tune with <kbd>←</kbd> <kbd>→</kbd>, then press <kbd>↵</kbd> to lock it in.</li><li>Points scale with how close you get. Dead on earns full credit.</li>'
                  : ex.layout === 'two' ? '<li>Pick which of the two amounts is the real change.</li>' : '<li>Choose your answer. Adjacent answers earn half credit.</li>'}`}
              ${ex.mode !== 'which' ? '<li>Missed it? A <kbd>C</kbd> button appears so you can hear <em>your</em> pick next to the real answer.</li>' : ''}
            </ul>
          </div>
        </div>
      </section>`;

    const input = document.getElementById('userfile');
    if (input) input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        await sources.setUserFile(f);
        setup.source = 'user';
      } catch (e) {
        alert('Sorry, that file could not be decoded. Try a WAV, MP3, AAC or FLAC file.');
      }
      renderSetup(id);
    });
  }

  // ---------------------------------------------------------------- session
  function startSession({ kind, title, items, source }) {
    audio.ensure();
    session = { kind, title, items, source, idx: 0, results: [], xp: 0, cur: null, lastAnswer: null };
    if (location.hash === '#/session') route();
    else location.hash = '#/session';
    prepareQuestion();
  }

  async function prepareQuestion() {
    const my = ++token;
    const item = session.items[session.idx];
    const ex = exercises.byId[item.exId];
    const L = ex.levels[item.level];
    let q;
    for (let k = 0; k < 8; k++) {
      q = ex.question(L);
      if (q.answer !== session.lastAnswer || (q.options && q.options.length < 3)) break;
    }
    session.lastAnswer = q.answer;
    session.cur = { ex, item, q, bufs: [], labels: [], loading: true, answered: false, choice: null, grade: null, error: null, pending: null };
    renderSession();

    try {
      const srcId = ex.noSource ? null : (session.source || ex.defaultSource || 'mix');
      const raw = srcId ? await sources.get(srcId) : null;
      const src = raw && ex.prep ? ex.prep(raw) : raw;
      const bufs = await exercises.build(ex, src, q);
      if (my !== token || !session) return;
      Object.assign(session.cur, { src, bufs, labels: ex.abLabels.slice(0, bufs.length), loading: false });
      audio.setBuffers(bufs, { active: ex.mode === 'ab' ? 1 : 0 });
      if (!audio.playing) audio.play();
      renderSession();
    } catch (e) {
      console.error(e);
      if (my !== token || !session) return;
      session.cur.loading = false;
      session.cur.error = e.message || String(e);
      renderSession();
    }
  }

  async function answer(v) {
    const cur = session && session.cur;
    if (!cur || cur.loading || cur.answered || cur.error) return;
    const { ex, q, item } = cur;
    cur.answered = true;
    cur.choice = v;
    cur.grade = exercises.grade(ex, q, v);
    const xp = Math.round(10 * XP_MULT[item.level] * cur.grade);
    session.xp += xp;
    session.results.push({ exId: ex.id, level: item.level, answer: q.answer, choice: v, grade: cur.grade, xp, ex });
    audio.sfx(cur.grade >= 0.5 ? 'good' : 'bad');

    const L = (x) => ex.longLabel(x, q);
    if (ex.mode === 'which') {
      cur.labels = cur.labels.map((l, i) => (i === q.answer ? `${l} · compressed` : `${l} · dry`));
    } else {
      cur.labels = [cur.labels[0], `${cur.labels[1]} · ${L(q.answer)}`];
    }
    renderSession();

    if (cur.grade < 1 && v !== q.answer && ex.mode !== 'which') {
      const my = token;
      try {
        const c = await exercises.buildPick(ex, cur.src, q, v, cur.bufs[0]);
        if (my !== token || !session || session.cur !== cur) return;
        EA.dsp.headroom([...cur.bufs, c]);
        cur.bufs = [...cur.bufs, c];
        cur.labels = [...cur.labels, `Your pick · ${L(v)}`];
        audio.setBuffers(cur.bufs);
        renderSession();
      } catch (e) { console.error(e); }
    }
  }

  function next() {
    if (!session || !session.cur || !session.cur.answered) return;
    session.idx++;
    if (session.idx >= session.items.length) finish();
    else prepareQuestion();
  }

  function finish() {
    audio.clear();
    const summary = store.recordSession(session);
    lastResults = { session, summary, setup: setup ? { ...setup } : null };
    session = null;
    location.hash = '#/results';
  }

  function feedbackHTML(cur) {
    const { ex, q, grade, choice } = cur;
    const right = ex.longLabel(q.answer, q);
    const last = session.idx === session.items.length - 1;
    const nextBtn = `<button class="btn primary" data-action="next">${last ? 'See results' : 'Next'} <kbd>↵</kbd></button>`;
    let cls, title, body;
    if (ex.continuous) {
      const ax = ex.axis;
      const dist = ax.distText(ax.dist(choice, q.answer));
      cls = gradeClass(grade);
      title = grade >= 0.95 ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : grade >= 0.6 ? 'Close.' : grade > 0 ? 'In the neighborhood.' : 'Not quite.';
      body = `Target <strong>${esc(right)}</strong> · you picked ${esc(ax.fmt(choice))} · ${dist} · <strong>${Math.round(grade * 100)}%</strong> credit`;
    } else if (grade === 1) {
      cls = 'good';
      title = PRAISE[Math.floor(Math.random() * PRAISE.length)];
      body = `It was <strong>${esc(right)}</strong>.`;
    } else if (grade > 0) {
      cls = 'close';
      title = 'So close.';
      body = `It was <strong>${esc(right)}</strong>, you picked ${esc(ex.longLabel(choice, q))}. Half credit.`;
    } else {
      cls = 'bad';
      title = 'Not quite.';
      body = ex.mode === 'which'
        ? `<strong>${esc(right)}</strong> was the compressed one.`
        : `It was <strong>${esc(right)}</strong>, you picked ${esc(ex.longLabel(choice, q))}.`;
    }
    const compare = ex.mode !== 'which' && grade < 1 && choice !== q.answer ?`<div class="compare-hint">Flip between <kbd>B</kbd> and <kbd>C</kbd> to hear the difference.</div>` : '';
    const xp = Math.round(10 * XP_MULT[cur.item.level] * grade);
    return `<div class="feedback ${cls}">
      <div><div class="fb-title">${title}${xp ? ` <span class="fb-xp">+${xp} XP</span>` : ''}</div><div class="fb-body">${body}</div>${compare}</div>
      ${nextBtn}
    </div>`;
  }

  function sliderHTML(cur) {
    const { ex, q } = cur;
    const ax = ex.axis;
    const at = (v) => posPct(ax, v);
    const ticks = ax.ticks.map((t) => `<i class="tk" style="left:${at(t)}"></i>`).join('') +
      ax.minor.map((t) => `<i class="tk minor" style="left:${at(t)}"></i>`).join('');
    let reveal = '';
    if (cur.answered) {
      const band = (w, cls) => {
        const lo = Math.max(0, axisPos(ax, ax.widen(q.answer, w, -1)));
        const hi = Math.min(1, axisPos(ax, ax.widen(q.answer, w, 1)));
        return `<div class="tol ${cls}" style="left:${(lo * 100).toFixed(3)}%;width:${((hi - lo) * 100).toFixed(3)}%"></div>`;
      };
      reveal = band(q.tol.zero, 'zero') + band(q.tol.perfect, 'perfect') +
        `<div class="mk target" style="left:${at(q.answer)}"><span>${esc(ax.fmt(q.answer))}</span></div>`;
    }
    const pickMk = cur.pending != null
      ? `<div class="mk pick ${cur.answered ? 'locked' : ''}" style="left:${at(cur.pending)}"><span>${esc(ax.fmt(cur.pending))}</span></div>`
      : '';
    const readout = cur.answered
      ? ''
      : cur.pending != null
        ? `Your pick: <strong>${esc(ax.fmt(cur.pending))}</strong> <span class="muted">· ← → to fine-tune</span>`
        : '<span class="muted">Click or drag on the strip to place your answer</span>';
    return `<div class="cslider ${ax.kind} ${cur.answered || cur.loading || cur.error ? 'inactive' : ''}">
        <div class="ctrack" data-track>${ticks}${reveal}${pickMk}<div class="ccursor" hidden><span></span></div></div>
        <div class="clabels">${ax.ticks.map((t) => `<span style="left:${at(t)}">${esc(ax.short(t))}</span>`).join('')}</div>
      </div>
      ${cur.answered ? '' : `<div class="cfoot"><div class="creadout">${readout}</div><button class="btn primary" data-action="submit" ${cur.pending == null || cur.loading || cur.error ? 'disabled' : ''}>Lock it in <kbd>↵</kbd></button></div>`}`;
  }

  function bindSlider() {
    const cur = session && session.cur;
    const track = app.querySelector('[data-track]');
    if (!cur || !track || cur.answered) return;
    const ax = cur.ex.axis;
    const cursor = track.querySelector('.ccursor');
    let dragging = false;
    const valAt = (e) => {
      const r = track.getBoundingClientRect();
      return axisVal(ax, (e.clientX - r.left) / r.width);
    };
    const showCursor = (v) => {
      cursor.hidden = false;
      cursor.style.left = posPct(ax, v);
      cursor.firstChild.textContent = ax.fmt(v);
    };
    track.addEventListener('pointermove', (e) => {
      if (cur.loading || cur.error) return;
      const v = valAt(e);
      showCursor(v);
      if (dragging) setPending(v);
    });
    track.addEventListener('pointerdown', (e) => {
      if (cur.loading || cur.error) return;
      dragging = true;
      track.setPointerCapture(e.pointerId);
      setPending(valAt(e));
    });
    track.addEventListener('pointerup', () => { dragging = false; });
    track.addEventListener('pointerleave', () => { if (!dragging) cursor.hidden = true; });
  }

  /** Update the pending marker in place (no full re-render, so dragging stays smooth). */
  function setPending(v) {
    const cur = session && session.cur;
    if (!cur || cur.answered) return;
    cur.pending = v;
    const ax = cur.ex.axis;
    const track = app.querySelector('[data-track]');
    if (!track) return;
    let mk = track.querySelector('.mk.pick');
    if (!mk) {
      mk = document.createElement('div');
      mk.className = 'mk pick';
      mk.innerHTML = '<span></span>';
      track.insertBefore(mk, track.querySelector('.ccursor'));
    }
    mk.style.left = posPct(ax, v);
    mk.firstChild.textContent = ax.fmt(v);
    const ro = app.querySelector('.creadout');
    if (ro) ro.innerHTML = `Your pick: <strong>${esc(ax.fmt(v))}</strong> <span class="muted">· ← → to fine-tune</span>`;
    const btn = app.querySelector('[data-action="submit"]');
    if (btn) btn.disabled = false;
  }

  function nudge(dir, big) {
    const cur = session.cur;
    const ax = cur.ex.axis;
    const start = cur.pending != null ? cur.pending : axisVal(ax, 0.5);
    let p = axisPos(ax, start);
    const step = (big ? 0.02 : 0.004) * dir;
    let v = start;
    for (let k = 0; k < 40 && v === start; k++) {
      p += step;
      v = axisVal(ax, p);
      if (p <= 0 || p >= 1) break;
    }
    setPending(v);
  }

  function answersHTML(cur) {
    const { ex, q } = cur;
    if (ex.continuous) return sliderHTML(cur);
    const disabled = cur.loading || cur.error;
    const btn = (v, i) => {
      let cls = '';
      if (cur.answered) {
        if (v === q.answer) cls = 'correct';
        else if (v === cur.choice) cls = cur.grade > 0 ? 'near' : 'wrong';
        else cls = 'dim';
      }
      const key = q.options.length <= 9 && !cur.answered ? `<kbd>${i + 1}</kbd>` : '';
      return `<button class="ans ${cls}" data-action="answer" data-i="${i}" ${disabled || cur.answered ? 'disabled' : ''}>${key}<span>${esc(ex.label(v, q))}</span></button>`;
    };
    if (ex.mode === 'which') {
      return `<div class="answers which">${q.options.map((v, i) => btn(v, i).replace(`<span>${ex.label(v, q)}</span>`, `<span>${ex.label(v, q)} is compressed</span>`)).join('')}</div>`;
    }
    if (ex.layout === 'two') {
      return `<div class="answers which">${q.options.map(btn).join('')}</div>`;
    }
    if (ex.layout === 'pan') {
      return `<div class="answers pan" style="--n:${q.options.length}">
        <div class="pan-ends"><span>L</span><span>C</span><span>R</span></div>
        <div class="pan-row">${q.options.map(btn).join('')}</div>
      </div>`;
    }
    const dense = q.options.length > 12 ? 'dense' : '';
    const unit = ex.cat === 'eq' ? '<div class="unit">Hz</div>' : ex.id === 'gain' ? '<div class="unit">dB change</div>' : ex.id === 'threshold' ? '<div class="unit">dB</div>' : '';
    return `<div class="answers grid ${dense} ${ex.layout === 'scale' ? 'scale' : ''}">${q.options.map(btn).join('')}</div>${unit}`;
  }

  function renderSession() {
    if (view !== 'session' || !session) return;
    const cur = session.cur;
    if (!cur) return;
    const { ex, item, q } = cur;
    const n = session.items.length;
    const segs = session.items.map((_, i) => {
      const r = session.results[i];
      const cls = r ? gradeClass(r.grade) : i === session.idx ? 'now' : '';
      return `<i class="${cls}"></i>`;
    }).join('');

    const transport = cur.loading
      ? `<div class="loading"><span class="spinner"></span>Preparing audio…</div>`
      : cur.error
        ? `<div class="error">${esc(cur.error)} <button class="btn" data-action="retry">Retry</button></div>`
        : `<div class="transport">
            <button class="play ${audio.playing ? 'on' : ''}" data-action="play" aria-label="${audio.playing ? 'Stop' : 'Play'}">${audio.playing ? STOP : PLAY}</button>
            <div class="ab">
              ${cur.labels.map((l, i) => `<button class="ab-btn ${i === audio.active ? 'active' : ''} ${i === 2 ? 'pick' : ''}" data-action="ab" data-i="${i}"><kbd>${'ABC'[i]}</kbd><span>${esc(l)}</span>${audio.playing && i === audio.active ? '<span class="eq-anim"><i></i><i></i><i></i></span>' : ''}</button>`).join('')}
            </div>
          </div>`;

    app.innerHTML = `
      <section class="session cat-${ex.cat}">
        <div class="sess-top">
          <button class="back" data-action="quit">✕ End session</button>
          <div class="sess-title">${session.kind === 'workout' ? '<span class="muted">Daily workout ·</span> ' : ''}${esc(ex.name)} <span class="chip">${LEVELS[item.level]}</span></div>
          <div class="sess-xp">${session.xp} XP</div>
        </div>
        <div class="segs">${segs}</div>
        <div class="card stage">
          <div class="q-count">Question ${session.idx + 1} of ${n}</div>
          <h2 class="prompt">${esc(ex.prompt(q))}</h2>
          ${ex.context ? `<p class="context">${esc(ex.context(q))}</p>` : ''}
          ${transport}
          ${answersHTML(cur)}
          ${cur.answered ? feedbackHTML(cur) : ''}
        </div>
        <p class="keys"><kbd>Space</kbd> play/stop · <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> switch · ${ex.continuous ? '<kbd>←</kbd> <kbd>→</kbd> fine-tune (<kbd>Shift</kbd> for big steps)' : '<kbd>1</kbd>–<kbd>9</kbd> answer'} · <kbd>↵</kbd> ${ex.continuous ? 'lock in / next' : 'next'}</p>
      </section>`;
    if (ex.continuous) bindSlider();
  }

  // ---------------------------------------------------------------- results
  function renderResults() {
    const { session: s, summary } = lastResults;
    const p = pct(summary.pts, summary.n);
    const correct = s.results.filter((r) => gradeClass(r.grade) === 'good').length;
    const close = s.results.filter((r) => gradeClass(r.grade) === 'close').length;
    const head = p >= 90 ? 'Outstanding.' : p >= 70 ? 'Strong session.' : p >= 50 ? 'Getting there.' : 'Keep training.';
    const C = 2 * Math.PI * 52;

    app.innerHTML = `
      <section class="results">
        <div class="card results-hero">
          <div class="ring">
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p / 100)}"/></svg>
            <div class="ring-label"><strong>${p}%</strong><span>score</span></div>
          </div>
          <div class="results-main">
            <div class="eyebrow">${esc(s.title)}</div>
            <h1>${head}</h1>
            <div class="stat-row">
              <div class="stat"><strong>${correct}</strong><span>correct</span></div>
              <div class="stat"><strong>${close}</strong><span>close</span></div>
              <div class="stat"><strong>+${summary.xp}</strong><span>XP</span></div>
              <div class="stat"><strong>${store.data.streak}</strong><span>day streak</span></div>
            </div>
            ${summary.levelUp ? `<div class="banner">⬆ You reached player level ${summary.levelUp}!</div>` : ''}
            ${summary.unlocks.map((u) => `<div class="banner">🔓 ${LEVELS[u.level]} unlocked on ${esc(exercises.byId[u.exId].name)}</div>`).join('')}
            <div class="actions">
              ${lastResults.setup && s.kind === 'single' ? '<button class="btn primary" data-action="again">Train again</button>' : ''}
              <a class="btn ${s.kind === 'single' ? '' : 'primary'}" href="#/">Back to gym</a>
            </div>
          </div>
        </div>
        <div class="card">
          <h3>Review</h3>
          <table class="review">
            <thead><tr><th>#</th>${s.kind === 'workout' ? '<th>Drill</th>' : ''}<th>Answer</th><th>Your pick</th><th></th></tr></thead>
            <tbody>
              ${s.results.map((r, i) => `<tr>
                <td class="muted">${i + 1}</td>
                ${s.kind === 'workout' ? `<td>${esc(r.ex.name)}</td>` : ''}
                <td>${esc(r.ex.longLabel(r.answer))}</td>
                <td>${esc(r.ex.longLabel(r.choice))}</td>
                <td><span class="res ${gradeClass(r.grade)} ${r.ex.continuous ? 'wide' : ''}">${r.ex.continuous ? Math.round(r.grade * 100) + '%' : r.grade === 1 ? '✓' : r.grade > 0 ? '½' : '✕'}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- progress
  function renderProgress() {
    const d = store.data;
    const L = store.level();
    const catStats = CATS.map((cat) => {
      let n = 0, p = 0;
      exercises.list.filter((e) => e.cat === cat.id).forEach((e) => { const s = store.ex(e.id); n += s.answered; p += s.points; });
      return { cat, n, p };
    });
    app.innerHTML = `
      <section class="progress-page">
        <h1>Your progress</h1>
        <div class="tiles">
          <div class="card tile"><span>Player level</span><strong>${L.lvl}</strong></div>
          <div class="card tile"><span>Total XP</span><strong>${d.xp}</strong></div>
          <div class="card tile"><span>Reps</span><strong>${d.answered}</strong></div>
          <div class="card tile"><span>Accuracy</span><strong>${d.answered ? pct(d.points, d.answered) + '%' : '—'}</strong></div>
          <div class="card tile"><span>Streak / best</span><strong>${d.streak || 0}<small> / ${d.bestStreak || 0}</small></strong></div>
        </div>
        <div class="card">
          <h3>Accuracy by muscle group</h3>
          <div class="cat-bars">
            ${catStats.map(({ cat, n, p }) => `<div class="cat-bar cat-${cat.id}">
              <span>${cat.name}</span>
              <div class="bar"><i style="width:${pct(p, n)}%"></i></div>
              <strong>${n ? pct(p, n) + '%' : '—'}</strong>
            </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <h3>Drills</h3>
          <div class="table-wrap">
          <table class="drills">
            <thead><tr><th>Drill</th>${LEVELS.map((l) => `<th>${l}</th>`).join('')}<th>Accuracy</th><th>Reps</th></tr></thead>
            <tbody>
              ${exercises.list.map((e) => {
                const s = store.ex(e.id);
                return `<tr class="cat-${e.cat}">
                  <td><a href="#/ex/${e.id}"><span class="dot"></span>${esc(e.name)}</a></td>
                  ${[0, 1, 2, 3].map((i) => `<td>${i > s.unlocked ? `<span class="locked">${LOCK}</span>` : s.best[i] ? s.best[i] + '%' : '<span class="muted">—</span>'}</td>`).join('')}
                  <td>${s.answered ? pct(s.points, s.answered) + '%' : '<span class="muted">—</span>'}</td>
                  <td>${s.answered}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          </div>
        </div>
        <div class="card">
          <h3>Recent sessions</h3>
          ${d.history.length ? `<ul class="history">${d.history.slice(0, 12).map((h) => `<li>
              <span>${esc(h.title)}</span>
              <span class="muted">${new Date(h.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <strong>${pct(h.pts, h.n)}%</strong>
              <span class="muted">+${h.xp} XP</span>
            </li>`).join('')}</ul>` : '<p class="muted">No sessions yet. Your history will show up here.</p>'}
        </div>
        <button class="btn danger" data-action="reset">Reset all progress</button>
      </section>`;
  }

  // ---------------------------------------------------------------- actions
  const actions = {
    'start-workout': () => {
      const items = [];
      dailyWorkout().forEach((it) => { for (let i = 0; i < 5; i++) items.push(it); });
      startSession({ kind: 'workout', title: 'Daily workout', items, source: null });
    },
    'set-level': (el) => { setup.level = +el.dataset.i; renderSetup(setup.exId); },
    'set-source': (el) => {
      if (el.dataset.id === 'user' && !sources.hasUser()) { document.getElementById('userfile').click(); return; }
      setup.source = el.dataset.id;
      renderSetup(setup.exId);
    },
    'pick-file': (el, e) => { e.preventDefault(); document.getElementById('userfile').click(); },
    'set-count': (el) => { setup.count = +el.dataset.n; renderSetup(setup.exId); },
    start: () => {
      const ex = exercises.byId[setup.exId];
      const items = Array.from({ length: setup.count }, () => ({ exId: ex.id, level: setup.level }));
      startSession({ kind: 'single', title: `${ex.name} · ${LEVELS[setup.level]}`, items, source: ex.noSource ? null : setup.source });
    },
    again: () => { setup = lastResults.setup; actions.start(); },
    play: () => audio.toggle(),
    ab: (el) => audio.select(+el.dataset.i),
    answer: (el) => answer(session.cur.q.options[+el.dataset.i]),
    submit: () => { if (session.cur.pending != null) answer(session.cur.pending); },
    next: () => next(),
    retry: () => prepareQuestion(),
    quit: () => {
      if (session.results.length && !confirm('End this session? Progress from it won’t be saved.')) return;
      location.hash = '#/';
    },
    reset: () => {
      if (confirm('Reset all XP, streaks, unlocked levels and history? This cannot be undone.')) { store.reset(); renderProgress(); }
    },
  };

  const sfxBtn = document.getElementById('sfxToggle');
  function syncSfxBtn() {
    sfxBtn.classList.toggle('off', !audio.sfxOn);
    sfxBtn.title = audio.sfxOn ? 'Answer sounds on' : 'Answer sounds off';
  }
  sfxBtn.addEventListener('click', () => { audio.setSfx(!audio.sfxOn); syncSfxBtn(); if (audio.sfxOn) audio.sfx('good'); });
  syncSfxBtn();

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener('keydown', (e) => {
    if (view !== 'session' || !session || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input, textarea')) return;
    const cur = session.cur;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); audio.toggle(); }
    else if (k === 'a' || k === 'b' || k === 'c') audio.select('abc'.indexOf(k));
    else if (k === 'enter') {
      e.preventDefault();
      if (cur && cur.ex.continuous && !cur.answered) { if (cur.pending != null && !cur.loading) answer(cur.pending); }
      else next();
    } else if ((k === 'arrowleft' || k === 'arrowright') && cur && cur.ex.continuous && !cur.answered && !cur.loading) {
      e.preventDefault();
      nudge(k === 'arrowleft' ? -1 : 1, e.shiftKey);
    } else if (/^[1-9]$/.test(k) && cur && !cur.answered && cur.q.options && cur.q.options.length <= 9) {
      const v = cur.q.options[+k - 1];
      if (v !== undefined) answer(v);
    }
  });

  audio.onChange(() => { if (view === 'session') renderSession(); });

  // volume
  const vol = document.getElementById('volume');
  vol.value = audio.volume;
  vol.addEventListener('input', () => audio.setVolume(+vol.value));

  window.addEventListener('hashchange', route);
  route();
  setTimeout(() => sources.preload(), 300);
})();

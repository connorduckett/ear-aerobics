/* Ear Aerobics — progress persistence (localStorage). */
window.EA = window.EA || {};

EA.store = (() => {
  const KEY = 'earAerobics.v1';
  const UNLOCK_PCT = 0.7;
  const MIN_Q = 5;

  const blank = () => ({ xp: 0, streak: 0, bestStreak: 0, lastDay: null, answered: 0, points: 0, ex: {}, history: [], workoutDay: null });

  let data;
  try {
    data = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    data = blank();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  function ex(id) {
    if (!data.ex[id]) data.ex[id] = { unlocked: 0, best: [0, 0, 0, 0], answered: 0, points: 0, sessions: 0 };
    return data.ex[id];
  }

  function today(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function level() {
    const lvl = Math.floor(Math.sqrt(data.xp / 40)) + 1;
    const base = 40 * (lvl - 1) ** 2;
    const next = 40 * lvl ** 2;
    return { lvl, base, next, pct: (data.xp - base) / (next - base) };
  }

  function recordSession(session) {
    const agg = {};
    let xp = 0;
    session.results.forEach((r) => {
      const k = r.exId + '|' + r.level;
      agg[k] = agg[k] || { exId: r.exId, level: r.level, n: 0, pts: 0 };
      agg[k].n++;
      agg[k].pts += r.grade;
      xp += r.xp;
    });

    const n = session.results.length;
    const pts = session.results.reduce((s, r) => s + r.grade, 0);
    const before = level().lvl;
    data.xp += xp;
    data.answered += n;
    data.points += pts;

    const unlocks = [];
    Object.values(agg).forEach((a) => {
      const e = ex(a.exId);
      e.answered += a.n;
      e.points += a.pts;
      e.sessions++;
      const pct = a.pts / a.n;
      if (a.n >= MIN_Q) {
        e.best[a.level] = Math.max(e.best[a.level] || 0, Math.round(pct * 100));
        if (pct >= UNLOCK_PCT && a.level === e.unlocked && e.unlocked < 3) {
          e.unlocked++;
          unlocks.push({ exId: a.exId, level: e.unlocked });
        }
      }
    });

    const t = today();
    if (data.lastDay !== t) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      data.streak = data.lastDay === today(y) ? data.streak + 1 : 1;
      data.lastDay = t;
      data.bestStreak = Math.max(data.bestStreak || 0, data.streak);
    }
    if (session.kind === 'workout') data.workoutDay = t;

    data.history.unshift({ ts: Date.now(), title: session.title, n, pts, xp });
    data.history = data.history.slice(0, 40);
    save();
    return { xp, n, pts, unlocks, levelUp: level().lvl > before ? level().lvl : null };
  }

  function reset() {
    data = blank();
    save();
  }

  return { get data() { return data; }, ex, save, today, level, recordSession, reset, UNLOCK_PCT };
})();

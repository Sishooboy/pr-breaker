/* PR Breaker: track, build and break personal records. Vanilla JS, no build step.
   Everything is stored in metric (kg, metres, seconds) and converted for display. */
(() => {
  'use strict';

  /* ---------- constants ---------- */

  const STORE_KEY = 'prbreaker.v1';
  const KG_PER_LB = 0.45359237;
  const M_PER_MI = 1609.344;

  const GROUPS = {
    Chest: '#ff2bd6',
    Back: '#00e5ff',
    Legs: '#b6ff3b',
    Shoulders: '#ffb020',
    Arms: '#8b7bff',
    Core: '#ff5d73',
    Cardio: '#2bffa8',
    'Full body': '#f5f7ff'
  };

  const KINDS = {
    weight: { label: 'Weight × Reps', hint: 'Load and reps. The classic lift.' },
    reps: { label: 'Reps Only', hint: 'Bodyweight: pull-ups, dips, push-ups.' },
    duration: { label: 'Duration', hint: 'Time held or on the clock. Planks, holds.' },
    distance: { label: 'Distance', hint: 'Ground covered. Runs, rows, rides.' }
  };

  const SET_MODES = { single: 'Single set', multi: 'Multi set' };

  const PRESETS = [
    { name: 'Bench Press', group: 'Chest', kind: 'weight', sets: 'multi' },
    { name: 'Leg Press', group: 'Legs', kind: 'weight', sets: 'multi' },
    { name: 'Deadlift', group: 'Back', kind: 'weight', sets: 'single' },
    { name: 'Squat', group: 'Legs', kind: 'weight', sets: 'multi' },
    { name: 'Overhead Press', group: 'Shoulders', kind: 'weight', sets: 'multi' },
    { name: 'Pull-Up', group: 'Back', kind: 'reps', sets: 'multi' },
    { name: 'Plank', group: 'Core', kind: 'duration', sets: 'single' },
    { name: 'Run', group: 'Cardio', kind: 'distance', sets: 'single' }
  ];

  // Sample history, oldest first. Values in metric: [kg, reps], [reps], [seconds], [metres].
  const DEMO = {
    'Bench Press': { group: 'Chest', kind: 'weight', sets: 'multi', log: [[60, 8], [62.5, 6], [65, 6], [70, 5], [72.5, 4]] },
    Squat: { group: 'Legs', kind: 'weight', sets: 'multi', log: [[80, 8], [85, 6], [90, 5], [95, 4]] },
    Deadlift: { group: 'Back', kind: 'weight', sets: 'single', log: [[100, 5], [110, 5], [120, 3], [125, 2]] },
    'Pull-Up': { group: 'Back', kind: 'reps', sets: 'multi', log: [[6], [7], [9], [10]] },
    Plank: { group: 'Core', kind: 'duration', sets: 'single', log: [[45], [60], [75], [90]] },
    Run: { group: 'Cardio', kind: 'distance', sets: 'single', log: [[3000], [4000], [5000], [5000]] }
  };

  const DRAFT_FIELDS = {
    weight: ['w', 'r'],
    reps: ['r'],
    duration: ['min', 'sec'],
    distance: ['d']
  };

  /* ---------- DOM refs & state ---------- */

  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const dock = $('#dock');
  const sheetRoot = $('#sheet-root');
  const fx = $('#fx');
  const toastEl = $('#toast');

  const blankBuild = () => ({ name: '', group: 'Chest', kind: 'weight', sets: 'single', sw: '', sr: '', smin: '', ssec: '', sd: '' });

  let state = load();
  const ui = { view: 'home', exId: null, query: '', group: 'All', build: blankBuild(), sheet: null };
  let toastTimer = 0;
  let fxTimer = 0;

  /* ---------- persistence ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('PR Breaker: could not read saved data', err);
    }
    return { unit: 'kg', exercises: [] };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      toast('Storage is blocked. Progress will not survive a reload.');
    }
  }

  function normalize(data) {
    const src = data && typeof data === 'object' ? data : {};
    const exercises = (Array.isArray(src.exercises) ? src.exercises : [])
      .filter((ex) => ex && ex.id && KINDS[ex.kind] && Array.isArray(ex.entries))
      .map((ex) => {
        ex.sets = ex.sets === 'multi' ? 'multi' : 'single';
        recomputeFlags(ex);
        return ex;
      });
    return { unit: src.unit === 'lb' ? 'lb' : 'kg', exercises };
  }

  /* ---------- units & formatting ---------- */

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const fmtNum = (v, d = 2) => String(Number(v.toFixed(d)));

  const metric = () => state.unit === 'kg';
  const loadUnit = () => (metric() ? 'kg' : 'lb');
  const distUnit = () => (metric() ? 'km' : 'mi');
  const loadStep = () => (metric() ? 2.5 : 5);
  const distStep = () => (metric() ? 0.5 : 0.25);

  const toLoad = (kg) => (metric() ? kg : kg / KG_PER_LB);
  const fromLoad = (v) => (metric() ? v : v * KG_PER_LB);
  const toDist = (m) => (metric() ? m / 1000 : m / M_PER_MI);
  const fromDist = (v) => (metric() ? v * 1000 : v * M_PER_MI);

  const fmtWeight = (kg, unit = true) => fmtNum(toLoad(kg)) + (unit ? ` ${loadUnit()}` : '');
  const fmtDist = (m, unit = true) => fmtNum(toDist(m)) + (unit ? ` ${distUnit()}` : '');
  const fmtTime = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  };

  function fmtSet(kind, s) {
    switch (kind) {
      case 'weight': return `${fmtWeight(s.w)} × ${s.r}`;
      case 'reps': return `${s.r} reps`;
      case 'duration': return fmtTime(s.s);
      default: return fmtDist(s.m);
    }
  }

  function heroParts(kind, s) {
    switch (kind) {
      case 'weight': return { main: fmtNum(toLoad(s.w)), unit: loadUnit(), sub: `× ${s.r} reps` };
      case 'reps': return { main: String(s.r), unit: 'reps', sub: 'best set' };
      case 'duration': return { main: fmtTime(s.s), unit: '', sub: 'time held' };
      default: return { main: fmtNum(toDist(s.m)), unit: distUnit(), sub: 'distance' };
    }
  }

  const est1RM = (s) => (s.r <= 1 ? s.w : s.w * (1 + s.r / 30));

  function relDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const fmtStamp = (iso) =>
    `${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  const todayLabel = () => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  /* ---------- scoring ---------- */

  const primary = (kind, s) => (kind === 'weight' ? s.w : kind === 'reps' ? s.r : kind === 'duration' ? s.s : s.m);
  const score = (kind, s) => (kind === 'weight' ? [s.w, s.r] : [primary(kind, s)]);

  function cmpScore(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? -Infinity;
      const y = b[i] ?? -Infinity;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  // Heavier load wins. Same load, more reps wins. Ties keep the older mark.
  const beats = (kind, a, b) => !b || cmpScore(score(kind, a), score(kind, b)) > 0;

  function bestOf(kind, sets) {
    let best = null;
    for (const s of sets) if (beats(kind, s, best)) best = s;
    return best;
  }

  const isValidSet = (kind, s) => (kind === 'weight' ? s.r > 0 : primary(kind, s) > 0);

  function makeSet(kind, v) {
    switch (kind) {
      case 'weight': return { w: v[0], r: v[1] };
      case 'reps': return { r: v[0] };
      case 'duration': return { s: v[0] };
      default: return { m: v[0] };
    }
  }

  /* ---------- drafts (form strings <-> stored metric values) ---------- */

  function blankDraft(kind) {
    switch (kind) {
      case 'weight': return { w: '', r: '' };
      case 'reps': return { r: '' };
      case 'duration': return { min: '', sec: '' };
      default: return { d: '' };
    }
  }

  function draftToSet(kind, d) {
    switch (kind) {
      case 'weight': return { w: fromLoad(num(d.w)), r: num(d.r) };
      case 'reps': return { r: num(d.r) };
      case 'duration': return { s: num(d.min) * 60 + num(d.sec) };
      default: return { m: fromDist(num(d.d)) };
    }
  }

  function setToDraft(kind, s) {
    switch (kind) {
      case 'weight': return { w: fmtNum(toLoad(s.w)), r: String(s.r) };
      case 'reps': return { r: String(s.r) };
      case 'duration': return { min: String(Math.floor(s.s / 60)), sec: String(Math.round(s.s % 60)) };
      default: return { d: fmtNum(toDist(s.m)) };
    }
  }

  function stepFor(kind, f) {
    return { w: loadStep(), r: 1, min: 1, sec: 5, d: distStep() }[f];
  }

  function nudge(d, f, dir, kind) {
    let next = Math.max(0, num(d[f]) + dir * stepFor(kind, f));
    if (f === 'sec') next = Math.min(59, next);
    d[f] = f === 'w' || f === 'd' ? fmtNum(next) : String(Math.round(next));
  }

  const FIELD_LABEL = {
    w: () => `Load · ${loadUnit()}`,
    r: () => 'Reps',
    min: () => 'Minutes',
    sec: () => 'Seconds',
    d: () => distUnit()
  };

  /* ---------- exercise & entry helpers ---------- */

  const findEx = (id) => state.exercises.find((e) => e.id === id);

  // The current record is the last entry flagged as a PR.
  function currentPR(ex) {
    for (let i = ex.entries.length - 1; i >= 0; i--) if (ex.entries[i].isPR) return ex.entries[i];
    return null;
  }

  // Walk the history in order and flag each session that beat the running best.
  function recomputeFlags(ex) {
    ex.entries.sort((a, b) => a.date.localeCompare(b.date));
    let run = null;
    for (const e of ex.entries) {
      e.isPR = !run || cmpScore(score(ex.kind, e.best), score(ex.kind, run)) > 0;
      if (e.isPR) run = e.best;
    }
  }

  function addEntry(ex, sets, baseline = false) {
    const prev = currentPR(ex);
    const entry = { id: uid(), date: new Date().toISOString(), sets, best: bestOf(ex.kind, sets), isPR: false, baseline };
    ex.entries.push(entry);
    recomputeFlags(ex);
    save();
    return { entry, prev: prev ? prev.best : null };
  }

  function recordCount() {
    return state.exercises.reduce((n, ex) => n + ex.entries.filter((e) => e.isPR && !e.baseline).length, 0);
  }

  function allEntries() {
    const rows = [];
    for (const ex of state.exercises) for (const e of ex.entries) rows.push({ ex, e });
    return rows.sort((a, b) => b.e.date.localeCompare(a.e.date));
  }

  function gainText(kind, next, prev) {
    if (!prev) return 'First record on the board';
    switch (kind) {
      case 'weight': {
        const dw = next.w - prev.w;
        const dr = next.r - prev.r;
        if (dw > 0) return `+${fmtWeight(dw)} load`;
        return `+${dr} rep${dr === 1 ? '' : 's'} at ${fmtWeight(prev.w)}`;
      }
      case 'reps': return `+${next.r - prev.r} reps`;
      case 'duration': return `+${fmtTime(next.s - prev.s)}`;
      default: return `+${fmtDist(next.m - prev.m)}`;
    }
  }

  function summaryOf(ex, e) {
    return e.sets.length > 1 ? `${e.sets.length} sets · best ${fmtSet(ex.kind, e.best)}` : fmtSet(ex.kind, e.best);
  }

  const tagHTML = (e) => (e.baseline ? '<span class="tag dim">BASE</span>' : e.isPR ? '<span class="tag">PR</span>' : '');

  /* ---------- chart ---------- */

  function progressSVG(ex) {
    const rows = ex.entries;
    if (rows.length < 2) return '<p class="chart-empty">Log one more session to draw your curve.</p>';

    const val = (s) => {
      const v = primary(ex.kind, s);
      return ex.kind === 'weight' ? toLoad(v) : ex.kind === 'distance' ? toDist(v) : v;
    };
    const vals = rows.map((e) => val(e.best));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo) * 0.18 || Math.max(hi * 0.1, 1);
    lo = Math.max(0, lo - pad);
    hi += pad;

    const W = 320;
    const H = 170;
    const P = 16;
    const x = (i) => P + (i / (rows.length - 1)) * (W - P * 2);
    const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - P * 2);

    const runMax = [];
    let run = -Infinity;
    vals.forEach((v) => {
      run = Math.max(run, v);
      runMax.push(run);
    });

    const line = runMax.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${x(0).toFixed(1)},${H - P} ${line} ${x(rows.length - 1).toFixed(1)},${H - P}`;
    const dots = vals
      .map((v, i) => {
        const cls = rows[i].baseline ? 'dot-base' : rows[i].isPR ? 'dot-pr' : 'dot-s';
        const r = rows[i].isPR ? 5 : 3.2;
        return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" class="${cls}"/>`;
      })
      .join('');
    const gid = `g${ex.id}`;

    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
        <defs>
          <linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#ff2bd6"/>
          </linearGradient>
          <linearGradient id="${gid}f" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#00e5ff" stop-opacity=".32"/><stop offset="1" stop-color="#00e5ff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="rgba(0,229,255,.18)"/>
        <polygon points="${area}" fill="url(#${gid}f)"/>
        <polyline points="${line}" fill="none" stroke="url(#${gid})" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="chart-legend">
        <span><i class="lg-s"></i>Session<i class="lg-pr"></i>Record</span>
        <span>${relDate(rows[0].date)} → ${relDate(rows[rows.length - 1].date)}</span>
      </div>`;
  }

  /* ---------- views ---------- */

  function emptyHTML(title, body) {
    return `<div class="empty"><div class="ring"></div><b>${esc(title)}</b>${esc(body)}</div>`;
  }

  function header(kicker, title, right = '') {
    return `<header class="top"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1></div>${right}</header>`;
  }

  function viewHome() {
    const every = allEntries();
    const sessions = every.filter((r) => !r.e.baseline).length;
    const latest = every.find((r) => r.e.isPR && !r.e.baseline);
    const missing = PRESETS.map((p, i) => ({ p, i })).filter(
      ({ p }) => !state.exercises.some((e) => e.name.toLowerCase() === p.name.toLowerCase())
    );

    return `
      <header class="top">
        <div>
          <p class="eyebrow"><span class="pulse"></span>System online · ${greeting()}</p>
          <h1 class="glitch" data-text="PR BREAKER">PR Breaker</h1>
          <p class="muted" style="margin-top:6px">${todayLabel()}</p>
        </div>
      </header>

      <section class="stats">
        <div class="stat"><b>${state.exercises.length}</b><span>Exercises</span></div>
        <div class="stat"><b>${recordCount()}</b><span>Records</span></div>
        <div class="stat"><b>${sessions}</b><span>Sessions</span></div>
      </section>

      ${latest ? latestHTML(latest) : ''}

      <section class="panel">
        <h2 class="sect">Recent activity</h2>
        ${every.length
          ? every.slice(0, 6).map(feedRow).join('')
          : emptyHTML('No activity yet', 'Build an exercise, set a baseline, then go break it.')}
      </section>

      ${missing.length
        ? `<section class="panel">
            <h2 class="sect">Recommended builds</h2>
            <p class="muted" style="margin-bottom:12px">The staples. Tap one to load it into the forge.</p>
            <div class="chips wrap" style="margin-bottom:0">
              ${missing.map(({ p, i }) => `<button class="chip" data-act="preset" data-v="${i}">+ ${esc(p.name)}</button>`).join('')}
            </div>
          </section>`
        : ''}
    `;
  }

  function latestHTML({ ex, e }) {
    const p = heroParts(ex.kind, e.best);
    return `
      <button class="hero" data-act="open" data-id="${ex.id}" style="--c:${GROUPS[ex.group] || '#00e5ff'}">
        <span class="eyebrow">Latest record · ${relDate(e.date)}</span>
        <span class="hero-name">${esc(ex.name)}</span>
        <span class="hero-val">${esc(p.main)}<small>${esc(p.unit)}</small></span>
        <span class="hero-sub">${esc(p.sub)}</span>
      </button>`;
  }

  function feedRow({ ex, e }) {
    return `
      <button class="row" data-act="open" data-id="${ex.id}" style="--c:${GROUPS[ex.group] || '#00e5ff'}">
        <span class="dot"></span>
        <span class="row-main"><b>${esc(ex.name)}</b><small>${esc(summaryOf(ex, e))}</small></span>
        <span class="row-end">${tagHTML(e)}<small class="when">${relDate(e.date)}</small></span>
      </button>`;
  }

  function viewArsenal() {
    const groups = ['All', ...new Set(state.exercises.map((e) => e.group))];
    return `
      ${header('Inventory', 'Arsenal', '<button class="pill" data-act="go" data-v="build">+ New</button>')}
      <input class="search" id="q" type="search" placeholder="Search your arsenal" value="${esc(ui.query)}" autocomplete="off">
      <div class="chips scroll">
        ${groups
          .map((g) => `<button class="chip ${g === ui.group ? 'on' : ''}" style="--c:${GROUPS[g] || '#00e5ff'}" data-act="group" data-v="${esc(g)}">${esc(g)}</button>`)
          .join('')}
      </div>
      <div id="arsenal-list">${arsenalList()}</div>`;
  }

  function arsenalList() {
    if (!state.exercises.length) {
      return emptyHTML('The arsenal is empty', 'Forge your first exercise to start tracking records.')
        + '<div class="center"><button class="btn primary" data-act="go" data-v="build">Build an exercise</button></div>';
    }
    const q = ui.query.trim().toLowerCase();
    const list = state.exercises.filter(
      (ex) => (ui.group === 'All' || ex.group === ui.group) && ex.name.toLowerCase().includes(q)
    );
    if (!list.length) return emptyHTML('No match', 'Try another name or muscle group.');
    return `<div class="grid">${list.map((ex) => exCard(ex)).join('')}</div>`;
  }

  function exCard(ex, interactive = true) {
    const pr = currentPR(ex);
    const val = pr ? heroParts(ex.kind, pr.best) : null;
    const attrs = interactive ? `data-act="open" data-id="${ex.id}"` : '';
    const tag = interactive ? 'button' : 'div';
    return `
      <${tag} class="ex-card" ${attrs} style="--c:${GROUPS[ex.group] || '#00e5ff'}">
        <span class="ex-group">${esc(ex.group)}</span>
        <span class="ex-name">${esc(ex.name)}</span>
        <span class="ex-pr">${val ? `${esc(val.main)}<small>${esc(val.unit)}</small>` : '<span class="none">No record</span>'}</span>
        <span class="ex-meta">${KINDS[ex.kind].label} · ${ex.sets === 'multi' ? 'Multi' : 'Single'} set</span>
      </${tag}>`;
  }

  function previewEx() {
    const b = ui.build;
    return { id: 'preview', name: b.name.trim() || 'Your exercise', group: b.group, kind: b.kind, sets: b.sets, entries: [] };
  }

  function startFields(b) {
    const input = (bind, label, placeholder) => `
      <label class="num"><span>${label}</span>
        <input type="number" inputmode="decimal" step="any" min="0" placeholder="${placeholder}" data-bind="${bind}" value="${esc(b[bind])}">
      </label>`;
    switch (b.kind) {
      case 'weight': return input('sw', `Load · ${loadUnit()}`, '0') + input('sr', 'Reps', '0');
      case 'reps': return input('sr', 'Reps', '0');
      case 'duration': return input('smin', 'Minutes', '0') + input('ssec', 'Seconds', '0');
      default: return input('sd', distUnit(), '0');
    }
  }

  function viewBuild() {
    const b = ui.build;
    return `
      ${header('Forge', 'Build')}
      <div id="preview" class="preview">${exCard(previewEx(), false)}</div>

      <h2 class="sect">Quick loadouts</h2>
      <div class="chips scroll">
        ${PRESETS.map((p, i) => `<button class="chip" data-act="preset" data-v="${i}">${esc(p.name)}</button>`).join('')}
      </div>

      <form id="build-form" class="panel" novalidate autocomplete="off">
        <label class="field">
          <span>Name</span>
          <input type="text" maxlength="40" placeholder="e.g. Incline Dumbbell Press" data-bind="name" value="${esc(b.name)}">
        </label>

        <div class="field">
          <span>Muscle group</span>
          <div class="chips wrap" style="margin-bottom:0">
            ${Object.keys(GROUPS)
              .map((g) => `<button type="button" class="chip ${g === b.group ? 'on' : ''}" style="--c:${GROUPS[g]}" data-act="bgroup" data-v="${esc(g)}">${esc(g)}</button>`)
              .join('')}
          </div>
        </div>

        <div class="field">
          <span>Tracking</span>
          <div class="kinds">
            ${Object.entries(KINDS)
              .map(([k, v]) => `<button type="button" class="kind ${k === b.kind ? 'on' : ''}" data-act="bkind" data-v="${k}"><b>${v.label}</b><small>${v.hint}</small></button>`)
              .join('')}
          </div>
        </div>

        <div class="field">
          <span>Sets</span>
          <div class="seg">
            ${Object.entries(SET_MODES)
              .map(([k, v]) => `<button type="button" class="${k === b.sets ? 'on' : ''}" data-act="bsets" data-v="${k}">${v}</button>`)
              .join('')}
          </div>
          <small class="muted">${b.sets === 'multi'
            ? 'Log several sets per session. Your record is the best set.'
            : 'One attempt per session. Simple and sharp.'}</small>
        </div>

        <div class="field">
          <span>Current PR <em>optional</em></span>
          <div class="start-grid">${startFields(b)}</div>
        </div>

        <button type="submit" class="btn primary block">Forge exercise</button>
      </form>`;
  }

  function viewDetail() {
    const ex = findEx(ui.exId);
    const pr = currentPR(ex);
    const p = pr ? heroParts(ex.kind, pr.best) : null;
    const records = ex.entries.filter((e) => e.isPR && !e.baseline).length;
    const sessions = ex.entries.filter((e) => !e.baseline).length;
    const history = [...ex.entries].reverse();
    const color = GROUPS[ex.group] || '#00e5ff';

    return `
      <button class="back" data-act="go" data-v="arsenal">← Arsenal</button>
      ${header(`${esc(ex.group)} · ${KINDS[ex.kind].label}`, esc(ex.name))}

      <section class="hero" style="--c:${color}">
        <span class="eyebrow">Current record</span>
        ${p
          ? `<span class="hero-val">${esc(p.main)}<small>${esc(p.unit)}</small></span>
             <span class="hero-sub">${esc(p.sub)} · ${relDate(pr.date)}</span>`
          : `<span class="hero-empty">NO RECORD</span>
             <span class="hero-sub">Log an attempt to set your baseline.</span>`}
        <span class="hero-stats">
          <span><b>${records}</b> record${records === 1 ? '' : 's'}</span>
          <span><b>${sessions}</b> session${sessions === 1 ? '' : 's'}</span>
          ${pr && ex.kind === 'weight' ? `<span>Est. 1RM <b>${fmtWeight(est1RM(pr.best))}</b></span>` : ''}
          <span>${SET_MODES[ex.sets]}</span>
        </span>
        <span class="btn primary block hero-cta" data-act="log" data-id="${ex.id}" role="button">⚡ Upgrade PR</span>
      </section>

      <section class="panel">
        <h2 class="sect">Progression</h2>
        ${progressSVG(ex)}
      </section>

      <section class="panel">
        <h2 class="sect">History</h2>
        ${history.length
          ? history.map((e) => logRow(ex, e)).join('')
          : emptyHTML('No history', 'Every attempt you log will show up here.')}
      </section>

      <button class="btn danger block" data-act="del-ex" data-id="${ex.id}">Delete exercise</button>`;
  }

  function logRow(ex, e) {
    return `
      <div class="log-row">
        <div>
          <div class="log-top"><b>${esc(fmtSet(ex.kind, e.best))}</b>${tagHTML(e)}</div>
          <small class="muted">${esc(fmtStamp(e.date))}</small>
          ${e.sets.length > 1
            ? `<div class="sets-chips">${e.sets.map((s) => `<span>${esc(fmtSet(ex.kind, s))}</span>`).join('')}</div>`
            : ''}
        </div>
        ${e.baseline
          ? ''
          : `<button class="del" data-act="del-entry" data-id="${e.id}" data-ex="${ex.id}" aria-label="Delete session">×</button>`}
      </div>`;
  }

  function viewHistory() {
    const rows = allEntries();
    if (!rows.length) {
      return header('Chronicle', 'History') + emptyHTML('Nothing logged yet', 'Your sessions and records land here in order.');
    }
    const days = new Map();
    for (const r of rows) {
      const key = new Date(r.e.date).toDateString();
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(r);
    }
    return header('Chronicle', 'History') + [...days.values()]
      .map((items) => `
        <section class="panel">
          <h2 class="sect">${relDate(items[0].e.date)}</h2>
          ${items.map(feedRow).join('')}
        </section>`)
      .join('');
  }

  function viewSettings() {
    const count = allEntries().length;
    return `
      ${header('Configuration', 'System')}
      <section class="panel">
        <h2 class="sect">Units</h2>
        <div class="seg big">
          <button class="${metric() ? 'on' : ''}" data-act="unit" data-v="kg">Kilograms</button>
          <button class="${metric() ? '' : 'on'}" data-act="unit" data-v="lb">Pounds</button>
        </div>
        <p class="muted note">Switching converts every record on screen. Nothing is lost.</p>
      </section>

      <section class="panel">
        <h2 class="sect">Data vault</h2>
        <button class="list-btn" data-act="demo">Load sample history <small>${state.exercises.length ? 'adds missing demos' : 'fills the arsenal'}</small></button>
        <button class="list-btn" data-act="export">Export backup <small>.json</small></button>
        <button class="list-btn" data-act="import">Restore backup <small>.json</small></button>
        <button class="list-btn danger-txt" data-act="wipe">Wipe everything <small>cannot be undone</small></button>
      </section>

      <p class="muted center-text">PR Breaker · ${state.exercises.length} exercises · ${count} entries</p>`;
  }

  /* ---------- rendering & navigation ---------- */

  function syncDock() {
    const active = ui.view === 'detail' ? 'arsenal' : ui.view;
    dock.querySelectorAll('[data-act="go"]').forEach((b) => b.classList.toggle('on', b.dataset.v === active));
  }

  function render() {
    if (ui.view === 'detail' && !findEx(ui.exId)) ui.view = 'arsenal';
    const views = {
      home: viewHome,
      arsenal: viewArsenal,
      build: viewBuild,
      detail: viewDetail,
      history: viewHistory,
      settings: viewSettings
    };
    app.innerHTML = views[ui.view]();
    syncDock();
  }

  function go(view) {
    ui.view = view;
    render();
    window.scrollTo(0, 0);
  }

  function openEx(id) {
    ui.exId = id;
    go('detail');
  }

  /* ---------- toast & celebration ---------- */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function celebrate(ex, best, prev) {
    const colors = ['#00e5ff', '#ff2bd6', '#b6ff3b', '#ffd166'];
    const sparks = Array.from({ length: 30 }, (_, i) => {
      const a = (i / 30) * Math.PI * 2;
      const d = 120 + Math.random() * 170;
      return `<i class="spark" style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;--c:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
    }).join('');

    fx.innerHTML = `${sparks}
      <div class="fx-card" style="--c:${GROUPS[ex.group] || '#00e5ff'}">
        <p class="eyebrow">Personal record broken</p>
        <h2 class="glitch" data-text="NEW PR">NEW PR</h2>
        <p class="fx-ex">${esc(ex.name)}</p>
        <p class="fx-val">${esc(fmtSet(ex.kind, best))}</p>
        <p class="fx-gain">${esc(gainText(ex.kind, best, prev))}</p>
        <p class="fx-hint">Tap to continue</p>
      </div>`;
    fx.hidden = false;
    clearTimeout(fxTimer);
    fxTimer = setTimeout(closeFx, 4200);
  }

  function closeFx() {
    clearTimeout(fxTimer);
    fx.hidden = true;
    fx.innerHTML = '';
  }

  /* ---------- log sheet (upgrade a PR) ---------- */

  function openSheet(exId) {
    const ex = findEx(exId);
    if (!ex) return;
    const pr = currentPR(ex);
    ui.sheet = { exId, sets: [pr ? setToDraft(ex.kind, pr.best) : blankDraft(ex.kind)] };
    sheetRoot.hidden = false;
    renderSheet();
  }

  function closeSheet() {
    ui.sheet = null;
    sheetRoot.hidden = true;
    sheetRoot.innerHTML = '';
  }

  function setCard(kind, d, i, n) {
    return `
      <div class="set-card">
        <div class="set-head">
          <span>${n > 1 ? `Set ${i + 1}` : 'Attempt'}</span>
          ${n > 1 ? `<button class="rm" data-act="rm-set" data-i="${i}" aria-label="Remove set">×</button>` : ''}
        </div>
        <div class="set-fields">
          ${DRAFT_FIELDS[kind]
            .map((f) => `
              <div class="num"><span>${FIELD_LABEL[f]()}</span>
                <div class="stepper">
                  <button type="button" data-act="step" data-i="${i}" data-f="${f}" data-dir="-1" aria-label="Decrease">−</button>
                  <input type="number" inputmode="decimal" step="any" min="0" value="${esc(d[f])}" data-sf="${i}:${f}">
                  <button type="button" data-act="step" data-i="${i}" data-f="${f}" data-dir="1" aria-label="Increase">+</button>
                </div>
              </div>`)
            .join('')}
        </div>
      </div>`;
  }

  function renderSheet() {
    const s = ui.sheet;
    const ex = s && findEx(s.exId);
    if (!ex) return closeSheet();
    const pr = currentPR(ex);

    sheetRoot.innerHTML = `
      <div class="sheet-backdrop" data-act="close-sheet"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="Log attempt" style="--c:${GROUPS[ex.group] || '#00e5ff'}">
        <div class="grip"></div>
        <header class="sheet-head">
          <div><p class="eyebrow">Upgrade PR</p><h2>${esc(ex.name)}</h2></div>
          <button class="icon" data-act="close-sheet" aria-label="Close">✕</button>
        </header>
        <div class="current"><span>Current record</span><strong>${pr ? esc(fmtSet(ex.kind, pr.best)) : 'None yet'}</strong></div>
        ${s.sets.map((d, i) => setCard(ex.kind, d, i, s.sets.length)).join('')}
        ${ex.sets === 'multi' ? '<button class="btn ghost block" data-act="add-set">+ Add set</button>' : ''}
        <div class="verdict" id="verdict"></div>
        <button class="btn primary block" data-act="submit-log">Log attempt</button>
      </section>`;
    updateVerdict();
  }

  function updateVerdict() {
    const s = ui.sheet;
    const el = $('#verdict');
    if (!s || !el) return;
    const ex = findEx(s.exId);
    const pr = currentPR(ex);
    const prBest = pr ? pr.best : null;
    const best = bestOf(ex.kind, s.sets.map((d) => draftToSet(ex.kind, d)).filter((x) => isValidSet(ex.kind, x)));

    if (!best) {
      el.className = 'verdict';
      el.textContent = 'Enter a value above zero to log this attempt.';
    } else if (beats(ex.kind, best, prBest)) {
      el.className = 'verdict win';
      el.innerHTML = `<b>NEW RECORD</b> · ${esc(gainText(ex.kind, best, prBest))}`;
    } else {
      el.className = 'verdict';
      el.textContent = `Best set ${fmtSet(ex.kind, best)}. Beat ${fmtSet(ex.kind, prBest)} to claim the record.`;
    }
  }

  function submitLog() {
    const s = ui.sheet;
    const ex = findEx(s.exId);
    const sets = s.sets.map((d) => draftToSet(ex.kind, d)).filter((x) => isValidSet(ex.kind, x));
    if (!sets.length) return toast('Nothing to log yet. Enter a value above zero.');

    const { entry, prev } = addEntry(ex, sets);
    closeSheet();
    if (entry.isPR) celebrate(ex, entry.best, prev);
    else toast(`Logged ${fmtSet(ex.kind, entry.best)}. Not a record yet.`);
    render();
  }

  /* ---------- build ---------- */

  function loadPreset(i) {
    const p = PRESETS[i];
    Object.assign(ui.build, { name: p.name, group: p.group, kind: p.kind, sets: p.sets });
    go('build');
  }

  function createExercise() {
    const b = ui.build;
    const name = b.name.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Name your exercise first.');
    if (state.exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      return toast('You already forged that one.');
    }

    const start = draftToSet(b.kind, { w: b.sw, r: b.sr, min: b.smin, sec: b.ssec, d: b.sd });
    const ex = { id: uid(), name, group: b.group, kind: b.kind, sets: b.sets, createdAt: new Date().toISOString(), entries: [] };
    if (isValidSet(b.kind, start)) addEntry(ex, [start], true);

    state.exercises.push(ex);
    save();
    ui.build = blankBuild();
    toast(`${name} forged.`);
    openEx(ex.id);
  }

  /* ---------- data: units, backup, demo, wipe ---------- */

  function setUnit(u) {
    state.unit = u === 'lb' ? 'lb' : 'kg';
    save();
    render();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `prbreaker-${new Date().toISOString().slice(0, 10)}.json`
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function loadDemo() {
    let added = 0;
    for (const [name, d] of Object.entries(DEMO)) {
      if (state.exercises.some((e) => e.name === name)) continue;
      const ex = { id: uid(), name, group: d.group, kind: d.kind, sets: d.sets, createdAt: new Date().toISOString(), entries: [] };
      const n = d.log.length;
      d.log.forEach((vals, i) => {
        const s = makeSet(d.kind, vals);
        ex.entries.push({
          id: uid(),
          date: new Date(Date.now() - (n - 1 - i) * 7 * 864e5).toISOString(),
          sets: [s],
          best: s,
          isPR: false,
          baseline: i === 0
        });
      });
      recomputeFlags(ex);
      state.exercises.push(ex);
      added++;
    }
    save();
    render();
    toast(added ? `${added} sample exercise${added > 1 ? 's' : ''} loaded.` : 'Sample data is already in your arsenal.');
  }

  function wipeAll() {
    if (!confirm('Wipe every exercise and record? This cannot be undone.')) return;
    state = { unit: state.unit, exercises: [] };
    save();
    ui.exId = null;
    go('home');
  }

  /* ---------- events ---------- */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, v, id } = el.dataset;

    switch (act) {
      case 'go': return go(v);
      case 'open': return openEx(id);
      case 'group': ui.group = v; return render();
      case 'preset': return loadPreset(Number(v));
      case 'bgroup': ui.build.group = v; return render();
      case 'bkind': ui.build.kind = v; return render();
      case 'bsets': ui.build.sets = v; return render();
      case 'log': return openSheet(id);
      case 'close-sheet': return closeSheet();
      case 'step': {
        const s = ui.sheet;
        const ex = s && findEx(s.exId);
        if (!ex) return;
        nudge(s.sets[Number(el.dataset.i)], el.dataset.f, Number(el.dataset.dir), ex.kind);
        return renderSheet();
      }
      case 'add-set': {
        const s = ui.sheet;
        s.sets.push({ ...s.sets[s.sets.length - 1] });
        return renderSheet();
      }
      case 'rm-set': {
        ui.sheet.sets.splice(Number(el.dataset.i), 1);
        return renderSheet();
      }
      case 'submit-log': return submitLog();
      case 'del-entry': {
        if (!confirm('Delete this session from history?')) return;
        const ex = findEx(el.dataset.ex);
        if (ex) {
          ex.entries = ex.entries.filter((x) => x.id !== id);
          recomputeFlags(ex);
          save();
        }
        return render();
      }
      case 'del-ex': {
        if (!confirm('Delete this exercise and all of its history?')) return;
        state.exercises = state.exercises.filter((x) => x.id !== id);
        save();
        ui.exId = null;
        return go('arsenal');
      }
      case 'unit': return setUnit(v);
      case 'export': return exportData();
      case 'import': return $('#import-file').click();
      case 'demo': return loadDemo();
      case 'wipe': return wipeAll();
      default: return undefined;
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.bind) {
      ui.build[t.dataset.bind] = t.value;
      if (t.dataset.bind === 'name') $('#preview').innerHTML = exCard(previewEx(), false);
      return;
    }
    if (t.dataset.sf && ui.sheet) {
      const [i, f] = t.dataset.sf.split(':');
      ui.sheet.sets[Number(i)][f] = t.value;
      updateVerdict();
      return;
    }
    if (t.id === 'q') {
      ui.query = t.value;
      $('#arsenal-list').innerHTML = arsenalList();
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'build-form') return;
    e.preventDefault();
    createExercise();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ui.sheet) closeSheet();
    else closeFx();
  });

  sheetRoot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  fx.addEventListener('click', closeFx);

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.exercises)) throw new Error('not a backup');
      if (!confirm('Replace your current data with this backup?')) return;
      state = normalize(data);
      save();
      ui.exId = null;
      go('home');
      toast('Backup restored.');
    } catch (err) {
      toast('That file is not a PR Breaker backup.');
    }
  });

  render();
})();

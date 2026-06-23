/**
 * recipe.js — single recipe detail.
 * Scaling (½ steps) + US/Metric conversion (heuristic text parse), favorites,
 * tap-to-check ingredients/steps, tap-to-start timers, cook mode, keep-screen-on.
 */

import { supabase } from '../supabase.js';

// ── quantity parsing / conversion (heuristic, free-text) ───────────────────
const UF = { '½': .5, '⅓': 1/3, '⅔': 2/3, '¼': .25, '¾': .75, '⅕': .2, '⅖': .4, '⅗': .6, '⅘': .8, '⅙': 1/6, '⅚': 5/6, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const UFC = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[${UFC}]|[${UFC}]|\\d*\\.?\\d+)`;
function toNum(t) {
  t = t.trim(); let m;
  if ((m = t.match(new RegExp(`^(\\d+)?\\s*([${UFC}])$`)))) return (m[1] ? +m[1] : 0) + UF[m[2]];
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if (/^\d*\.?\d+$/.test(t)) return parseFloat(t);
  return null;
}
const NICE = [[0,''],[.125,'⅛'],[1/6,'⅙'],[.25,'¼'],[1/3,'⅓'],[.375,'⅜'],[.5,'½'],[.625,'⅝'],[2/3,'⅔'],[.75,'¾'],[.875,'⅞'],[1,'']];
function fmtFrac(n) {
  if (!isFinite(n) || n <= 0) return '0';
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  let best = null, diff = 0.05;
  for (const [v, g] of NICE) { const d = Math.abs(frac - v); if (d < diff) { diff = d; best = { v, g }; } }
  if (best) { const w = whole + (best.v === 1 ? 1 : 0), g = best.v === 1 ? '' : best.g; if (w === 0 && g) return g; return g ? `${w} ${g}` : String(w); }
  return String(Math.round(n * 100) / 100);
}
const round5 = (x) => Math.round(x / 5) * 5, round2 = (x) => Math.round(x * 100) / 100;
const UNITS = {
  cup:{sys:'us',cat:'vol',base:236.588}, cups:{sys:'us',cat:'vol',base:236.588},
  tbsp:{sys:'us',cat:'vol',base:14.7868}, tbsps:{sys:'us',cat:'vol',base:14.7868}, tablespoon:{sys:'us',cat:'vol',base:14.7868}, tablespoons:{sys:'us',cat:'vol',base:14.7868},
  tsp:{sys:'us',cat:'vol',base:4.92892}, tsps:{sys:'us',cat:'vol',base:4.92892}, teaspoon:{sys:'us',cat:'vol',base:4.92892}, teaspoons:{sys:'us',cat:'vol',base:4.92892},
  oz:{sys:'us',cat:'wt',base:28.3495}, ounce:{sys:'us',cat:'wt',base:28.3495}, ounces:{sys:'us',cat:'wt',base:28.3495},
  lb:{sys:'us',cat:'wt',base:453.592}, lbs:{sys:'us',cat:'wt',base:453.592}, pound:{sys:'us',cat:'wt',base:453.592}, pounds:{sys:'us',cat:'wt',base:453.592},
  ml:{sys:'metric',cat:'vol',base:1}, milliliter:{sys:'metric',cat:'vol',base:1}, milliliters:{sys:'metric',cat:'vol',base:1},
  l:{sys:'metric',cat:'vol',base:1000}, liter:{sys:'metric',cat:'vol',base:1000}, liters:{sys:'metric',cat:'vol',base:1000}, litre:{sys:'metric',cat:'vol',base:1000}, litres:{sys:'metric',cat:'vol',base:1000},
  g:{sys:'metric',cat:'wt',base:1}, gram:{sys:'metric',cat:'wt',base:1}, grams:{sys:'metric',cat:'wt',base:1},
  kg:{sys:'metric',cat:'wt',base:1000}, kilogram:{sys:'metric',cat:'wt',base:1000}, kilograms:{sys:'metric',cat:'wt',base:1000},
};
function convertUnit(amount, info, target) {
  const b = amount * info.base;
  if (target === 'metric') {
    if (info.cat === 'vol') return b >= 1000 ? { amount: round2(b/1000), unit:'L', frac:false } : { amount: round5(b), unit:'ml', frac:false };
    return b >= 1000 ? { amount: round2(b/1000), unit:'kg', frac:false } : { amount: round5(b), unit:'g', frac:false };
  }
  if (info.cat === 'vol') {
    const cups = b/236.588; if (cups >= 0.25) return { amount: cups, unit: cups===1?'cup':'cups', frac:true };
    const tbsp = b/14.7868; if (tbsp >= 1) return { amount: tbsp, unit:'tbsp', frac:true };
    return { amount: b/4.92892, unit:'tsp', frac:true };
  }
  const oz = b/28.3495; if (oz >= 16) return { amount: oz/16, unit: oz/16===1?'lb':'lbs', frac:true };
  return { amount: oz, unit:'oz', frac:true };
}
const fmtAmt = (a, frac) => (frac ? fmtFrac(a) : String(a));
function transform(line, f, system) {
  const re = new RegExp(`^(\\s*)(${QTY})(?:\\s*[-–]\\s*(${QTY}))?\\s*([A-Za-z]+\\.?)?`);
  const m = line.match(re); if (!m) return line;
  let a1 = toNum(m[2]); if (a1 == null) return line;
  let a2 = m[3] != null ? toNum(m[3]) : null;
  a1 *= f; if (a2 != null) a2 *= f;
  const raw = (m[4] || '').replace(/\.$/, ''), info = UNITS[raw.toLowerCase()], rest = line.slice(m[0].length);
  if (info && system !== info.sys) {
    const c1 = convertUnit(a1, info, system); let amt = fmtAmt(c1.amount, c1.frac);
    if (a2 != null) { const c2 = convertUnit(a2, info, system); amt += '–' + fmtAmt(c2.amount, c2.frac); }
    return `${m[1]}${amt} ${c1.unit}${rest}`;
  }
  return `${m[1]}${fmtFrac(a1) + (a2 != null ? '–' + fmtFrac(a2) : '')}${raw ? ' ' + raw : ''}${rest}`;
}
function convertTemps(text, system) {
  if (system !== 'metric') return text;
  return text.replace(/(\d{2,3})\s*°?\s*(?:F\b|degrees(?:\s*F)?)/gi, (_, f) => `${round5((+f - 32) * 5 / 9)}°C`);
}

// ── timers: split a step into text + tappable duration chips ───────────────
const TIME_RE = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
function parseTimers(step) {
  const segs = []; let last = 0, m; TIME_RE.lastIndex = 0;
  while ((m = TIME_RE.exec(step)) !== null) {
    if (m.index > last) segs.push({ text: step.slice(last, m.index) });
    const u = m[2].toLowerCase(), mult = u[0] === 'h' ? 3600 : u[0] === 's' ? 1 : 60;
    segs.push({ timer: Math.round(parseFloat(m[1]) * mult), label: m[0].trim() });
    last = m.index + m[0].length;
  }
  if (last < step.length) segs.push({ text: step.slice(last) });
  return segs.length ? segs : [{ text: step }];
}
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime); o.start();
    o.stop(ctx.currentTime + 0.7);
  } catch (_) { /* audio not allowed */ }
}
function fmtClock(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

window.recipePage = function recipePage() {
  return {
    recipe: null,
    loading: true,
    error: null,
    scale: 1,
    system: 'us',
    keepAwake: false,
    _wakeLock: null,
    checkedIng: {},
    checkedStep: {},
    timers: [],
    _timerInt: null,
    _tid: 1,
    cookMode: false,
    cookStep: 0,

    get id() { return new URLSearchParams(window.location.search).get('id'); },
    get totalTime() { return this.recipe ? (this.recipe.prep_time_minutes || 0) + (this.recipe.cook_time_minutes || 0) : 0; },
    get scaleLabel() { return fmtFrac(this.scale) + '×'; },

    get canEdit() {
      const a = window.Alpine?.store('auth');
      if (!a || !this.recipe) return false;
      if (a.isAdmin) return true;
      const me = (a.user?.email || '').toLowerCase();
      return !!me && me === (this.recipe.created_by || '').toLowerCase();
    },

    get converted() { return (this.recipe?.ingredients || []).map((l) => transform(l, this.scale, this.system)); },
    get convertedSteps() { return (this.recipe?.instructions || []).map((s) => convertTemps(s, this.system)); },
    get stepSegments() { return this.convertedSteps.map(parseTimers); },
    get scaledServings() {
      const s = this.recipe?.servings;
      return s && this.scale !== 1 ? transform(String(s), this.scale, 'us') : s;
    },

    incScale() { this.scale = Math.round((this.scale + 0.5) * 2) / 2; },
    decScale() { if (this.scale > 0.5) this.scale = Math.round((this.scale - 0.5) * 2) / 2; },

    // ── favorites ──
    async toggleFavorite() {
      const v = !this.recipe.is_favorite;
      const { error } = await supabase.rpc('set_favorite', { rid: this.recipe.id, val: v });
      if (error) { Alpine.store('ui').showToast('Could not update favorite.'); return; }
      this.recipe.is_favorite = v;
    },

    // ── check off ──
    toggleIng(i) { this.checkedIng[i] = !this.checkedIng[i]; },
    toggleStep(i) { this.checkedStep[i] = !this.checkedStep[i]; },

    // ── timers ──
    startTimer(seconds, label) {
      this.timers.push({ id: this._tid++, label, remaining: seconds });
      if (!this._timerInt) {
        this._timerInt = setInterval(() => {
          for (const t of this.timers) t.remaining--;
          const done = this.timers.filter((t) => t.remaining <= 0);
          for (const t of done) this._fire(t);
          this.timers = this.timers.filter((t) => t.remaining > 0);
          if (!this.timers.length) { clearInterval(this._timerInt); this._timerInt = null; }
        }, 1000);
      }
    },
    _fire(t) {
      beep();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      Alpine.store('ui').showToast(`⏰ Timer done: ${t.label}`, 10000);
    },
    stopTimer(id) {
      this.timers = this.timers.filter((t) => t.id !== id);
      if (!this.timers.length && this._timerInt) { clearInterval(this._timerInt); this._timerInt = null; }
    },
    clock: fmtClock,

    // ── cook mode ──
    enterCook() { this.cookStep = 0; this.cookMode = true; if (this.wakeSupported && !this.keepAwake) { this.keepAwake = true; this._syncWake(); } },
    exitCook() { this.cookMode = false; },
    cookNext() { if (this.cookStep < this.convertedSteps.length - 1) this.cookStep++; },
    cookPrev() { if (this.cookStep > 0) this.cookStep--; },

    // ── keep screen on ──
    get wakeSupported() { return 'wakeLock' in navigator; },
    toggleWake() { this.keepAwake = !this.keepAwake; this._syncWake(); },
    async _syncWake() {
      try {
        if (this.keepAwake && !this._wakeLock && document.visibilityState === 'visible') {
          this._wakeLock = await navigator.wakeLock.request('screen');
          this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
        } else if (!this.keepAwake && this._wakeLock) { await this._wakeLock.release(); this._wakeLock = null; }
      } catch (_) { this.keepAwake = false; }
    },

    async init() {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._syncWake(); });
      if (!this.id) { this.error = 'No recipe specified.'; this.loading = false; return; }
      const { data, error } = await supabase.from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error) this.error = "Couldn't load this recipe.";
      else if (!data) this.error = 'Recipe not found.';
      else this.recipe = data;
      this.loading = false;
    },

    async share() {
      const url = window.location.href, title = this.recipe?.title || 'Recipe';
      if (navigator.share) { try { await navigator.share({ title, text: `${title} — Mom's Kitchen`, url }); } catch (_) {} return; }
      try { await navigator.clipboard.writeText(url); Alpine.store('ui').showToast('Link copied!'); }
      catch (_) { Alpine.store('ui').showToast('Copy this link: ' + url); }
    },

    async del() {
      if (!confirm(`Delete "${this.recipe.title}"? This can't be undone.`)) return;
      const { error } = await supabase.from('recipes').delete().eq('id', this.recipe.id);
      if (error) Alpine.store('ui').showToast('Delete failed: ' + error.message);
      else window.location.href = '/';
    },
  };
};

/**
 * recipe.js — single recipe detail. Reads ?id= from the query string.
 * Serving scaler (½ steps) + US/Metric conversion, done client-side by parsing
 * the leading amount/unit of each free-text ingredient line. Best-effort: lines
 * it can't parse pass through unchanged.
 *
 * NOTE: this is the metric-conversion branch — main has scaling only.
 */

import { supabase } from '../supabase.js';

const UF = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const UFC = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[${UFC}]|[${UFC}]|\\d*\\.?\\d+)`;

function toNum(tok) {
  tok = tok.trim();
  let m;
  if ((m = tok.match(new RegExp(`^(\\d+)?\\s*([${UFC}])$`)))) return (m[1] ? +m[1] : 0) + UF[m[2]];
  if ((m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = tok.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

const NICE = [
  [0, ''], [0.125, '⅛'], [1 / 6, '⅙'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'],
  [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, ''],
];
function fmtFrac(n) {
  if (!isFinite(n) || n <= 0) return '0';
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  let best = null, diff = 0.05;
  for (const [v, g] of NICE) { const d = Math.abs(frac - v); if (d < diff) { diff = d; best = { v, g }; } }
  if (best) {
    const w = whole + (best.v === 1 ? 1 : 0), g = best.v === 1 ? '' : best.g;
    if (w === 0 && g) return g;
    return g ? `${w} ${g}` : String(w);
  }
  return String(Math.round(n * 100) / 100);
}
const round5 = (x) => Math.round(x / 5) * 5;
const round2 = (x) => Math.round(x * 100) / 100;

const UNITS = {
  cup: { sys: 'us', cat: 'vol', base: 236.588 }, cups: { sys: 'us', cat: 'vol', base: 236.588 },
  tbsp: { sys: 'us', cat: 'vol', base: 14.7868 }, tbsps: { sys: 'us', cat: 'vol', base: 14.7868 },
  tablespoon: { sys: 'us', cat: 'vol', base: 14.7868 }, tablespoons: { sys: 'us', cat: 'vol', base: 14.7868 },
  tsp: { sys: 'us', cat: 'vol', base: 4.92892 }, tsps: { sys: 'us', cat: 'vol', base: 4.92892 },
  teaspoon: { sys: 'us', cat: 'vol', base: 4.92892 }, teaspoons: { sys: 'us', cat: 'vol', base: 4.92892 },
  oz: { sys: 'us', cat: 'wt', base: 28.3495 }, ounce: { sys: 'us', cat: 'wt', base: 28.3495 }, ounces: { sys: 'us', cat: 'wt', base: 28.3495 },
  lb: { sys: 'us', cat: 'wt', base: 453.592 }, lbs: { sys: 'us', cat: 'wt', base: 453.592 },
  pound: { sys: 'us', cat: 'wt', base: 453.592 }, pounds: { sys: 'us', cat: 'wt', base: 453.592 },
  ml: { sys: 'metric', cat: 'vol', base: 1 }, milliliter: { sys: 'metric', cat: 'vol', base: 1 }, milliliters: { sys: 'metric', cat: 'vol', base: 1 },
  l: { sys: 'metric', cat: 'vol', base: 1000 }, liter: { sys: 'metric', cat: 'vol', base: 1000 }, liters: { sys: 'metric', cat: 'vol', base: 1000 }, litre: { sys: 'metric', cat: 'vol', base: 1000 }, litres: { sys: 'metric', cat: 'vol', base: 1000 },
  g: { sys: 'metric', cat: 'wt', base: 1 }, gram: { sys: 'metric', cat: 'wt', base: 1 }, grams: { sys: 'metric', cat: 'wt', base: 1 },
  kg: { sys: 'metric', cat: 'wt', base: 1000 }, kilogram: { sys: 'metric', cat: 'wt', base: 1000 }, kilograms: { sys: 'metric', cat: 'wt', base: 1000 },
};

function convertUnit(amount, info, target) {
  const baseVal = amount * info.base;
  if (target === 'metric') {
    if (info.cat === 'vol') return baseVal >= 1000 ? { amount: round2(baseVal / 1000), unit: 'L', frac: false } : { amount: round5(baseVal), unit: 'ml', frac: false };
    return baseVal >= 1000 ? { amount: round2(baseVal / 1000), unit: 'kg', frac: false } : { amount: round5(baseVal), unit: 'g', frac: false };
  }
  if (info.cat === 'vol') {
    const cups = baseVal / 236.588;
    if (cups >= 0.25) return { amount: cups, unit: cups === 1 ? 'cup' : 'cups', frac: true };
    const tbsp = baseVal / 14.7868;
    if (tbsp >= 1) return { amount: tbsp, unit: 'tbsp', frac: true };
    return { amount: baseVal / 4.92892, unit: 'tsp', frac: true };
  }
  const oz = baseVal / 28.3495;
  if (oz >= 16) return { amount: oz / 16, unit: oz / 16 === 1 ? 'lb' : 'lbs', frac: true };
  return { amount: oz, unit: 'oz', frac: true };
}
const fmtAmt = (a, frac) => (frac ? fmtFrac(a) : String(a));

// Scale by f and (optionally) convert the leading amount of a line to `system`.
function transform(line, f, system) {
  const re = new RegExp(`^(\\s*)(${QTY})(?:\\s*[-–]\\s*(${QTY}))?\\s*([A-Za-z]+\\.?)?`);
  const m = line.match(re);
  if (!m) return line;
  let a1 = toNum(m[2]);
  if (a1 == null) return line;
  let a2 = m[3] != null ? toNum(m[3]) : null;
  a1 *= f; if (a2 != null) a2 *= f;
  const rawUnit = (m[4] || '').replace(/\.$/, '');
  const info = UNITS[rawUnit.toLowerCase()];
  const rest = line.slice(m[0].length);
  if (info && system !== info.sys) {
    const c1 = convertUnit(a1, info, system);
    let amt = fmtAmt(c1.amount, c1.frac);
    if (a2 != null) { const c2 = convertUnit(a2, info, system); amt += '–' + fmtAmt(c2.amount, c2.frac); }
    return `${m[1]}${amt} ${c1.unit}${rest}`;
  }
  let amt = fmtFrac(a1) + (a2 != null ? '–' + fmtFrac(a2) : '');
  return `${m[1]}${amt}${rawUnit ? ' ' + rawUnit : ''}${rest}`;
}

// Oven temps in instructions: °F → °C when viewing metric.
function convertTemps(text, system) {
  if (system !== 'metric') return text;
  return text.replace(/(\d{2,3})\s*°?\s*(?:F\b|degrees(?:\s*F)?)/gi, (_, f) => `${round5((+f - 32) * 5 / 9)}°C`);
}

window.recipePage = function recipePage() {
  return {
    recipe: null,
    loading: true,
    error: null,
    scale: 1,
    system: 'us',

    get id() {
      return new URLSearchParams(window.location.search).get('id');
    },

    get totalTime() {
      if (!this.recipe) return 0;
      return (this.recipe.prep_time_minutes || 0) + (this.recipe.cook_time_minutes || 0);
    },

    get scaleLabel() { return fmtFrac(this.scale) + '×'; },

    get canEdit() {
      const auth = window.Alpine?.store('auth');
      if (!auth || !this.recipe) return false;
      if (auth.isAdmin) return true;
      const me = (auth.user?.email || '').toLowerCase();
      return !!me && me === (this.recipe.created_by || '').toLowerCase();
    },

    get converted() {
      return (this.recipe?.ingredients || []).map((l) => transform(l, this.scale, this.system));
    },
    get convertedSteps() {
      return (this.recipe?.instructions || []).map((s) => convertTemps(s, this.system));
    },
    get scaledServings() {
      const s = this.recipe?.servings;
      return s && this.scale !== 1 ? transform(String(s), this.scale, 'us') : s;
    },

    incScale() { this.scale = Math.round((this.scale + 0.5) * 2) / 2; },
    decScale() { if (this.scale > 0.5) this.scale = Math.round((this.scale - 0.5) * 2) / 2; },

    async init() {
      if (!this.id) {
        this.error = 'No recipe specified.';
        this.loading = false;
        return;
      }
      const { data, error } = await supabase
        .from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error) this.error = "Couldn't load this recipe.";
      else if (!data) this.error = 'Recipe not found.';
      else this.recipe = data;
      this.loading = false;
    },

    async share() {
      const url = window.location.href;
      const title = this.recipe?.title || 'Recipe';
      if (navigator.share) {
        try { await navigator.share({ title, text: `${title} — Mom's Kitchen`, url }); } catch (_) { /* dismissed */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        Alpine.store('ui').showToast('Link copied!');
      } catch (_) {
        Alpine.store('ui').showToast('Copy this link: ' + url);
      }
    },

    async del() {
      if (!confirm(`Delete "${this.recipe.title}"? This can't be undone.`)) return;
      const { error } = await supabase.from('recipes').delete().eq('id', this.recipe.id);
      if (error) Alpine.store('ui').showToast('Delete failed: ' + error.message);
      else window.location.href = '/';
    },
  };
};

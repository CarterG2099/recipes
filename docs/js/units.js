/**
 * units.js — structured-ingredient helpers (metric-conversion branch).
 *
 * A structured ingredient is { qty: number|null, unit: string|null, item: string }.
 * qty is in the unit's own terms (e.g., 1 "cup"). null qty = a free note ("Salt
 * to taste"). This module parses legacy text into that shape, formats it back to
 * text, and scales/converts it exactly between US and metric.
 */

// Registry: base is ml (volume) or g (weight). Units without an entry (clove,
// can, pinch, "") don't convert — they only scale.
export const UNITS = {
  cup:  { label: 'cup',  plural: 'cups', sys: 'us', cat: 'vol', base: 236.588 },
  tbsp: { label: 'tbsp', sys: 'us', cat: 'vol', base: 14.7868 },
  tsp:  { label: 'tsp',  sys: 'us', cat: 'vol', base: 4.92892 },
  oz:   { label: 'oz',   sys: 'us', cat: 'wt',  base: 28.3495 },
  lb:   { label: 'lb',   plural: 'lbs', sys: 'us', cat: 'wt', base: 453.592 },
  ml:   { label: 'ml',   sys: 'metric', cat: 'vol', base: 1 },
  l:    { label: 'L',    sys: 'metric', cat: 'vol', base: 1000 },
  g:    { label: 'g',    sys: 'metric', cat: 'wt',  base: 1 },
  kg:   { label: 'kg',   sys: 'metric', cat: 'wt',  base: 1000 },
};

// Options for the manual-entry dropdown (value '' = no unit / count).
export const UNIT_OPTIONS = [
  { value: '', label: '(none)' },
  { value: 'cup', label: 'cup' }, { value: 'tbsp', label: 'tbsp' }, { value: 'tsp', label: 'tsp' },
  { value: 'oz', label: 'oz' }, { value: 'lb', label: 'lb' },
  { value: 'ml', label: 'ml' }, { value: 'l', label: 'L' }, { value: 'g', label: 'g' }, { value: 'kg', label: 'kg' },
  { value: 'clove', label: 'clove' }, { value: 'can', label: 'can' }, { value: 'pinch', label: 'pinch' },
];

// Map common spellings/abbreviations to a registry key.
const ALIASES = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  clove: 'clove', cloves: 'clove', can: 'can', cans: 'can', pinch: 'pinch', pinches: 'pinch',
};

const UF = { '½': .5, '⅓': 1/3, '⅔': 2/3, '¼': .25, '¾': .75, '⅕': .2, '⅖': .4, '⅗': .6, '⅘': .8, '⅙': 1/6, '⅚': 5/6, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const UFC = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[${UFC}]|[${UFC}]|\\d*\\.?\\d+)`;

export function parseQty(tok) {
  if (tok == null) return null;
  tok = String(tok).trim();
  if (!tok) return null;
  let m;
  if ((m = tok.match(new RegExp(`^(\\d+)?\\s*([${UFC}])$`)))) return (m[1] ? +m[1] : 0) + UF[m[2]];
  if ((m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = tok.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

const NICE = [[0, ''], [.125, '⅛'], [1/6, '⅙'], [.25, '¼'], [1/3, '⅓'], [.375, '⅜'], [.5, '½'], [.625, '⅝'], [2/3, '⅔'], [.75, '¾'], [.875, '⅞'], [1, '']];
export function fmtFrac(n) {
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

// Parse one free-text ingredient line into { qty, unit, item }.
export function parseIngredient(line) {
  const re = new RegExp(`^(\\s*)(${QTY})(?:\\s*[-–]\\s*${QTY})?\\s*([A-Za-z]+\\.?)?\\s*(.*)$`, 's');
  const m = String(line).match(re);
  if (!m || parseQty(m[2]) == null) return { qty: null, unit: null, item: String(line).trim() };
  const qty = parseQty(m[2]);
  const word = (m[3] || '').replace(/\.$/, '').toLowerCase();
  const unit = ALIASES[word] || null;
  const item = (unit ? m[4] : ((m[3] || '') + (m[3] ? ' ' : '') + m[4])).trim();
  return { qty, unit, item };
}

function unitLabel(key, amount) {
  const u = UNITS[key];
  if (u) return (u.plural && amount > 1) ? u.plural : u.label;
  // unknown/count unit: pluralize simple words crudely
  return key + (amount > 1 && /^(clove|can|pinch)$/.test(key) ? 's' : '');
}

function convert(amount, key, target) {
  const u = UNITS[key];
  const base = amount * u.base;
  if (target === 'metric') {
    if (u.cat === 'vol') return base >= 1000 ? { a: round2(base / 1000), unit: 'L', frac: false } : { a: round5(base), unit: 'ml', frac: false };
    return base >= 1000 ? { a: round2(base / 1000), unit: 'kg', frac: false } : { a: round5(base), unit: 'g', frac: false };
  }
  if (u.cat === 'vol') {
    const cups = base / 236.588;
    if (cups >= 0.25) return { a: cups, unit: cups === 1 ? 'cup' : 'cups', frac: true };
    const tbsp = base / 14.7868;
    if (tbsp >= 1) return { a: tbsp, unit: 'tbsp', frac: true };
    return { a: base / 4.92892, unit: 'tsp', frac: true };
  }
  const oz = base / 28.3495;
  if (oz >= 16) return { a: oz / 16, unit: oz / 16 === 1 ? 'lb' : 'lbs', frac: true };
  return { a: oz, unit: 'oz', frac: true };
}

// Format a structured ingredient, scaled by `factor`, in unit `system`.
export function formatStruct(ing, factor = 1, system = 'us') {
  const item = (ing.item || '').trim();
  if (ing.qty == null) return item;            // free note
  const qty = ing.qty * factor;
  const key = ing.unit;
  const u = key ? UNITS[key] : null;
  if (u && system !== u.sys) {                 // convertible & different system
    const c = convert(qty, key, system);
    const amt = c.frac ? fmtFrac(c.a) : String(c.a);
    return `${amt} ${c.unit} ${item}`.trim();
  }
  // same system / unconvertible / no unit: scale only
  const metric = u && u.sys === 'metric';
  const amt = metric ? String(round2(qty)) : fmtFrac(qty);
  const lbl = key ? ' ' + unitLabel(key, qty) : '';
  return `${amt}${lbl} ${item}`.trim();
}

// Plain text (no scale/convert) for storing the `ingredients` text column.
export function structToText(ing) {
  if (ing.qty == null) return (ing.item || '').trim();
  const lbl = ing.unit ? ' ' + unitLabel(ing.unit, ing.qty) : '';
  return `${fmtFrac(ing.qty)}${lbl} ${ing.item || ''}`.trim();
}

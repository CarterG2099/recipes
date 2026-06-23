/**
 * cooking.js — pure, framework-free helpers shared by the recipe & browse pages.
 * Kept side-effect-free (no window/DOM/Supabase) so it can be unit-tested directly.
 *   • quantity parsing + fraction formatting
 *   • serving scaling + US/Metric conversion of a free-text ingredient line
 *   • oven-temp conversion in instructions
 *   • splitting a step into text + tappable timer chips
 *   • recipe list filtering/sorting
 */

const UF = { '½': .5, '⅓': 1/3, '⅔': 2/3, '¼': .25, '¾': .75, '⅕': .2, '⅖': .4, '⅗': .6, '⅘': .8, '⅙': 1/6, '⅚': 5/6, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const UFC = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[${UFC}]|[${UFC}]|\\d*\\.?\\d+)`;

export function parseQty(tok) {
  if (tok == null) return null;
  tok = String(tok).trim();
  if (!tok) return null;
  let m;
  if ((m = tok.match(new RegExp(`^(\\d+)?\\s*([${UFC}])$`)))) return (m[1] ? +m[1] : 0) + UF[m[2]];
  if ((m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[3] ? +m[1] + +m[2] / +m[3] : null;
  if ((m = tok.match(/^(\d+)\/(\d+)$/))) return +m[2] ? +m[1] / +m[2] : null;
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

const NICE = [[0,''],[.125,'⅛'],[1/6,'⅙'],[.25,'¼'],[1/3,'⅓'],[.375,'⅜'],[.5,'½'],[.625,'⅝'],[2/3,'⅔'],[.75,'¾'],[.875,'⅞'],[1,'']];
export function fmtFrac(n) {
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
const fracPair = (a, b) => fmtFrac(a) + (b != null ? '–' + fmtFrac(b) : '');
const plainPair = (a, b) => String(round2(a)) + (b != null ? '–' + String(round2(b)) : '');
const unitInfo = (w) => (w ? UNITS[w.replace(/\.$/, '').toLowerCase()] : undefined);

/**
 * Scale a free-text ingredient line by `f` and convert to `system`.
 * Scales EVERY "<qty> <unit>" in the line (incl. parentheticals) plus a leading
 * bare count. If the line already mixes US + metric units, it scales both and
 * does not convert (the recipe already gives both systems).
 */
export function transform(line, f, system) {
  if (line == null) return '';
  line = String(line);
  const leadWs = line.match(/^\s*/)[0].length;

  // Detect whether the line already carries both systems.
  let hasUs = false, hasMetric = false;
  for (const mm of line.matchAll(new RegExp(`${QTY}(?:\\s*[-–]\\s*${QTY})?\\s*([A-Za-z]+)`, 'g'))) {
    const u = unitInfo(mm[1]);
    if (u) (u.sys === 'us' ? (hasUs = true) : (hasMetric = true));
  }
  const dual = hasUs && hasMetric;

  const re = new RegExp(`(${QTY})(?:\\s*[-–]\\s*(${QTY}))?(\\s*)([A-Za-z]+\\.?)?`, 'g');
  return line.replace(re, (full, q1, q2, sp, word, offset) => {
    const a1 = parseQty(q1);
    if (a1 == null) return full;
    const a2 = q2 != null ? parseQty(q2) : null;
    const s1 = a1 * f, s2 = a2 != null ? a2 * f : null;
    const info = unitInfo(word);
    if (info) {
      if (!dual && system !== info.sys) {            // single-system: convert
        const c1 = convertUnit(s1, info, system);
        let amt = fmtAmt(c1.amount, c1.frac);
        if (s2 != null) { const c2 = convertUnit(s2, info, system); amt += '–' + fmtAmt(c2.amount, c2.frac); }
        return `${amt} ${c1.unit}`;
      }
      const amt = info.sys === 'metric' ? plainPair(s1, s2) : fracPair(s1, s2);
      return `${amt} ${word.replace(/\.$/, '')}`;       // keep unit, just scale
    }
    // No known unit: scale only if it's the leading count; leave other numbers alone.
    if (offset === leadWs) return `${fracPair(s1, s2)}${sp}${word || ''}`;
    return full;
  });
}

/** Convert oven temps (°F → °C) in instruction text when viewing metric. */
export function convertTemps(text, system) {
  if (text == null) return '';
  if (system !== 'metric') return String(text);
  return String(text).replace(/(\d{2,3})\s*°?\s*(?:F\b|degrees(?:\s*F)?)/gi, (_, f) => `${round5((+f - 32) * 5 / 9)}°C`);
}

const TIME_RE = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
/** Split a step into segments: {text} runs and {timer: seconds, label} chips. */
export function parseTimers(step) {
  step = step == null ? '' : String(step);
  const segs = []; let last = 0, m; TIME_RE.lastIndex = 0;
  while ((m = TIME_RE.exec(step)) !== null) {
    if (m[0].length === 0) { TIME_RE.lastIndex++; continue; }
    if (m.index > last) segs.push({ text: step.slice(last, m.index) });
    const u = m[2].toLowerCase(), mult = u[0] === 'h' ? 3600 : u[0] === 's' ? 1 : 60;
    segs.push({ timer: Math.round(parseFloat(m[1]) * mult), label: m[0].trim() });
    last = m.index + m[0].length;
  }
  if (last < step.length) segs.push({ text: step.slice(last) });
  return segs.length ? segs : [{ text: step }];
}

/** mm:ss for a non-negative second count. */
export function fmtClock(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Filter + sort the recipe list for the browse page. */
export function filterRecipes(all, { search = '', activeTags = [], favoritesOnly = false, sort = 'oldest' } = {}) {
  const q = String(search).trim().toLowerCase();
  let list = (all || []).filter((r) => {
    if (favoritesOnly && !r.is_favorite) return false;
    if (activeTags.length && !activeTags.every((t) => (r.tags || []).includes(t))) return false;
    if (!q) return true;
    const hay = [r.title || '', r.description || '', ...(r.ingredients || []), ...(r.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (sort === 'az') list = [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  else if (sort === 'newest') list = [...list].reverse();
  return list;
}

/**
 * recipe.js — single recipe detail. Reads ?id= from the query string.
 * Includes a client-side serving scaler (½ increments) that rewrites the leading
 * quantity in each free-text ingredient line — no structured data needed.
 */

import { supabase } from '../supabase.js';

const UF = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const UF_CLASS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
// A single quantity token: "1 1/2", "1/2", "1½", "½", "1.5", "2"
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[${UF_CLASS}]|[${UF_CLASS}]|\\d*\\.?\\d+)`;

function tokenToNumber(tok) {
  tok = tok.trim();
  let m;
  if ((m = tok.match(new RegExp(`^(\\d+)?\\s*([${UF_CLASS}])$`)))) {
    return (m[1] ? parseInt(m[1], 10) : 0) + UF[m[2]];
  }
  if ((m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/))) {
    return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
  }
  if ((m = tok.match(/^(\d+)\/(\d+)$/))) return parseInt(m[1], 10) / parseInt(m[2], 10);
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

const NICE = [
  [0, ''], [0.125, '⅛'], [1 / 6, '⅙'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'],
  [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, ''],
];

function formatQty(n) {
  if (!isFinite(n) || n <= 0) return '0';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  let best = null, bestDiff = 0.05; // tolerance
  for (const [val, glyph] of NICE) {
    const d = Math.abs(frac - val);
    if (d < bestDiff) { bestDiff = d; best = { val, glyph }; }
  }
  if (best) {
    let w = whole + (best.val === 1 ? 1 : 0);
    const g = best.val === 1 ? '' : best.glyph;
    if (w === 0 && g) return g;
    if (g) return `${w} ${g}`;
    return String(w);
  }
  // No clean fraction — round to 2 decimals, trim trailing zeros.
  return String(Math.round(n * 100) / 100);
}

// Rewrite the leading quantity (and optional range) of a line, scaled by f.
function scaleLine(line, f) {
  if (f === 1) return line;
  const re = new RegExp(`^(\\s*)(${QTY})(\\s*[-–]\\s*(${QTY}))?`);
  const m = line.match(re);
  if (!m) return line;
  const a = tokenToNumber(m[2]);
  if (a == null) return line;
  let out = formatQty(a * f);
  if (m[4]) {
    const b = tokenToNumber(m[4]);
    if (b != null) out += '–' + formatQty(b * f);
  }
  return m[1] + out + line.slice(m[0].length);
}

window.recipePage = function recipePage() {
  return {
    recipe: null,
    loading: true,
    error: null,
    scale: 1,

    get id() {
      return new URLSearchParams(window.location.search).get('id');
    },

    get totalTime() {
      if (!this.recipe) return 0;
      return (this.recipe.prep_time_minutes || 0) + (this.recipe.cook_time_minutes || 0);
    },

    get scaleLabel() {
      return formatQty(this.scale) + '×';
    },

    // Admins can edit anything; other editors only recipes they created.
    get canEdit() {
      const auth = window.Alpine?.store('auth');
      if (!auth || !this.recipe) return false;
      if (auth.isAdmin) return true;
      const me = (auth.user?.email || '').toLowerCase();
      return !!me && me === (this.recipe.created_by || '').toLowerCase();
    },

    get scaledIngredients() {
      const list = this.recipe?.ingredients || [];
      return this.scale === 1 ? list : list.map((l) => scaleLine(l, this.scale));
    },

    get scaledServings() {
      const s = this.recipe?.servings;
      if (!s) return s;
      return this.scale === 1 ? s : scaleLine(String(s), this.scale);
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
      // Native share sheet on mobile (messages, social, etc.); copy link elsewhere.
      if (navigator.share) {
        try {
          await navigator.share({ title, text: `${title} — Mom's Kitchen`, url });
        } catch (_) { /* user dismissed the share sheet */ }
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
      if (error) {
        Alpine.store('ui').showToast('Delete failed: ' + error.message);
      } else {
        window.location.href = '/';
      }
    },
  };
};

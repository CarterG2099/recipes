/**
 * recipe.js — single recipe detail (metric-conversion branch).
 * Renders structured ingredients (recipes.ingredients_struct) when present,
 * else parses the legacy free-text lines. Scaling (½ steps) + US/Metric toggle
 * are exact on structured data, best-effort on parsed text.
 */

import { supabase } from '../supabase.js';
import { parseIngredient, formatStruct, parseQty, fmtFrac } from '../units.js';

// Oven temps in instructions: °F → °C when viewing metric.
function convertTemps(text, system) {
  if (system !== 'metric') return text;
  return text.replace(/(\d{2,3})\s*°?\s*(?:F\b|degrees(?:\s*F)?)/gi,
    (_, f) => `${Math.round((+f - 32) * 5 / 9 / 5) * 5}°C`);
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

    // Structured ingredients if the recipe has them, else parse the text lines.
    get structIngredients() {
      const s = this.recipe?.ingredients_struct;
      if (Array.isArray(s) && s.length) return s;
      return (this.recipe?.ingredients || []).map(parseIngredient);
    },

    get converted() {
      return this.structIngredients.map((i) => formatStruct(i, this.scale, this.system));
    },
    get convertedSteps() {
      return (this.recipe?.instructions || []).map((s) => convertTemps(s, this.system));
    },
    get scaledServings() {
      const s = this.recipe?.servings;
      if (!s || this.scale === 1) return s;
      const m = String(s).match(/^(\s*)(\d*\.?\d+)(.*)$/);
      if (!m) return s;
      return `${m[1]}${fmtFrac(parseQty(m[2]) * this.scale)}${m[3]}`;
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

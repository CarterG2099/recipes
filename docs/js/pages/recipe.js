/**
 * recipe.js — single recipe detail. Reads ?id= from the query string.
 */

import { supabase } from '../supabase.js';

window.recipePage = function recipePage() {
  return {
    recipe: null,
    loading: true,
    error: null,

    get id() {
      return new URLSearchParams(window.location.search).get('id');
    },

    // Return to wherever the visitor came from (keeping their search/scroll);
    // fall back to the recipe list if they arrived via a direct link.
    goBack() {
      const cameFromSite = document.referrer && new URL(document.referrer).origin === window.location.origin;
      if (cameFromSite && window.history.length > 1) window.history.back();
      else window.location.href = '/';
    },

    get totalTime() {
      if (!this.recipe) return 0;
      return (this.recipe.prep_time_minutes || 0) + (this.recipe.cook_time_minutes || 0);
    },

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

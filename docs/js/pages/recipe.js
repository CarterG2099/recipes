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

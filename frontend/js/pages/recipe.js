/**
 * recipe.js — single recipe detail. Reads ?id= from the query string.
 */

import { api } from '../api.js';

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
      try {
        this.recipe = await api.get(`/api/recipes/${this.id}`);
      } catch (e) {
        this.error = e.status === 404 ? 'Recipe not found.' : "Couldn't load this recipe.";
      }
      this.loading = false;
    },

    async del() {
      if (!confirm(`Delete "${this.recipe.title}"? This can't be undone.`)) return;
      try {
        await api.delete(`/api/recipes/${this.recipe.id}`);
        window.location.href = '/';
      } catch (e) {
        Alpine.store('ui').showToast('Delete failed: ' + (e.message || ''));
      }
    },
  };
};

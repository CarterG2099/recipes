/**
 * browse.js — recipe list with client-side search + tag filtering.
 * Loads the full collection once (personal-cookbook scale) and filters in memory.
 */

import { api } from '../api.js';

window.browsePage = function browsePage() {
  return {
    all: [],
    tags: [],
    search: '',
    activeTag: null,
    loading: true,
    error: null,

    async init() {
      try {
        const [recipes, tags] = await Promise.all([
          api.get('/api/recipes'),
          api.get('/api/recipes/tags'),
        ]);
        this.all = recipes.recipes || [];
        this.tags = tags.tags || [];
      } catch (e) {
        this.error = "Couldn't load recipes. " + (e.message || '');
      }
      this.loading = false;
    },

    get filtered() {
      const q = this.search.trim().toLowerCase();
      return this.all.filter(r => {
        if (this.activeTag && !(r.tags || []).includes(this.activeTag)) return false;
        if (!q) return true;
        const hay = [
          r.title || '',
          r.description || '',
          ...(r.ingredients || []),
          ...(r.tags || []),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    },

    totalTime(r) {
      const total = (r.prep_time_minutes || 0) + (r.cook_time_minutes || 0);
      return total ? `${total} min` : '';
    },
  };
};

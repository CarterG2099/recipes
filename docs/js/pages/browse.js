/**
 * browse.js — recipe list with search, multi-tag filter, sort, and a favorites
 * filter. Loads the full collection once and filters/sorts in memory.
 */

import { supabase } from '../supabase.js';
import { filterRecipes } from '../cooking.js';

window.browsePage = function browsePage() {
  return {
    all: [],
    tags: [],
    search: '',
    activeTags: [],       // recipes must match ALL selected tags
    favoritesOnly: false,
    sort: 'oldest',       // oldest | newest | az
    loading: true,
    error: null,

    async init() {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, title, description, ingredients, prep_time_minutes, cook_time_minutes, servings, tags, is_favorite, created_at')
        .order('created_at', { ascending: true });
      if (error) {
        this.error = "Couldn't load recipes. " + error.message;
      } else {
        this.all = data || [];
        const seen = new Set();
        for (const r of this.all) for (const t of (r.tags || [])) if (t) seen.add(t);
        this.tags = [...seen].sort((a, b) => a.localeCompare(b));
      }
      this.loading = false;
    },

    toggleTag(t) {
      const i = this.activeTags.indexOf(t);
      if (i >= 0) this.activeTags.splice(i, 1);
      else this.activeTags.push(t);
    },
    isTagActive(t) { return this.activeTags.includes(t); },

    get filtered() {
      return filterRecipes(this.all, {
        search: this.search, activeTags: this.activeTags,
        favoritesOnly: this.favoritesOnly, sort: this.sort,
      });
    },

    totalTime(r) {
      const total = (r.prep_time_minutes || 0) + (r.cook_time_minutes || 0);
      return total ? `${total} min` : '';
    },
    metaLine(r) {
      const parts = [];
      const t = this.totalTime(r);
      if (t) parts.push(t);
      if (r.servings) parts.push(`serves ${r.servings}`);
      return parts.join(' · ');
    },
  };
};

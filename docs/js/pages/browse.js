/**
 * browse.js — recipe list with client-side search + tag filtering.
 * Reads straight from Supabase (public-read RLS); filters in memory at
 * personal-cookbook scale.
 */

import { supabase } from '../supabase.js';

window.browsePage = function browsePage() {
  return {
    all: [],
    tags: [],
    search: '',
    activeTag: null,
    loading: true,
    error: null,

    async init() {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, title, description, ingredients, prep_time_minutes, cook_time_minutes, servings, tags')
        .order('updated_at', { ascending: false });
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

    metaLine(r) {
      const parts = [];
      const t = this.totalTime(r);
      if (t) parts.push(t);
      if (r.servings) parts.push(`serves ${r.servings}`);
      return parts.join(' · ');
    },
  };
};

/**
 * browse.js — recipe list with search, multi-tag filter, sort, and a favorites
 * filter, plus Mine/Others when signed in (Mine includes the user's household; the tag
 * chips follow the view). Signed-out visitors see everything.
 * Loads the full collection once and filters/sorts in memory.
 */

import { supabase } from '../supabase.js';
import { filterRecipes, filterByOwner, collectTags } from '../cooking.js';

window.browsePage = function browsePage() {
  return {
    all: [],
    search: '',
    activeTags: [],       // recipes must match ALL selected tags
    favoritesOnly: false,
    // Bulk add links here with ?review=1 to show what it just saved.
    reviewOnly: new URLSearchParams(window.location.search).has('review'),
    owner: 'mine',       // mine | others — only applied when signed in
    sort: 'oldest',       // oldest | newest | az
    loading: true,
    error: null,

    async init() {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, title, description, ingredients, prep_time_minutes, cook_time_minutes, servings, tags, is_favorite, needs_review, created_by, created_at')
        .order('created_at', { ascending: true });
      if (error) {
        this.error = "Couldn't load recipes. " + error.message;
      } else {
        this.all = data || [];
      }
      this.loading = false;
    },

    setOwner(o) {
      if (this.owner === o) return;
      this.owner = o;
      this.activeTags = [];   // tags are per view; a selection from the other view would hide everything
    },

    // Signed in: Mine/Others over the user plus their household. Signed out: everything.
    get ownerFilter() {
      const a = Alpine.store('auth');
      const email = a.user?.email;
      return email
        ? { owner: this.owner, mine: [email, ...(a.household || [])] }
        : { owner: 'all', mine: [] };
    },

    get tags() {
      const { owner, mine } = this.ownerFilter;
      return collectTags(filterByOwner(this.all, owner, mine));
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
        favoritesOnly: this.favoritesOnly, reviewOnly: this.reviewOnly && this.showReview, sort: this.sort,
        ...this.ownerFilter,
      });
    },

    // "Needs review" is for editors, and only once there's something to review
    // in this view (or the filter is already on, so it can be turned off).
    get reviewCount() {
      const { owner, mine } = this.ownerFilter;
      return filterByOwner(this.all, owner, mine).filter((r) => r.needs_review).length;
    },
    get showReview() {
      return Boolean(Alpine.store('auth').isEditor) && (this.reviewCount > 0 || this.reviewOnly);
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

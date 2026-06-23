/**
 * recipe.js — single recipe detail.
 * Scaling (½ steps) + US/Metric conversion (heuristic text parse), favorites,
 * tap-to-check ingredients/steps, tap-to-start timers, cook mode, keep-screen-on.
 */

import { supabase } from '../supabase.js';
import { fmtFrac, transform, convertTemps, segmentStep, fmtClock } from '../cooking.js';

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime); o.start();
    o.stop(ctx.currentTime + 0.7);
  } catch (_) { /* audio not allowed */ }
}


window.recipePage = function recipePage() {
  return {
    recipe: null,
    loading: true,
    error: null,
    scale: 1,
    system: 'us',
    keepAwake: false,
    _wakeLock: null,
    checkedIng: {},
    checkedStep: {},
    timers: [],
    _timerInt: null,
    _tid: 1,
    cookMode: false,
    cookStep: 0,
    cookIngOpen: false,
    confirmDelete: false,

    get id() { return new URLSearchParams(window.location.search).get('id'); },
    get totalTime() { return this.recipe ? (this.recipe.prep_time_minutes || 0) + (this.recipe.cook_time_minutes || 0) : 0; },
    get scaleLabel() { return fmtFrac(this.scale) + '×'; },

    get canEdit() {
      const a = window.Alpine?.store('auth');
      if (!a || !this.recipe) return false;
      if (a.isAdmin) return true;
      const me = (a.user?.email || '').toLowerCase();
      return !!me && me === (this.recipe.created_by || '').toLowerCase();
    },

    get converted() { return (this.recipe?.ingredients || []).map((l) => transform(l, this.scale, this.system)); },
    get convertedSteps() { return (this.recipe?.instructions || []).map((s) => convertTemps(s, this.system)); },
    get stepSegments() { return this.convertedSteps.map(segmentStep); },
    get scaledServings() {
      const s = this.recipe?.servings;
      return s && this.scale !== 1 ? transform(String(s), this.scale, 'us') : s;
    },

    incScale() { this.scale = Math.round((this.scale + 0.5) * 2) / 2; },
    decScale() { if (this.scale > 0.5) this.scale = Math.round((this.scale - 0.5) * 2) / 2; },

    // ── favorites ──
    async toggleFavorite() {
      const v = !this.recipe.is_favorite;
      const { error } = await supabase.rpc('set_favorite', { rid: this.recipe.id, val: v });
      if (error) { Alpine.store('ui').showToast('Could not update favorite.'); return; }
      this.recipe.is_favorite = v;
    },

    // ── check off ──
    toggleIng(i) { this.checkedIng[i] = !this.checkedIng[i]; },
    toggleStep(i) { this.checkedStep[i] = !this.checkedStep[i]; },

    // ── timers ──
    // Track an absolute end time so the countdown stays accurate across phone
    // sleep / app-switch (where setInterval pauses): we recompute from the clock
    // and fire anything that elapsed while away the moment we're visible again.
    startTimer(seconds, label) {
      this.timers.push({ id: this._tid++, label, remaining: seconds, endsAt: Date.now() + seconds * 1000 });
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      if (!this._timerInt) this._timerInt = setInterval(() => this._tickTimers(), 1000);
    },
    _tickTimers() {
      const now = Date.now();
      for (const t of this.timers) t.remaining = Math.max(0, Math.round((t.endsAt - now) / 1000));
      this.timers.filter((t) => t.remaining <= 0).forEach((t) => this._fire(t));
      this.timers = this.timers.filter((t) => t.remaining > 0);
      if (!this.timers.length && this._timerInt) { clearInterval(this._timerInt); this._timerInt = null; }
    },
    _fire(t) {
      beep();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      Alpine.store('ui').showToast(`⏰ Timer done: ${t.label}`, 10000);
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification("Mom's Kitchen — timer done", { body: t.label, tag: 'mk-timer' });
        }
      } catch (_) { /* notifications unavailable */ }
    },
    bumpTimer(id, secs = 60) {
      const t = this.timers.find((x) => x.id === id);
      if (!t) return;
      t.endsAt += secs * 1000;
      t.remaining += secs;
    },
    stopTimer(id) {
      this.timers = this.timers.filter((t) => t.id !== id);
      if (!this.timers.length && this._timerInt) { clearInterval(this._timerInt); this._timerInt = null; }
    },
    clock: fmtClock,

    // ── cook mode ──
    enterCook() { this.cookStep = 0; this.cookIngOpen = false; this.cookMode = true; if (this.wakeSupported && !this.keepAwake) { this.keepAwake = true; this._syncWake(); } },
    exitCook() { this.cookMode = false; },
    cookNext() { if (this.cookStep < this.convertedSteps.length - 1) this.cookStep++; },
    cookPrev() { if (this.cookStep > 0) this.cookStep--; },

    // ── keep screen on ──
    get wakeSupported() { return 'wakeLock' in navigator; },
    toggleWake() { this.keepAwake = !this.keepAwake; this._syncWake(); },
    async _syncWake() {
      try {
        if (this.keepAwake && !this._wakeLock && document.visibilityState === 'visible') {
          this._wakeLock = await navigator.wakeLock.request('screen');
          this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
        } else if (!this.keepAwake && this._wakeLock) { await this._wakeLock.release(); this._wakeLock = null; }
      } catch (_) { this.keepAwake = false; }
    },

    async init() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        this._syncWake();
        if (this.timers.length) this._tickTimers(); // catch up timers that ran while away
      });
      if (!this.id) { this.error = 'No recipe specified.'; this.loading = false; return; }
      const { data, error } = await supabase.from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error) this.error = "Couldn't load this recipe.";
      else if (!data) this.error = 'Recipe not found.';
      else this.recipe = data;
      this.loading = false;
    },

    async share() {
      const url = window.location.href, title = this.recipe?.title || 'Recipe';
      if (navigator.share) { try { await navigator.share({ title, text: `${title} — Mom's Kitchen`, url }); } catch (_) {} return; }
      try { await navigator.clipboard.writeText(url); Alpine.store('ui').showToast('Link copied!'); }
      catch (_) { Alpine.store('ui').showToast('Copy this link: ' + url); }
    },

    del() { this.confirmDelete = true; },
    async doDelete() {
      const { error } = await supabase.from('recipes').delete().eq('id', this.recipe.id);
      if (error) {
        this.confirmDelete = false;
        Alpine.store('ui').showToast('Delete failed: ' + error.message);
      } else {
        window.location.href = '/';
      }
    },
  };
};

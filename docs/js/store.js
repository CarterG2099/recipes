/**
 * store.js — Alpine.js global stores (auth + ui), backed by supabase-js.
 */

import { supabase, signIn, signOut, checkEditor } from './supabase.js';

export function registerAuthStore() {
  Alpine.store('auth', {
    user: null,
    isLoggedIn: false,
    isEditor: false,
    ready: false,

    async init() {
      const { data } = await supabase.auth.getSession();
      await this._apply(data.session);
      // React to login/logout (including the OAuth redirect landing).
      supabase.auth.onAuthStateChange((_event, session) => this._apply(session));
    },

    async _apply(session) {
      this.user = session?.user ?? null;
      this.isLoggedIn = !!session;
      this.isEditor = session ? await checkEditor() : false;
      this.ready = true;
    },

    signIn,
    async logout() {
      await signOut();
      window.location.href = '/';
    },
  });
}

export function registerUiStore() {
  const saved = localStorage.getItem('theme') || 'system';

  Alpine.store('ui', {
    theme: saved,
    toast: null,
    _toastTimer: null,

    init() {
      this.applyTheme(this.theme);
    },

    setTheme(theme) {
      this.theme = theme;
      localStorage.setItem('theme', theme);
      this.applyTheme(theme);
    },

    toggleTheme() {
      this.setTheme(this.getEffectiveTheme() === 'dark' ? 'light' : 'dark');
    },

    applyTheme(theme) {
      const effective = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      document.documentElement.setAttribute('data-theme', effective);
    },

    getEffectiveTheme() {
      if (this.theme !== 'system') return this.theme;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },

    showToast(msg, duration = 4000) {
      clearTimeout(this._toastTimer);
      this.toast = { msg };
      this._toastTimer = setTimeout(() => { this.toast = null; }, duration);
    },

    dismissToast() {
      clearTimeout(this._toastTimer);
      this.toast = null;
    },
  });
}

export function registerAllStores() {
  registerAuthStore();
  registerUiStore();
}

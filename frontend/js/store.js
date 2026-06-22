/**
 * store.js — Alpine.js global stores (auth + ui)
 */

import { api } from './api.js';

// ── auth store ──────────────────────────────────────────────
// Reading is public; this only tracks whether the visitor is a logged-in editor
// so the UI can reveal Add/Edit/Delete controls.
export function registerAuthStore() {
  Alpine.store('auth', {
    user: null,
    isLoggedIn: false,
    isEditor: false,

    async init() {
      try {
        const data = await api.get('/auth/me');
        this.user = data;
        this.isLoggedIn = true;
        this.isEditor = !!data.is_editor;
      } catch (_) {
        this.isLoggedIn = false;
        this.isEditor = false;
      }
    },

    async logout() {
      try { await api.post('/auth/logout'); } catch (_) { }
      window.location.href = '/';
    },
  });
}

// ── ui store ────────────────────────────────────────────────
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
      const next = this.getEffectiveTheme() === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
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

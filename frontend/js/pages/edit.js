/**
 * edit.js — create/edit a recipe, with URL and PDF import that pre-fill the form.
 * Editor-only; the page route and the write/import APIs are independently gated.
 */

import { api } from '../api.js';

function emptyForm() {
  return {
    title: '',
    description: '',
    prep_time_minutes: null,
    cook_time_minutes: null,
    servings: '',
    tagsText: '',
    ingredients: [''],
    instructions: [''],
    source_url: '',
  };
}

window.editPage = function editPage() {
  return {
    form: emptyForm(),
    importUrlValue: '',
    importing: false,
    importWarning: '',
    saving: false,
    error: null,

    get id() {
      return new URLSearchParams(window.location.search).get('id');
    },

    async init() {
      if (!this.id) return;
      try {
        const r = await api.get(`/api/recipes/${this.id}`);
        this.form = {
          title: r.title || '',
          description: r.description || '',
          prep_time_minutes: r.prep_time_minutes ?? null,
          cook_time_minutes: r.cook_time_minutes ?? null,
          servings: r.servings || '',
          tagsText: (r.tags || []).join(', '),
          ingredients: (r.ingredients || []).length ? [...r.ingredients] : [''],
          instructions: (r.instructions || []).length ? [...r.instructions] : [''],
          source_url: r.source_url || '',
        };
      } catch (e) {
        this.error = "Couldn't load this recipe for editing.";
      }
    },

    _applyDraft(draft) {
      this.importWarning = draft.warning || '';
      if (draft.title) this.form.title = draft.title;
      if (draft.description) this.form.description = draft.description;
      if (draft.prep_time_minutes != null) this.form.prep_time_minutes = draft.prep_time_minutes;
      if (draft.cook_time_minutes != null) this.form.cook_time_minutes = draft.cook_time_minutes;
      if (draft.servings) this.form.servings = draft.servings;
      if (draft.source_url) this.form.source_url = draft.source_url;
      if ((draft.ingredients || []).length) this.form.ingredients = [...draft.ingredients];
      if ((draft.instructions || []).length) this.form.instructions = [...draft.instructions];
      if ((draft.tags || []).length) this.form.tagsText = draft.tags.join(', ');
    },

    async importUrl() {
      const url = this.importUrlValue.trim();
      if (!url) return;
      this.importing = true;
      this.importWarning = '';
      this.error = null;
      try {
        const draft = await api.post('/api/import/url', { url });
        this._applyDraft(draft);
        Alpine.store('ui').showToast('Imported — review and save.');
      } catch (e) {
        this.error = 'Import failed: ' + (e.message || '');
      }
      this.importing = false;
    },

    async importPdf(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true;
      this.importWarning = '';
      this.error = null;
      try {
        const fd = new FormData();
        fd.append('file', file);
        // Multipart upload bypasses the JSON api wrapper; talk to fetch directly.
        const res = await fetch('/api/import/pdf', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail || detail; } catch (_) { }
          throw new Error(detail);
        }
        this._applyDraft(await res.json());
        Alpine.store('ui').showToast('Extracted — review and save.');
      } catch (e) {
        this.error = 'PDF import failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.pdf) this.$refs.pdf.value = '';
    },

    _payload() {
      return {
        title: this.form.title.trim(),
        description: this.form.description.trim() || null,
        prep_time_minutes: this.form.prep_time_minutes || null,
        cook_time_minutes: this.form.cook_time_minutes || null,
        servings: this.form.servings.trim() || null,
        source_url: this.form.source_url.trim() || null,
        tags: this.form.tagsText.split(',').map(t => t.trim()).filter(Boolean),
        ingredients: this.form.ingredients.map(s => s.trim()).filter(Boolean),
        instructions: this.form.instructions.map(s => s.trim()).filter(Boolean),
      };
    },

    async save() {
      const payload = this._payload();
      if (!payload.title) {
        this.error = 'Title is required.';
        return;
      }
      this.saving = true;
      this.error = null;
      try {
        if (this.id) {
          await api.put(`/api/recipes/${this.id}`, payload);
          window.location.href = `/recipe?id=${this.id}`;
        } else {
          const res = await api.post('/api/recipes', payload);
          window.location.href = `/recipe?id=${res.id}`;
        }
      } catch (e) {
        this.error = 'Save failed: ' + (e.message || '');
        this.saving = false;
      }
    },
  };
};

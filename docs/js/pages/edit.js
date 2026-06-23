/**
 * edit.js — create/edit a recipe.
 *   • URL import  → import-url Edge Function
 *   • PDF import  → pdf.js in the browser
 *   • Photo import → uploads the image to Storage AND reads it via import-photo (Gemini)
 * Writes go through supabase-js and are enforced by the editor RLS policies.
 * The page redirects non-editors away (UX only; RLS is the real boundary).
 */

import { supabase } from '../supabase.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
const BUCKET = 'recipe-images';

const ING_HEADER = /^\s*ingredients\s*:?\s*$/i;
const STEP_HEADER = /^\s*(instructions|directions|method|steps|preparation)\s*:?\s*$/i;

function emptyForm() {
  return {
    title: '', description: '',
    prep_time_minutes: null, cook_time_minutes: null,
    servings: '', tagsText: '',
    ingredients: [''], instructions: [''],
    source_url: '', image_url: null,
  };
}

function parsePdfText(text) {
  const lines = text.split(/\r?\n/);
  const title = (lines.find(l => l.trim()) || '').trim();
  const ingredients = [];
  const instructions = [];
  let section = null;
  for (const line of lines) {
    if (ING_HEADER.test(line)) { section = 'ing'; continue; }
    if (STEP_HEADER.test(line)) { section = 'step'; continue; }
    const s = line.trim();
    if (!s) continue;
    if (section === 'ing') ingredients.push(s);
    else if (section === 'step') instructions.push(s);
  }
  const draft = { title, ingredients, instructions, tags: [] };
  if (!ingredients.length && !instructions.length) {
    draft.warning = "Couldn't detect Ingredients/Instructions headers in this PDF. " +
      'The full text was put in the description — please split it manually.';
    draft.description = text.trim().slice(0, 4000);
  }
  return draft;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/'; return; }
      const { data: editor } = await supabase.rpc('is_editor');
      if (!editor) { window.location.href = '/'; return; }

      if (!this.id) return;
      const { data, error } = await supabase.from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error || !data) { this.error = "Couldn't load this recipe for editing."; return; }
      this.form = {
        title: data.title || '',
        description: data.description || '',
        prep_time_minutes: data.prep_time_minutes ?? null,
        cook_time_minutes: data.cook_time_minutes ?? null,
        servings: data.servings || '',
        tagsText: (data.tags || []).join(', '),
        ingredients: (data.ingredients || []).length ? [...data.ingredients] : [''],
        instructions: (data.instructions || []).length ? [...data.instructions] : [''],
        source_url: data.source_url || '',
        image_url: data.image_url || null,
      };
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
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const { data, error } = await supabase.functions.invoke('import-url', { body: { url } });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        this._applyDraft(data);
        Alpine.store('ui').showToast('Imported — review and save.');
      } catch (e) {
        this.error = 'Import failed: ' + (e.message || '');
      }
      this.importing = false;
    },

    async importPdf(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        let text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          text += content.items.map(i => i.str).join(' ') + '\n';
        }
        this._applyDraft(parsePdfText(text));
        Alpine.store('ui').showToast('Extracted — review and save.');
      } catch (e) {
        this.error = 'PDF import failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.pdf) this.$refs.pdf.value = '';
    },

    // Snap/upload a recipe-card photo: store it AND read it with Gemini.
    async importPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const [url, imageBase64] = await Promise.all([uploadImage(file), fileToBase64(file)]);
        this.form.image_url = url;
        const { data, error } = await supabase.functions.invoke('import-photo', {
          body: { imageBase64, mimeType: file.type },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        this._applyDraft(data);
        Alpine.store('ui').showToast('Read from photo — review and save.');
      } catch (e) {
        this.error = 'Photo import failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.photo) this.$refs.photo.value = '';
    },

    // Attach/replace the stored photo without re-reading the recipe.
    async attachPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.error = null;
      try {
        this.form.image_url = await uploadImage(file);
        Alpine.store('ui').showToast('Photo added.');
      } catch (e) {
        this.error = 'Upload failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.attach) this.$refs.attach.value = '';
    },

    _payload() {
      return {
        title: this.form.title.trim(),
        description: this.form.description.trim() || null,
        prep_time_minutes: this.form.prep_time_minutes || null,
        cook_time_minutes: this.form.cook_time_minutes || null,
        servings: this.form.servings.trim() || null,
        source_url: this.form.source_url.trim() || null,
        image_url: this.form.image_url || null,
        tags: this.form.tagsText.split(',').map(t => t.trim()).filter(Boolean),
        ingredients: this.form.ingredients.map(s => s.trim()).filter(Boolean),
        instructions: this.form.instructions.map(s => s.trim()).filter(Boolean),
      };
    },

    async save() {
      const payload = this._payload();
      if (!payload.title) { this.error = 'Title is required.'; return; }
      this.saving = true; this.error = null;
      try {
        if (this.id) {
          const { error } = await supabase.from('recipes').update(payload).eq('id', this.id);
          if (error) throw new Error(error.message);
          window.location.href = `/recipe.html?id=${this.id}`;
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          const row = { ...payload, created_by: user?.email ?? null };
          const { data, error } = await supabase.from('recipes').insert(row).select('id').single();
          if (error) throw new Error(error.message);
          window.location.href = `/recipe.html?id=${data.id}`;
        }
      } catch (e) {
        this.error = 'Save failed: ' + (e.message || '');
        this.saving = false;
      }
    },
  };
};

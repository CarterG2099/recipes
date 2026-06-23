/**
 * edit.js — create/edit a recipe.
 *   • URL import   → import-url Edge Function (JSON-LD)
 *   • PDF import   → import-photo Edge Function (Gemini reads the PDF directly)
 *   • Photo import → downscales in-browser, uploads to Storage, AND reads via import-photo (Gemini)
 * Writes go through supabase-js and are enforced by the editor RLS policies.
 * The page redirects non-editors away (UX only; RLS is the real boundary).
 */

import { supabase } from '../supabase.js';

const BUCKET = 'recipe-images';
const MAX_EDGE = 1600;   // px — plenty for reading a card; keeps uploads small on mobile
const JPEG_QUALITY = 0.85;

function emptyForm() {
  return {
    title: '', description: '',
    prep_time_minutes: null, cook_time_minutes: null,
    servings: '', tagsText: '',
    ingredients: [''], instructions: [''],
    source_url: '', image_url: null,
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

// Shrink a phone photo and bake in EXIF rotation. Returns { blob, base64, mimeType }.
// Non-images (shouldn't happen here) pass through untouched.
async function prepImage(file) {
  if (!file.type.startsWith('image/')) {
    return { blob: file, base64: await blobToBase64(file), mimeType: file.type };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  return { blob, base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
}

async function uploadBlob(blob, ext, contentType) {
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Send a file (image or PDF) to the Gemini-backed reader and return its draft.
async function readWithGemini(base64, mimeType) {
  const { data, error } = await supabase.functions.invoke('import-photo', {
    body: { imageBase64: base64, mimeType },
  });
  if (error) {
    // supabase-js gives a generic message on non-2xx; dig out our real detail.
    let detail = error.message || 'request failed';
    try {
      const body = await error.context.json();
      if (body?.error) detail = body.error;
    } catch (_) { /* body wasn't JSON */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
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
      const [{ data: editor }, { data: admin }] = await Promise.all([
        supabase.rpc('is_editor'), supabase.rpc('is_admin'),
      ]);
      if (!editor) { window.location.href = '/'; return; }

      if (!this.id) return;
      const { data, error } = await supabase.from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error || !data) { this.error = "Couldn't load this recipe for editing."; return; }

      // Non-admins may only edit recipes they created (RLS also enforces this).
      const me = (session.user.email || '').toLowerCase();
      if (!admin && (data.created_by || '').toLowerCase() !== me) {
        Alpine.store('ui').showToast('You can only edit recipes you added.');
        window.location.href = `/recipe.html?id=${this.id}`;
        return;
      }
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
        const base64 = await blobToBase64(file);
        this._applyDraft(await readWithGemini(base64, file.type || 'application/pdf'));
        Alpine.store('ui').showToast('Read from PDF — review and save.');
      } catch (e) {
        this.error = 'PDF import failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.pdf) this.$refs.pdf.value = '';
    },

    // Snap/upload a recipe-card photo: shrink it, store it, AND read it with Gemini.
    async importPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const { blob, base64, mimeType } = await prepImage(file);
        this.form.image_url = await uploadBlob(blob, 'jpg', mimeType);
        this._applyDraft(await readWithGemini(base64, mimeType));
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
        const { blob, mimeType } = await prepImage(file);
        this.form.image_url = await uploadBlob(blob, 'jpg', mimeType);
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

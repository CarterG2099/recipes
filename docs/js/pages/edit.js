/**
 * edit.js — create/edit a recipe (metric-conversion branch).
 * Ingredients are structured rows {qty, unit, item}. On save we store both
 * `ingredients_struct` (for exact scaling/conversion) and a derived `ingredients`
 * text array (for search + the live/main text path). Imports prefill structured
 * rows (from the function's ingredients_struct, or by parsing its text).
 */

import { supabase } from '../supabase.js';
import { UNIT_OPTIONS, parseIngredient, parseQty, fmtFrac, structToText } from '../units.js';

const BUCKET = 'recipe-images';
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

function emptyForm() {
  return {
    title: '', description: '',
    prep_time_minutes: null, cook_time_minutes: null,
    servings: '', tagsText: '',
    ingredients: [{ qty: '', unit: '', item: '' }],
    instructions: [''],
    source_url: '', image_url: null,
  };
}

// Build editable rows from a structured array or legacy text lines.
function rowsFromStruct(struct) {
  return (struct || []).map((i) => {
    const qty = i.qty ?? i.amount ?? null;
    return { qty: qty == null ? '' : fmtFrac(qty), unit: i.unit || '', item: (i.item || '').trim() };
  });
}
function rowsFromText(lines) {
  return (lines || []).map((l) => {
    const p = parseIngredient(l);
    return { qty: p.qty == null ? '' : fmtFrac(p.qty), unit: p.unit || '', item: p.item };
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}
async function prepImage(file) {
  if (!file.type.startsWith('image/')) return { blob: file, base64: await blobToBase64(file), mimeType: file.type };
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) { bitmap = await createImageBitmap(file); }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  return { blob, base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
}
async function uploadBlob(blob, ext, contentType) {
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
async function readWithGemini(base64, mimeType) {
  const { data, error } = await supabase.functions.invoke('import-photo', { body: { imageBase64: base64, mimeType } });
  if (error) {
    let detail = error.message || 'request failed';
    try { const b = await error.context.json(); if (b?.error) detail = b.error; } catch (_) {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

window.editPage = function editPage() {
  return {
    form: emptyForm(),
    unitOptions: UNIT_OPTIONS,
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

      const me = (session.user.email || '').toLowerCase();
      if (!admin && (data.created_by || '').toLowerCase() !== me) {
        Alpine.store('ui').showToast('You can only edit recipes you added.');
        window.location.href = `/recipe.html?id=${this.id}`;
        return;
      }

      const rows = Array.isArray(data.ingredients_struct) && data.ingredients_struct.length
        ? rowsFromStruct(data.ingredients_struct)
        : rowsFromText(data.ingredients);
      this.form = {
        title: data.title || '',
        description: data.description || '',
        prep_time_minutes: data.prep_time_minutes ?? null,
        cook_time_minutes: data.cook_time_minutes ?? null,
        servings: data.servings || '',
        tagsText: (data.tags || []).join(', '),
        ingredients: rows.length ? rows : [{ qty: '', unit: '', item: '' }],
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
      const rows = Array.isArray(draft.ingredients_struct) && draft.ingredients_struct.length
        ? rowsFromStruct(draft.ingredients_struct)
        : rowsFromText(draft.ingredients);
      if (rows.length) this.form.ingredients = rows;
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
      } catch (e) { this.error = 'Import failed: ' + (e.message || ''); }
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
      } catch (e) { this.error = 'PDF import failed: ' + (e.message || ''); }
      this.importing = false;
      if (this.$refs.pdf) this.$refs.pdf.value = '';
    },

    async importPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const { blob, base64, mimeType } = await prepImage(file);
        this.form.image_url = await uploadBlob(blob, 'jpg', mimeType);
        this._applyDraft(await readWithGemini(base64, mimeType));
        Alpine.store('ui').showToast('Read from photo — review and save.');
      } catch (e) { this.error = 'Photo import failed: ' + (e.message || ''); }
      this.importing = false;
      if (this.$refs.photo) this.$refs.photo.value = '';
    },

    async attachPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importing = true; this.error = null;
      try {
        const { blob, mimeType } = await prepImage(file);
        this.form.image_url = await uploadBlob(blob, 'jpg', mimeType);
        Alpine.store('ui').showToast('Photo added.');
      } catch (e) { this.error = 'Upload failed: ' + (e.message || ''); }
      this.importing = false;
      if (this.$refs.attach) this.$refs.attach.value = '';
    },

    _payload() {
      const struct = this.form.ingredients
        .map((r) => ({ qty: parseQty(r.qty), unit: r.unit || null, item: (r.item || '').trim() }))
        .filter((r) => r.item || r.qty != null);
      return {
        title: this.form.title.trim(),
        description: this.form.description.trim() || null,
        prep_time_minutes: this.form.prep_time_minutes || null,
        cook_time_minutes: this.form.cook_time_minutes || null,
        servings: this.form.servings.trim() || null,
        source_url: this.form.source_url.trim() || null,
        image_url: this.form.image_url || null,
        tags: this.form.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        ingredients_struct: struct,
        ingredients: struct.map(structToText), // derived text for search + live path
        instructions: this.form.instructions.map((s) => s.trim()).filter(Boolean),
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

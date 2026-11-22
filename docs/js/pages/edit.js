/**
 * edit.js — create/edit a recipe.
 *   • URL import   → import-url Edge Function (JSON-LD)
 *   • PDF import   → import-photo Edge Function (Gemini reads the PDF directly)
 *   • Photo import → downscales in-browser, uploads to Storage, AND reads via import-photo (Gemini)
 * Writes go through supabase-js and are enforced by the editor RLS policies.
 * The page redirects non-editors away (UX only; RLS is the real boundary).
 */

import { supabase } from '../supabase.js';
import { MACROS, servingsCountFrom, hasNutrition, nutritionChanged } from '../nutrition.js';
import { canEditRecipe } from '../access.js';

const BUCKET = 'recipe-images';
const MAX_EDGE = 1600;   // px — plenty for reading a card; keeps uploads small on mobile
const JPEG_QUALITY = 0.85;

function emptyForm() {
  return {
    title: '', description: '',
    prep_time_minutes: null, cook_time_minutes: null,
    servings: '', tagsText: '',
    ingredients: [''], instructions: [''],
    source_url: '', image_urls: [], notes: '',
    // Per serving. Null means unknown, and stays unknown until a person or the
    // estimator says otherwise — never zero by default.
    servings_count: null,
    calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sodium_mg: null,
    nutrition_source: null,
  };
}

/** Just the nutrition fields, for change detection at save time. */
function nutritionOf(form) {
  const out = { servings_count: form.servings_count };
  for (const m of MACROS) out[m] = form[m];
  return out;
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

// Send files (images or a PDF) to the Gemini-backed reader and return its
// single combined draft. images: [{ imageBase64, mimeType }]
async function readWithGemini(images) {
  const { data, error } = await supabase.functions.invoke('import-photo', {
    body: { images },
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

    // Nutrition. `breakdown` is the estimator's per-ingredient table, shown so a
    // wrong total can be traced to the line that caused it. `_nutritionBefore`
    // is what was loaded, and `_estimated` what the estimator wrote — together
    // they decide, at save, whether the numbers are gemini's, a person's, or
    // unchanged.
    estimating: false,
    breakdown: null,
    _nutritionBefore: null,
    _estimated: null,

    get id() {
      return new URLSearchParams(window.location.search).get('id');
    },

    async init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/'; return; }
      const [{ data: editor }, { data: admin }, { data: household }] = await Promise.all([
        supabase.rpc('is_editor'), supabase.rpc('is_admin'), supabase.rpc('my_household'),
      ]);
      if (!editor) { window.location.href = '/'; return; }

      this.$nextTick(() => {
        this._makeSortable(this.$refs.ingredientList, 'ingredients');
        this._makeSortable(this.$refs.instructionList, 'instructions');
      });

      if (!this.id) return;
      const { data, error } = await supabase.from('recipes').select('*').eq('id', this.id).maybeSingle();
      if (error || !data) { this.error = "Couldn't load this recipe for editing."; return; }

      // Non-admins may only edit recipes they or their household created (RLS
      // also enforces this).
      if (!canEditRecipe(data.created_by, { email: session.user.email, isAdmin: admin, household: household || [] })) {
        Alpine.store('ui').showToast('You can only edit recipes you or your household added.');
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
        image_urls: [...(data.image_urls || [])],
        notes: data.notes || '',
        servings_count: data.servings_count ?? null,
        calories: data.calories ?? null,
        protein_g: data.protein_g ?? null,
        carbs_g: data.carbs_g ?? null,
        fat_g: data.fat_g ?? null,
        fiber_g: data.fiber_g ?? null,
        sodium_mg: data.sodium_mg ?? null,
        nutrition_source: data.nutrition_source ?? null,
      };
      this._nutritionBefore = nutritionOf(this.form);
    },

    /** "estimated" / "entered by hand" / nothing, for the label beside the fields. */
    get nutritionSourceLabel() {
      if (!hasNutrition(this.form)) return '';
      return this.form.nutrition_source === 'gemini' ? 'Estimated by AI — check before trusting'
        : this.form.nutrition_source === 'manual' ? 'Entered by hand' : '';
    },

    /**
     * Ask Gemini for per-ingredient nutrition and fill the per-serving fields.
     *
     * The numbers land in the form, not the database — saving is still a
     * separate, deliberate step, the same as every import on this page. If the
     * row already carries hand-entered figures, confirm before overwriting them:
     * a person's correction should not be clobbered by re-running the guess.
     */
    async estimateNutrition() {
      const ingredients = this.form.ingredients.map((s) => s.trim()).filter(Boolean);
      if (!ingredients.length) { this.error = 'Add the ingredients first — the estimate is built from them.'; return; }

      if (this.form.nutrition_source === 'manual' && hasNutrition(this.form)) {
        const ok = window.confirm('These numbers were entered by hand. Replace them with an estimate?');
        if (!ok) return;
      }

      // The servings text is free-form ("4-6"); the estimator needs a number.
      // Fill the count from it if the field is empty, and show what was used.
      if (this.form.servings_count == null || this.form.servings_count === '') {
        this.form.servings_count = servingsCountFrom(this.form.servings);
      }

      this.estimating = true; this.error = null; this.breakdown = null;
      try {
        const { data, error } = await supabase.functions.invoke('estimate-nutrition', {
          body: {
            title: this.form.title.trim(),
            ingredients,
            servings_count: this.form.servings_count || null,
          },
        });
        if (error) {
          let detail = error.message || 'request failed';
          try { const body = await error.context.json(); if (body?.error) detail = body.error; } catch (_) { /* not JSON */ }
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);

        this.breakdown = data;
        if (data.servings_count && (this.form.servings_count == null || this.form.servings_count === '')) {
          this.form.servings_count = data.servings_count;
        }
        if (data.per_serving) {
          for (const m of MACROS) this.form[m] = data.per_serving[m];
          this.form.nutrition_source = 'gemini';
          this._estimated = nutritionOf(this.form);
          Alpine.store('ui').showToast('Estimated — check the numbers, then save.');
        } else {
          this.importWarning = data.warning || 'Enter how many servings this makes, then estimate again.';
        }
        if (data.warning && data.per_serving) this.importWarning = data.warning;
      } catch (e) {
        this.error = 'Nutrition estimate failed: ' + (e.message || '');
      }
      this.estimating = false;
    },

    clearNutrition() {
      for (const m of MACROS) this.form[m] = null;
      this.form.servings_count = null;
      this.form.nutrition_source = null;
      this.breakdown = null;
      this._estimated = null;
    },

    // Drag-to-reorder for an ingredient/instruction list. Sortable moves the DOM
    // node itself, which would desync Alpine's index-keyed x-for — so we put the
    // row back where it was and reorder the array instead, letting Alpine re-render.
    _makeSortable(el, key) {
      // Alpine runs init() twice (auto-call + x-init); a second Sortable on the
      // same list hijacks Sortable's element→instance map and breaks touch drags.
      if (el._sortable) return;
      el._sortable = true;
      new Sortable(el, {
        handle: '.drag-handle',
        draggable: '.line-row',
        animation: 150,
        // Sortable's default HTML5-native drag mode never engages from touch;
        // its fallback (own ghost + pointer tracking) works everywhere.
        forceFallback: true,
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        fallbackTolerance: 3,
        scroll: true,
        forceAutoScrollFallback: true,
        scrollSensitivity: 50,
        // Sortable clones the dragged row (drag ghost + internal clone); the
        // clones inherit x-ignore so Alpine doesn't initialize their orphaned
        // x-for bindings ("i is not defined").
        onChoose: (evt) => evt.item.setAttribute('x-ignore', ''),
        onUnchoose: (evt) => evt.item.removeAttribute('x-ignore'),
        onEnd: (evt) => {
          const { item, from, oldIndex, newIndex } = evt;
          item.removeAttribute('x-ignore');
          if (oldIndex === newIndex) return;
          from.removeChild(item);
          const rows = from.querySelectorAll(':scope > .line-row');
          from.insertBefore(item, rows[oldIndex] || null);
          const arr = this.form[key];
          arr.splice(newIndex, 0, arr.splice(oldIndex, 1)[0]);
        },
      });
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
        this._applyDraft(await readWithGemini([{ imageBase64: base64, mimeType: file.type || 'application/pdf' }]));
        Alpine.store('ui').showToast('Read from PDF — review and save.');
      } catch (e) {
        this.error = 'PDF import failed: ' + (e.message || '');
      }
      this.importing = false;
      if (this.$refs.pdf) this.$refs.pdf.value = '';
    },

    // Snap/upload recipe-card photos (front and back together is fine): shrink
    // and store each, then read them all as ONE recipe with Gemini.
    async importPhoto(event) {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        const images = [];
        for (const file of files) {
          const { blob, base64, mimeType } = await prepImage(file);
          this.form.image_urls.push(await uploadBlob(blob, 'jpg', mimeType));
          images.push({ imageBase64: base64, mimeType });
        }
        this._applyDraft(await readWithGemini(images));
        Alpine.store('ui').showToast(`Read from ${files.length > 1 ? 'photos' : 'photo'} — review and save.`);
      } catch (e) {
        this.error = 'Photo import failed: ' + (e.message || '');
      }
      this.importing = false;
      event.target.value = '';
    },

    // Attach stored photos (one or many) without re-reading the recipe.
    async attachPhoto(event) {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      this.importing = true; this.error = null;
      try {
        for (const file of files) {
          const { blob, mimeType } = await prepImage(file);
          this.form.image_urls.push(await uploadBlob(blob, 'jpg', mimeType));
        }
        Alpine.store('ui').showToast(files.length > 1 ? `${files.length} photos added.` : 'Photo added.');
      } catch (e) {
        this.error = 'Upload failed: ' + (e.message || '');
      }
      this.importing = false;
      event.target.value = '';
    },

    _payload() {
      return {
        title: this.form.title.trim(),
        description: this.form.description.trim() || null,
        prep_time_minutes: this.form.prep_time_minutes || null,
        cook_time_minutes: this.form.cook_time_minutes || null,
        servings: this.form.servings.trim() || null,
        source_url: this.form.source_url.trim() || null,
        image_urls: this.form.image_urls,
        notes: this.form.notes.trim() || null,
        tags: this.form.tagsText.split(',').map(t => t.trim()).filter(Boolean),
        ingredients: this.form.ingredients.map(s => s.trim()).filter(Boolean),
        instructions: this.form.instructions.map(s => s.trim()).filter(Boolean),
        ...this._nutritionPayload(),
      };
    },

    /**
     * The nine nutrition columns, with the source worked out from what happened.
     *
     * Untouched since the estimator filled it: gemini. Any field differs from
     * what the estimator wrote, or from what was loaded when there was no
     * estimate: manual — a person's number, which a later re-estimate must ask
     * before replacing. Nothing changed at all: keep whatever was stored, and do
     * not touch nutrition_updated_at.
     */
    _nutritionPayload() {
      const num = (v) => (v === '' || v == null ? null : Number(v));
      const now = nutritionOf(this.form);
      const out = { servings_count: num(this.form.servings_count) };
      for (const m of MACROS) out[m] = num(this.form[m]);

      if (!hasNutrition(out)) {
        out.nutrition_source = null;
        if (this._nutritionBefore && hasNutrition(this._nutritionBefore)) out.nutrition_updated_at = new Date().toISOString();
        return out;
      }

      const changedSinceLoad = nutritionChanged(this._nutritionBefore, now);
      const stillTheEstimate = this._estimated && !nutritionChanged(this._estimated, now);

      if (stillTheEstimate) out.nutrition_source = 'gemini';
      else if (changedSinceLoad) out.nutrition_source = 'manual';
      else out.nutrition_source = this.form.nutrition_source ?? 'manual';

      if (changedSinceLoad) out.nutrition_updated_at = new Date().toISOString();
      return out;
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

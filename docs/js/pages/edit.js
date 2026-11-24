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
import { shouldImportOnSave, findRecipeUrl, isEmptyDraft, linkErrorMessage } from '../importing.js';

const BUCKET = 'recipe-images';
const MAX_EDGE = 1600;   // px — plenty for reading a card; keeps uploads small on mobile
const JPEG_QUALITY = 0.85;

// The "Where's this recipe from?" choices, in the order they're shown.
const SOURCES = [
  { key: 'link', emoji: '🔗', title: 'A link', hint: 'A recipe website', ask: 'Paste the recipe link' },
  { key: 'screenshot', emoji: '📱', title: 'A screenshot', hint: 'TikTok, Instagram, Facebook', ask: 'Add your screenshots' },
  { key: 'photo', emoji: '📷', title: 'A photo', hint: 'A card or a printout', ask: 'Add photos of the recipe' },
  { key: 'pdf', emoji: '📄', title: 'A PDF', hint: 'Even a scanned one', ask: 'Add the PDF' },
  { key: 'manual', emoji: '✍️', title: 'Type it in', hint: 'Start from blank', ask: '' },
];

// Shown one after another while a recipe is being read, so a 10-second wait
// doesn't look stuck.
const READING_LINES = [
  'Reading your recipe…',
  'Finding the ingredients…',
  'Lining up the steps…',
  'Almost there…',
];

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

// Call an Edge Function and return its JSON, throwing its own error message.
// supabase-js gives a generic message on non-2xx; dig out our real detail.
async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = error.message || 'request failed';
    try {
      const json = await error.context.json();
      if (json?.error) detail = json.error;
    } catch (_) { /* body wasn't JSON */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Send files (images or a PDF) to the Gemini-backed reader and return its
// single combined draft. images: [{ imageBase64, mimeType }]
function readWithGemini(images) {
  return invokeFunction('import-photo', { images });
}

/** A read failure whose message is already written for the person reading it. */
class StepError extends Error {}

window.editPage = function editPage() {
  return {
    form: emptyForm(),
    importUrlValue: '',
    importing: false,
    importWarning: '',
    saving: false,
    error: null,
    _autoImportedUrl: null,

    // New recipes walk through steps before the form: 'source' (where's it
    // from?), 'input' (the link or files), 'reading', then 'review' (the form).
    // Editing goes straight to the form.
    sources: SOURCES,
    step: 'source',
    source: null,
    files: [],          // [{ file, preview }] picked for a screenshot/photo/PDF read
    stepError: '',      // why the last read didn't work, shown on the input step
    found: false,       // the form was filled by a read, so say "here's what we found"
    readingLine: READING_LINES[0],
    _readingTimer: null,

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
      this.importUrlValue = this.form.source_url;
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

    get showForm() {
      return Boolean(this.id) || this.step === 'review';
    },

    get chosen() {
      return SOURCES.find((s) => s.key === this.source) || null;
    },

    /** 1-based position in the three dots: choose, add, review. */
    get stepNumber() {
      return { source: 1, input: 2, reading: 2, review: 3 }[this.step];
    },

    get acceptsImages() {
      return this.source === 'screenshot' || this.source === 'photo';
    },

    get canPaste() {
      return Boolean(navigator.clipboard?.readText);
    },

    pickSource(key) {
      this.source = key;
      this.stepError = '';
      this.error = null;
      if (key === 'manual') { this.found = false; this.step = 'review'; return; }
      this.step = 'input';
      if (key === 'link') this.$nextTick(() => this.$refs.linkInput?.focus());
    },

    back() {
      this.stepError = '';
      if (this.step === 'input') { this._clearFiles(); this.step = 'source'; return; }
      if (this.step === 'review') this.startOver();
    },

    startOver() {
      this._clearFiles();
      this.form = emptyForm();
      this.importUrlValue = '';
      this.importWarning = '';
      this.error = null;
      this.stepError = '';
      this.found = false;
      this._autoImportedUrl = null;
      this.source = null;
      this.step = 'source';
    },

    /** Fill the link box from the clipboard, where the browser allows it. */
    async pasteLink() {
      try {
        this.importUrlValue = await navigator.clipboard.readText();
        this.stepError = '';
      } catch (_) {
        this.stepError = 'Your browser blocked pasting from here — press and hold in the box, then tap Paste.';
      }
    },

    /** Next on the link step: read the page, or say what's wrong and stay. */
    async nextLink() {
      const url = findRecipeUrl(this.importUrlValue);
      if (!url) {
        this.stepError = this.importUrlValue.trim()
          ? "That doesn't look like a web link. It should start with https://"
          : 'Paste the link to the recipe first.';
        return;
      }
      this.importUrlValue = url;
      this.stepError = '';
      await this._read(async () => {
        const draft = await invokeFunction('import-url', { url });
        if (isEmptyDraft(draft)) {
          throw new StepError("We opened that page but couldn't find a recipe on it. Try a screenshot of it instead, or type it in.");
        }
        return { ...draft, source_url: url };
      }, (e) => linkErrorMessage(e.message));
    },

    addFiles(list) {
      const picked = [...(list || [])];
      const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const ok = picked.filter((f) => (this.source === 'pdf' ? isPdf(f) : f.type.startsWith('image/')));
      this.stepError = ok.length < picked.length
        ? (this.source === 'pdf' ? 'Please pick a PDF file.' : 'Please pick photos or screenshots.')
        : '';
      // One PDF at a time; pictures add up, so the back of a card can follow the front.
      if (this.source === 'pdf' && ok.length) this._clearFiles();
      for (const file of this.source === 'pdf' ? ok.slice(0, 1) : ok) {
        this.files.push({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
      }
    },

    removeFile(i) {
      const [gone] = this.files.splice(i, 1);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
    },

    _clearFiles() {
      for (const f of this.files) if (f.preview) URL.revokeObjectURL(f.preview);
      this.files = [];
    },

    /** Next on the files step: keep the pictures with the recipe, then read them all as one. */
    async nextFiles() {
      if (!this.files.length) {
        this.stepError = this.source === 'pdf' ? 'Add the PDF first.' : 'Add at least one picture first.';
        return;
      }
      this.stepError = '';
      const files = this.files.map((f) => f.file);
      await this._read(async () => {
        const images = [];
        const uploaded = [];
        for (const file of files) {
          if (this.source === 'pdf') {
            images.push({ imageBase64: await blobToBase64(file), mimeType: file.type || 'application/pdf' });
          } else {
            const { blob, base64, mimeType } = await prepImage(file);
            uploaded.push(await uploadBlob(blob, 'jpg', mimeType));
            images.push({ imageBase64: base64, mimeType });
          }
        }
        const draft = await readWithGemini(images);
        if (isEmptyDraft(draft)) {
          throw new StepError("We couldn't make out a recipe in that. Try a sharper, well-lit picture, or type it in.");
        }
        this.form.image_urls.push(...uploaded);
        return draft;
      }, (e) => (/busy/i.test(e.message)
        ? 'The reader is busy right now — please try again in a moment.'
        : "We couldn't read that just now. Please try again, or type it in instead."));
    },

    /**
     * Show the reading screen while `work` runs, then the filled form. On
     * failure go back to the input step with a message: a StepError's own
     * words, or `explain(error)` for anything unexpected.
     */
    async _read(work, explain) {
      this.step = 'reading';
      let n = 0;
      this.readingLine = READING_LINES[0];
      this._readingTimer = setInterval(() => {
        n = Math.min(n + 1, READING_LINES.length - 1);
        this.readingLine = READING_LINES[n];
      }, 2500);
      try {
        this._applyDraft(await work());
        this._clearFiles();
        this.found = true;
        this.step = 'review';
        window.scrollTo({ top: 0 });
      } catch (e) {
        this.stepError = e instanceof StepError ? e.message : explain(e);
        this.step = 'input';
      } finally {
        clearInterval(this._readingTimer);
      }
    },

    /** Leave the reader and type it in, keeping the link if there was one. */
    typeInstead() {
      const url = this.source === 'link' ? findRecipeUrl(this.importUrlValue) : null;
      this._clearFiles();
      if (url) this.form.source_url = url;
      this.stepError = '';
      this.found = false;
      this.source = 'manual';
      this.step = 'review';
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
      await this._importFromUrl(url);
    },

    // Refill the open form from a link (editing, or saving with only a link).
    async _importFromUrl(url) {
      this.importing = true; this.importWarning = ''; this.error = null;
      try {
        this._applyDraft(await invokeFunction('import-url', { url }));
        Alpine.store('ui').showToast('Filled in from the link — check it over, then save.');
      } catch (e) {
        this.error = linkErrorMessage(e.message);
      }
      this.importing = false;
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
      // Fill from the link and stop, so the person reviews before it's saved.
      // A title they typed wins over the page's.
      if (shouldImportOnSave(payload, this._autoImportedUrl)) {
        this._autoImportedUrl = payload.source_url;
        await this._importFromUrl(payload.source_url);
        if (payload.title) this.form.title = payload.title;
        return;
      }
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

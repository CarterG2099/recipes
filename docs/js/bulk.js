/**
 * bulk.js — the parts of bulk add that don't need the browser: finding links in
 * pasted text, grouping photos into recipes, and the row each draft is saved as.
 *
 * A bulk item is one recipe to read:
 *   { id, kind: 'link' | 'photos' | 'pdf', url?, files?: [{ file, preview }],
 *     status: 'ready' | 'reading' | 'saved' | 'failed', error?, recipeId?, title? }
 */

import { findRecipeUrl } from './importing.js';

/** Every recipe link in a pasted block of text, in order, without repeats. */
export function linksFromText(text) {
  const out = [];
  for (const token of String(text ?? '').split(/\s+/)) {
    const url = findRecipeUrl(token);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

const groupable = (item) => item.kind === 'photos' && (item.status === 'ready' || item.status === 'failed');

/**
 * Merge the chosen photo items into one recipe: the first chosen (in list
 * order) keeps its place and takes the others' photos, in list order.
 * Fewer than two groupable items chosen leaves the list as it was.
 */
export function groupItems(items, ids) {
  const chosen = items.filter((it) => ids.includes(it.id) && groupable(it));
  if (chosen.length < 2) return items;
  const [keep, ...rest] = chosen;
  const merged = { ...keep, files: chosen.flatMap((it) => it.files), status: 'ready', error: '' };
  return items
    .filter((it) => !rest.includes(it))
    .map((it) => (it === keep ? merged : it));
}

/** Take one photo out of a group into its own recipe, just after the group. */
export function splitPhoto(items, itemId, fileIndex, newId) {
  const i = items.findIndex((it) => it.id === itemId);
  const item = items[i];
  if (!item || !groupable(item) || item.files.length < 2) return items;
  const files = [...item.files];
  const [moved] = files.splice(fileIndex, 1);
  const out = [...items];
  out.splice(i, 1, { ...item, files }, { id: newId, kind: 'photos', files: [moved], status: 'ready', error: '' });
  return out;
}

/** Items still to read: never tried, or failed and worth another go. */
export function pendingItems(items) {
  return items.filter((it) => it.status === 'ready' || it.status === 'failed');
}

/**
 * The recipes row for a draft read in bulk. It is saved straight away, so it
 * is marked needs_review until someone checks it.
 */
export function rowFromDraft(draft, { sourceUrl = null, imageUrls = [], createdBy = null } = {}) {
  const clean = (list) => (list || []).map((s) => String(s).trim()).filter(Boolean);
  return {
    title: String(draft.title || '').trim() || 'Untitled recipe',
    description: draft.description || null,
    prep_time_minutes: draft.prep_time_minutes ?? null,
    cook_time_minutes: draft.cook_time_minutes ?? null,
    servings: draft.servings || null,
    tags: clean(draft.tags),
    ingredients: clean(draft.ingredients),
    instructions: clean(draft.instructions),
    source_url: sourceUrl || draft.source_url || null,
    image_urls: imageUrls,
    created_by: createdBy,
    needs_review: true,
  };
}

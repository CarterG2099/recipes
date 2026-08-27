/**
 * nutrition.js — the arithmetic behind the nutrition panel. Pure, so it is
 * tested; the network and the DOM stay in edit.js.
 */

import { parseQty } from './cooking.js';

export const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg'];

/**
 * A servings count from the free-text `servings` column.
 *
 * "4" and "18" are the common case. A range like "4-6" takes the LOWER bound on
 * purpose: fewer servings means larger per-serving numbers, and overstating
 * what you ate is the safer error for a calorie log. Anything without a
 * leading number ("a loaf") is null and left for the human.
 */
export function servingsCountFrom(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;

  const direct = parseQty(s);
  if (direct != null && direct > 0) return direct;

  const lead = s.match(/^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)/);
  if (!lead) return null;
  const n = parseQty(lead[1].replace(',', '.'));
  return n != null && n > 0 ? n : null;
}

/** Per-serving figures from totals. Null stays null; a zero count gives nothing. */
export function perServing(totals, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  const out = {};
  for (const m of MACROS) {
    const v = totals?.[m];
    out[m] = v == null || v === '' ? null : Math.round((Number(v) / n) * 10) / 10;
  }
  return out;
}

/** True when the row has a number in any macro column. */
export function hasNutrition(row) {
  return MACROS.some((m) => row?.[m] != null && row[m] !== '');
}

/**
 * Did any nutrition field change between two forms?
 *
 * Compared as numbers, so "12" and 12 are the same value and an untouched form
 * round-trips as unchanged — which is what decides whether saving flips the
 * source to `manual` and stamps nutrition_updated_at.
 */
export function nutritionChanged(before, after) {
  const norm = (v) => (v == null || v === '' ? null : Number(v));
  return [...MACROS, 'servings_count'].some((k) => norm(before?.[k]) !== norm(after?.[k]));
}

/** "420 kcal · 32 g protein · 40 g carbs · 12 g fat", skipping what is unknown. */
export function nutritionLine(row) {
  if (!row) return '';
  const parts = [];
  if (row.calories != null) parts.push(`${Math.round(row.calories)} kcal`);
  if (row.protein_g != null) parts.push(`${Math.round(row.protein_g)} g protein`);
  if (row.carbs_g != null) parts.push(`${Math.round(row.carbs_g)} g carbs`);
  if (row.fat_g != null) parts.push(`${Math.round(row.fat_g)} g fat`);
  return parts.join(' · ');
}

/**
 * importing.js — decisions about imports that don't need the browser.
 */

/**
 * Should saving this recipe fetch its Source URL first instead of saving?
 *
 * People paste a link into Source URL expecting it to fill the recipe in, then
 * save a title and nothing else. So: when there's a link but no ingredients and
 * no instructions, import it once for review. `alreadyTriedUrl` is the link we
 * last auto-imported; saving again with the same link saves as-is, so a page
 * with no readable recipe can't trap the form in a loop.
 */
export function shouldImportOnSave(payload, alreadyTriedUrl) {
  const url = payload.source_url;
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (url === alreadyTriedUrl) return false;
  return !payload.ingredients.length && !payload.instructions.length;
}

/**
 * Pull a recipe link out of whatever was pasted, or null if there isn't one.
 *
 * Phones paste more than the link: a share sheet's Copy often gives
 * "Meringue Cookies — Sugar Spun Run https://…", and people type addresses
 * without "https://". Take the first http(s) link in the text; failing that,
 * treat a lone "example.com/…" as https.
 */
export function findRecipeUrl(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const linked = s.match(/https?:\/\/[^\s<>"']+/i);
  let candidate = linked ? linked[0].replace(/[).,!?]+$/, '') : null;
  if (!candidate) {
    if (/\s/.test(s) || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$)/i.test(s)) return null;
    candidate = `https://${s}`;
  }
  try {
    const u = new URL(candidate);
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** A draft with neither ingredients nor steps didn't find a recipe. */
export function isEmptyDraft(draft) {
  return !(draft?.ingredients || []).length && !(draft?.instructions || []).length;
}

/**
 * What to tell a person when a link import fails, from the function's error.
 * The import-url function says "Could not fetch that URL" when the site can't
 * be reached or refuses us; anything else is our side.
 */
export function linkErrorMessage(detail) {
  if (/could not fetch/i.test(detail || '')) {
    return "We couldn't open that page. Check the link is complete, or try a screenshot instead.";
  }
  return 'Something went wrong reading that link. Please try again in a moment.';
}

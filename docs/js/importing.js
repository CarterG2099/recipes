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

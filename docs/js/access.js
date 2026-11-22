/**
 * access.js — who may edit a recipe, for deciding what controls to show. Pure,
 * so it is tested; RLS (can_edit() in schema.sql) is the real boundary and this
 * must agree with it.
 */

/**
 * True when the signed-in user may edit/delete a recipe owned by `createdBy`:
 * admins may edit anything, everyone else their own recipes and those of the
 * people in their household. `household` is the list from my_household().
 */
export function canEditRecipe(createdBy, { email, isAdmin = false, household = [] } = {}) {
  if (isAdmin) return true;
  const me = (email || '').toLowerCase();
  const owner = (createdBy || '').toLowerCase();
  if (!me || !owner) return false;
  return owner === me || household.some((e) => (e || '').toLowerCase() === owner);
}

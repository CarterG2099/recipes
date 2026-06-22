/**
 * supabase.js — shared Supabase client + small data/auth helpers.
 *
 * The URL and anon key are public by design (the anon key only grants what RLS
 * allows: read recipes, and write only if you're an allowlisted editor). No
 * secrets live here.
 */

const SUPABASE_URL = 'https://hyxttezhchkihuubyprb.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eHR0ZXpoY2hraWh1dWJ5cHJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzkyMjUsImV4cCI6MjA5NzcxNTIyNX0.BDnHxKdRAxQKs9WfAy1Pt28TSSDMYQ8polDWB7HqcoQ';

// window.supabase is the UMD build loaded via <script> in each page's <head>.
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Sign in with Google, returning to the current page afterwards. */
export async function signIn() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Ask the DB whether the current session is an allowlisted editor. */
export async function checkEditor() {
  const { data, error } = await supabase.rpc('is_editor');
  return !error && data === true;
}

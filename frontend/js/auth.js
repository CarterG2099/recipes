/**
 * auth.js — Supabase Auth + Google OAuth flow
 *
 * On auth.html:  button click → signInWithOAuth → Supabase redirects to /auth/callback
 * On /auth/callback: hash fragment → getSession() → POST /auth/callback → redirect to /
 */

async function initSupabase() {
  const res = await fetch('/api/config', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load config');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  // window.supabase is the UMD build from CDN
  return window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

async function handleAuthPage() {
  const res = await fetch('/api/config', { credentials: 'same-origin' });
  const config = res.ok ? await res.json() : {};

  // Show notices regardless of environment
  const params = new URLSearchParams(window.location.search);
  const msg = document.getElementById('auth-message');
  if (msg) {
    if (params.get('logout') === 'true') { msg.textContent = 'You have been signed out.'; msg.style.display = 'block'; }
    if (params.get('session_expired') === '1') { msg.textContent = 'Your session expired. Please sign in again.'; msg.style.display = 'block'; }
    if (params.get('idle_logout') === '1') { msg.textContent = 'You were logged out due to inactivity.'; msg.style.display = 'block'; }
    var errParam = params.get('error');
    if (errParam) {
      var errMsg = params.get('msg') || errParam;
      var debug = null;
      try { debug = JSON.parse(localStorage.getItem('auth_debug')); } catch (e) {}
      msg.textContent = 'Login error [' + errMsg + ']' + (debug ? ' — step: ' + debug.step : '');
      msg.style.display = 'block';
    }
  }

  const btn = document.getElementById('google-signin-btn');
  if (!btn) return;

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Continue with Google';
      document.getElementById('auth-error').textContent = error.message;
    }
  });
}

async function handleCallback() {
  var debug = { step: 'start', ts: Date.now() };
  try {
    debug.step = 'initSupabase';
    var client = await initSupabase();

    debug.step = 'getSession';
    var result = await client.auth.getSession();
    var data = result.data;
    var error = result.error;
    debug.sessionError = error ? String(error) : null;
    debug.hasSession = !!(data && data.session);

    if (error || !data.session) {
      debug.step = 'no_session_redirect';
      localStorage.setItem('auth_debug', JSON.stringify(debug));
      window.location.href = '/auth?error=no_session';
      return;
    }

    debug.step = 'posting';
    var res = await fetch('/auth/callback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: data.session.user }),
    });
    debug.postStatus = res.status;
    debug.postOk = res.ok;

    if (res.ok) {
      debug.step = 'success_redirect';
      localStorage.setItem('auth_debug', JSON.stringify(debug));
      window.location.href = '/';
    } else {
      debug.step = 'callback_failed_redirect';
      localStorage.setItem('auth_debug', JSON.stringify(debug));
      window.location.href = '/auth?error=callback_failed';
    }
  } catch (e) {
    debug.step = 'exception';
    debug.error = String(e);
    localStorage.setItem('auth_debug', JSON.stringify(debug));
    window.location.href = '/auth?error=exception&msg=' + encodeURIComponent(String(e));
  }
}

// Route based on current page
const path = window.location.pathname;
if (path === '/auth' || path === '/auth.html') {
  handleAuthPage();
} else if (path === '/auth/callback') {
  handleCallback();
}

export { initSupabase };

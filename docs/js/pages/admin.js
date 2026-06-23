/**
 * admin.js — manage the editor allowlist (admins only).
 * Reads/writes public.allowed_emails directly; RLS restricts every operation to
 * admins, so this page's gate is UX and the DB is the real boundary.
 */

import { supabase } from '../supabase.js';

window.adminPage = function adminPage() {
  return {
    people: [],
    newEmail: '',
    newIsAdmin: false,
    myEmail: '',
    loading: true,
    busy: false,
    error: null,

    async init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/'; return; }
      const { data: admin } = await supabase.rpc('is_admin');
      if (!admin) { window.location.href = '/'; return; }
      this.myEmail = (session.user.email || '').toLowerCase();
      await this.load();
    },

    async load() {
      this.loading = true;
      const { data, error } = await supabase
        .from('allowed_emails').select('email, is_admin').order('email');
      if (error) this.error = "Couldn't load the list: " + error.message;
      else this.people = data || [];
      this.loading = false;
    },

    async addEmail() {
      const email = this.newEmail.trim().toLowerCase();
      if (!email) return;
      this.busy = true; this.error = null;
      const { error } = await supabase
        .from('allowed_emails').upsert({ email, is_admin: this.newIsAdmin }, { onConflict: 'email' });
      if (error) this.error = 'Could not add: ' + error.message;
      else {
        this.newEmail = ''; this.newIsAdmin = false;
        Alpine.store('ui').showToast('Added.');
        await this.load();
      }
      this.busy = false;
    },

    async setAdmin(row, makeAdmin) {
      this.busy = true; this.error = null;
      const { error } = await supabase
        .from('allowed_emails').update({ is_admin: makeAdmin }).eq('email', row.email);
      if (error) this.error = 'Could not update: ' + error.message;
      else await this.load();
      this.busy = false;
    },

    async removeEmail(row) {
      if (row.email === this.myEmail) return; // never let an admin remove themselves
      if (!confirm(`Remove ${row.email}? They'll no longer be able to edit.`)) return;
      this.busy = true; this.error = null;
      const { error } = await supabase.from('allowed_emails').delete().eq('email', row.email);
      if (error) this.error = 'Could not remove: ' + error.message;
      else { Alpine.store('ui').showToast('Removed.'); await this.load(); }
      this.busy = false;
    },
  };
};

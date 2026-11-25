/**
 * bulk.js (page) — add several recipes at once from links, photos and PDFs.
 *
 * Photos start as one recipe each; people group the ones that belong together
 * (front and back of a card). Items are read one at a time — the free Gemini
 * tier turns away bursts — and each is saved as soon as it reads cleanly,
 * marked needs_review so it shows up for checking afterwards.
 * Editor-only, like the edit page (redirect is UX; RLS is the real boundary).
 */

import { supabase } from '../supabase.js';
import { isEmptyDraft, linkErrorMessage } from '../importing.js';
import { invokeFunction, readFiles } from '../reading.js';
import { openCamera } from '../camera.js';
import { linksFromText, groupItems, splitPhoto, pendingItems, rowFromDraft } from '../bulk.js';

/** A failure whose message is already written for the person reading it. */
class ReadError extends Error {}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

window.bulkPage = function bulkPage() {
  return {
    items: [],
    linkText: '',
    grouping: false,
    selected: [],
    running: false,
    runDone: 0,         // of runTotal, for "Reading 2 of 5…"
    runTotal: 0,
    notice: '',
    _nextId: 1,
    _email: null,

    async init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/'; return; }
      const { data: editor } = await supabase.rpc('is_editor');
      if (!editor) { window.location.href = '/'; return; }
      this._email = session.user.email;
      window.addEventListener('beforeunload', (e) => {
        if (this.running) { e.preventDefault(); e.returnValue = ''; }
      });
    },

    get pending() { return pendingItems(this.items); },
    get saved() { return this.items.filter((it) => it.status === 'saved'); },
    get failed() { return this.items.filter((it) => it.status === 'failed'); },
    get groupablePhotos() {
      return this.items.filter((it) => it.kind === 'photos' && (it.status === 'ready' || it.status === 'failed'));
    },
    get finished() {
      return !this.running && this.saved.length > 0 && !this.items.some((it) => it.status === 'ready');
    },

    _add(item) {
      this.items.push({ id: this._nextId++, status: 'ready', error: '', ...item });
    },

    /** Turn whatever is in the links box into one item per new link. */
    addLinks() {
      const links = linksFromText(this.linkText);
      const have = new Set(this.items.filter((it) => it.kind === 'link').map((it) => it.url));
      const fresh = links.filter((u) => !have.has(u));
      for (const url of fresh) this._add({ kind: 'link', url });
      if (!links.length && this.linkText.trim()) {
        this.notice = "We couldn't find any web links in that. Each one should start with https://";
        return;
      }
      this.notice = fresh.length < links.length ? 'Links already in the list were skipped.' : '';
      this.linkText = '';
    },

    /** Pasting usually is the whole job, so add as soon as the paste lands. */
    onPaste() {
      this.$nextTick(() => this.addLinks());
    },

    addFiles(list) {
      const files = [...(list || [])];
      const skipped = files.filter((f) => !f.type.startsWith('image/') && !isPdf(f));
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          this._add({ kind: 'photos', files: [{ file, preview: URL.createObjectURL(file) }] });
        } else if (isPdf(file)) {
          this._add({ kind: 'pdf', files: [{ file, preview: null }] });
        }
      }
      this.notice = skipped.length ? `${skipped.length} file(s) skipped — only photos and PDFs can be read.` : '';
    },

    async takePhotos() {
      this.addFiles(await openCamera());
    },

    remove(id) {
      const item = this.items.find((it) => it.id === id);
      for (const f of item?.files || []) if (f.preview) URL.revokeObjectURL(f.preview);
      this.items = this.items.filter((it) => it.id !== id);
      this.selected = this.selected.filter((s) => s !== id);
    },

    // ── grouping ──
    startGrouping() { this.grouping = true; this.selected = []; },
    cancelGrouping() { this.grouping = false; this.selected = []; },
    toggleSelect(id) {
      this.selected = this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id];
    },
    isSelected(id) { return this.selected.includes(id); },
    groupSelected() {
      this.items = groupItems(this.items, this.selected);
      this.cancelGrouping();
    },
    splitOut(itemId, fileIndex) {
      this.items = splitPhoto(this.items, itemId, fileIndex, this._nextId++);
    },

    // ── reading and saving ──
    async start() {
      if (this.running) return;
      this.grouping = false;
      this.notice = '';
      await this._run(this.pending);
    },

    retry(id) {
      const item = this.items.find((it) => it.id === id);
      if (item && !this.running) return this._run([item]);
    },

    async _run(list) {
      this.running = true;
      this.runTotal = list.length;
      this.runDone = 0;
      for (const item of list) {
        await this._process(item);
        this.runDone++;
      }
      this.running = false;
    },

    async _process(item) {
      item.status = 'reading';
      item.error = '';
      try {
        let draft;
        let imageUrls = [];
        if (item.kind === 'link') {
          try {
            draft = await invokeFunction('import-url', { url: item.url });
          } catch (e) {
            throw new ReadError(linkErrorMessage(e.message));
          }
          if (isEmptyDraft(draft)) throw new ReadError("No recipe found on that page. Try a screenshot of it instead.");
        } else {
          try {
            ({ draft, imageUrls } = await readFiles(item.files.map((f) => f.file)));
          } catch (e) {
            throw new ReadError(/busy/i.test(e.message)
              ? 'The reader is busy right now — tap Retry in a moment.'
              : "Couldn't read this one. Tap Retry, or add it on its own.");
          }
          if (isEmptyDraft(draft)) throw new ReadError("Couldn't make out a recipe. Try a sharper, well-lit photo.");
        }
        const row = rowFromDraft(draft, { sourceUrl: item.url, imageUrls, createdBy: this._email });
        const { data, error } = await supabase.from('recipes').insert(row).select('id, title').single();
        if (error) throw new ReadError('Read it, but saving failed: ' + error.message);
        item.status = 'saved';
        item.recipeId = data.id;
        item.title = data.title;
      } catch (e) {
        item.status = 'failed';
        item.error = e instanceof ReadError ? e.message : 'Something went wrong. Tap Retry.';
      }
    },

    label(item) {
      if (item.title) return item.title;
      if (item.kind === 'link') {
        const u = new URL(item.url);
        return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
      }
      if (item.kind === 'pdf') return item.files[0].file.name;
      return item.files.length > 1 ? `${item.files.length} photos, one recipe` : 'Photo';
    },
  };
};

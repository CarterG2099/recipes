/**
 * app.js — entry point. Loaded as <script type="module"> on every page.
 * Registers stores, imports the page-specific module named by <body data-page>,
 * then starts Alpine.
 */

import Alpine from './vendor/alpine.esm.js';
import { registerAllStores } from './store.js';

window.Alpine = Alpine;

registerAllStores();

const page = document.body.dataset.page;
if (page) {
  try {
    await import(`./pages/${page}.js`);
  } catch (e) {
    console.warn(`No page module found for "${page}":`, e);
  }
}

Alpine.start();

// Register the service worker so the site is installable as an app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed:', e));
  });
}

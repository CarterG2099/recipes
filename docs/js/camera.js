/**
 * camera.js — a full-screen camera inside the page, for taking several photos
 * in a row (a stack of recipe cards) without leaving the app after each one.
 *
 * openCamera() resolves with the photos taken as JPEG Files, or [] if closed.
 * Where the browser has no camera API it falls back to the phone's own camera
 * picker; where camera access is blocked it says so and offers that picker.
 */

const JPEG_QUALITY = 0.9;

/** The phone's own camera, one shot per trip. Must run inside a tap. */
function pickWithPhoneCamera() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

export async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return pickWithPhoneCamera();

  const shots = [];   // { file, url }
  const root = el('div', { class: 'cam', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Camera' });
  const video = el('video', { playsinline: '', muted: '', autoplay: '' });
  video.muted = true;
  const flash = el('div', { class: 'cam-flash' });
  const close = el('button', { type: 'button', class: 'cam-close', 'aria-label': 'Close camera' }, '✕');
  const msg = el('div', { class: 'cam-msg', hidden: '' });
  const bar = el('div', { class: 'cam-bar' });
  const strip = el('div', { class: 'cam-shots' });
  const shutter = el('button', { type: 'button', class: 'cam-shutter', 'aria-label': 'Take photo', disabled: '' });
  const done = el('button', { type: 'button', class: 'cam-done' }, 'Done');
  bar.append(strip, shutter, done);
  root.append(video, flash, close, msg, bar);
  document.body.append(root);
  document.body.classList.add('cam-open');

  let stream = null;
  let finish;
  const result = new Promise((resolve) => { finish = resolve; });

  const cleanUp = () => {
    stream?.getTracks().forEach((t) => t.stop());
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('cam-open');
    root.remove();
  };
  const end = (keep) => {
    cleanUp();
    for (const s of shots) URL.revokeObjectURL(s.url);
    finish(keep ? shots.map((s) => s.file) : []);
  };
  const onKey = (e) => { if (e.key === 'Escape') end(false); };
  document.addEventListener('keydown', onKey);

  const renderDone = () => {
    done.textContent = shots.length ? `Done (${shots.length})` : 'Done';
  };
  const renderStrip = () => {
    strip.replaceChildren(...shots.map((s, i) => {
      const b = el('button', { type: 'button', class: 'cam-shot', 'aria-label': `Remove photo ${i + 1}` });
      const img = el('img', { src: s.url, alt: '' });
      b.append(img);
      b.addEventListener('click', () => {
        URL.revokeObjectURL(s.url);
        shots.splice(i, 1);
        renderStrip();
      });
      return b;
    }));
    renderDone();
  };

  close.addEventListener('click', () => end(false));
  done.addEventListener('click', () => end(true));
  shutter.addEventListener('click', async () => {
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    flash.classList.remove('go');
    void flash.offsetWidth;   // restart the flash animation
    flash.classList.add('go');
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    shots.push({ file, url: URL.createObjectURL(blob) });
    renderStrip();
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    shutter.removeAttribute('disabled');
  } catch (_) {
    // Blocked, or no camera: say so, and offer the phone's camera picker from
    // a fresh tap (browsers only open a file picker from a tap).
    msg.hidden = false;
    msg.append(
      el('p', {}, "We can't use the camera here. Allow camera access for this site in your browser settings, or use your phone's camera instead."),
    );
    const fallback = el('button', { type: 'button', class: 'cam-fallback' }, "Use the phone's camera");
    fallback.addEventListener('click', async () => {
      const files = await pickWithPhoneCamera();
      cleanUp();
      finish(files);
    });
    msg.append(fallback);
  }

  return result;
}

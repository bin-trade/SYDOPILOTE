// Scanner QR : caméra + décodage.
// BarcodeDetector (Chrome/Android) quand il existe, sinon jsQR embarqué (iPhone, Firefox…).
// Les deux fonctionnent entièrement hors connexion.
let detector = null, detectorTried = false;

async function getDetector() {
  if (detectorTried) return detector;
  detectorTried = true;
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats?.();
    if (formats && !formats.includes('qr_code')) return null;
    detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch { detector = null; }
  return detector;
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function jsqrFrom(source, sw, sh, maxSide) {
  if (typeof window.jsQR !== 'function') return null;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  canvas.width = w; canvas.height = h;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const r = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
  return r && r.data ? r.data : null;
}

export async function decodeImageFile(file) {
  const bmp = await createImageBitmap(file);
  try {
    const det = await getDetector();
    if (det) {
      try { const codes = await det.detect(bmp); if (codes[0]?.rawValue) return codes[0].rawValue; } catch {}
    }
    return jsqrFrom(bmp, bmp.width, bmp.height, 1600) || jsqrFrom(bmp, bmp.width, bmp.height, 900);
  } finally { bmp.close?.(); }
}

export const cameraSupported = () =>
  window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

export class Scanner {
  constructor(video, onDetect) {
    this.video = video; this.onDetect = onDetect;
    this.stream = null; this.running = false; this.facing = 'environment';
    this.canTorch = false; this.torchOn = false; this.multiCam = false;
    this._last = 0; this._raf = 0; this._wake = null;
  }

  async start() {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.classList.toggle('mirror', this.facing === 'user');
    await this.video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    this.canTorch = !!track?.getCapabilities?.().torch;
    this.torchOn = false;
    try { this.multiCam = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length > 1; }
    catch { this.multiCam = false; }

    try { this._wake = await navigator.wakeLock?.request('screen'); } catch { this._wake = null; }
    await getDetector();
    this.resume();
  }

  resume() {
    if (this.running || !this.stream) return;
    this.running = true;
    this._raf = requestAnimationFrame(() => this._loop());
  }
  pause() { this.running = false; cancelAnimationFrame(this._raf); }

  stop() {
    this.pause();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    try { this._wake?.release(); } catch {}
    this._wake = null; this.torchOn = false;
  }

  async setTorch(on) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; }
    catch { return false; }
  }

  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    await this.start();
  }

  async _decodeFrame() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return null;
    if (detector) {
      try { const codes = await detector.detect(v); return codes[0]?.rawValue || null; } catch { return null; }
    }
    return jsqrFrom(v, v.videoWidth, v.videoHeight, 720);
  }

  async _loop() {
    if (!this.running) return;
    const now = performance.now();
    if (now - this._last >= 110) {
      this._last = now;
      const value = await this._decodeFrame();
      if (value && this.running) { this.pause(); this.onDetect(value); return; }
    }
    if (this.running) this._raf = requestAnimationFrame(() => this._loop());
  }
}

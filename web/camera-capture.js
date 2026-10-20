import { CAMERA_LIMITS } from '../src/sources/camera.js';

export function stopCamera(stream) { for (const track of stream?.getTracks() || []) track.stop(); }

export function requestCamera(mediaDevices, { timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!mediaDevices?.getUserMedia) { reject(new Error('Camera is unavailable. Use HTTPS or localhost.')); return; }
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('Camera permission request timed out.')); }, timeout);
    Promise.resolve().then(() => mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } }))
      .then(stream => {
        if (settled) { stopCamera(stream); return; }
        settled = true; clearTimeout(timer); resolve(stream);
      }, error => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        reject(new Error(error.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Camera unavailable: ${error.message}`));
      });
  });
}

export function captureFrame(video, canvas, clock = Date.now) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Camera has no frame ready');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Frame capture is unavailable');
  let edge = CAMERA_LIMITS.edge;
  while (edge >= 80) {
    const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const capturedAt = clock();
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (!url.startsWith('data:image/jpeg;base64,')) throw new Error('Browser cannot encode JPEG frames');
      const jpeg = url.slice('data:image/jpeg;base64,'.length);
      if (jpeg.length <= CAMERA_LIMITS.jpegBytes / 3 * 4)
        return { jpeg, width: canvas.width, height: canvas.height, capturedAt };
    }
    edge = Math.floor(edge * 0.75);
  }
  throw new Error('Frame exceeds the 48 KiB image budget');
}

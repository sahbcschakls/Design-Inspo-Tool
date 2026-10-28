// Image helpers. sharp is an optional dependency: with it we get thumbnails,
// dimensions, a local colour palette and Claude-friendly resizing. Without it the
// library still works, it just serves originals and skips local colour extraction.
import fs from 'node:fs';
import path from 'node:path';

let sharp = null;
try {
  sharp = (await import('sharp')).default;
  sharp.cache(false);
} catch {
  console.warn('[inspo] sharp not available — thumbnails and colour extraction disabled.');
}

export const hasSharp = () => Boolean(sharp);

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg', '.tif', '.tiff', '.heic', '.bmp']);
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic',
};

export const isImage = (file) => IMAGE_EXTS.has(path.extname(file).toLowerCase());
export const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

export async function probe(file) {
  if (!sharp) return {};
  try {
    const meta = await sharp(file, { animated: false }).metadata();
    const rotated = meta.orientation >= 5;
    return {
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      format: meta.format,
    };
  } catch {
    return {};
  }
}

export async function makeThumb(file, out) {
  if (!sharp) return false;
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(file, { animated: false })
      .rotate()
      .resize({ width: 720, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(out);
    return true;
  } catch {
    return false;
  }
}

const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Small k-means over a 64px downscale. Returns up to `k` colours sorted by share.
export async function extractPalette(file, k = 8) {
  if (!sharp) return [];
  let data;
  try {
    ({ data } = await sharp(file, { animated: false })
      .rotate()
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    return [];
  }
  const pixels = [];
  for (let i = 0; i < data.length; i += 3) pixels.push([data[i], data[i + 1], data[i + 2]]);
  if (!pixels.length) return [];

  // Farthest-point seeding so small but distinct accents (a red button, a lime block)
  // get their own cluster instead of being averaged into the background.
  const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  let centers = [[...pixels[Math.floor(pixels.length / 2)]]];
  const minD = pixels.map((p) => dist(p, centers[0]));
  while (centers.length < k) {
    let far = 0;
    for (let i = 1; i < pixels.length; i++) if (minD[i] > minD[far]) far = i;
    if (minD[far] < 400) break;
    centers.push([...pixels[far]]);
    pixels.forEach((p, i) => { minD[i] = Math.min(minD[i], dist(p, centers[centers.length - 1])); });
  }
  let assign = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, idx) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = ci; }
      });
      assign[idx] = best;
      const s = sums[best];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    centers = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[i]));
  }

  const counts = centers.map(() => 0);
  assign.forEach((c) => counts[c]++);
  const result = centers
    .map((c, i) => ({ hex: toHex(c), share: counts[i] / pixels.length, rgb: c }))
    .filter((c) => c.share > 0.015)
    .sort((a, b) => b.share - a.share);

  // Merge near-duplicates.
  const merged = [];
  for (const c of result) {
    const twin = merged.find((m) => Math.hypot(m.rgb[0] - c.rgb[0], m.rgb[1] - c.rgb[1], m.rgb[2] - c.rgb[2]) < 24);
    if (twin) twin.share += c.share;
    else merged.push(c);
  }
  return merged.map(({ hex, share }) => ({ hex, share: Math.round(share * 1000) / 1000 }));
}

const CLAUDE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 4.5 * 1024 * 1024;

// Prepares one or more base64 images for Claude. Very tall screenshots (full-page
// captures) are split into up to four vertical slices so detail survives.
export async function forClaude(file, { maxSlices = 4, maxEdge = 1568 } = {}) {
  if (!sharp) {
    const mime = mimeFor(file);
    const stat = fs.statSync(file);
    if (!CLAUDE_TYPES.has(mime) || stat.size > MAX_BYTES) {
      throw new Error('This image needs resizing/conversion before Claude can read it — install the optional "sharp" package (npm install sharp).');
    }
    return [{ media_type: mime, data: fs.readFileSync(file).toString('base64') }];
  }

  const base = sharp(file, { animated: false }).rotate();
  const meta = await sharp(file, { animated: false }).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  const rotated = meta.orientation >= 5;
  const width = rotated ? h : w;
  const height = rotated ? w : h;

  const encode = (img) => img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  if (height / width <= 2.2) {
    const buf = await encode(base.clone().flatten({ background: '#ffffff' }).resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }));
    return [{ media_type: 'image/jpeg', data: buf.toString('base64') }];
  }

  const targetW = Math.min(width, 1200);
  const scaled = await base.clone().flatten({ background: '#ffffff' }).resize({ width: targetW, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const sliceH = Math.min(maxEdge, Math.round(targetW * 1.4));
  const total = Math.ceil(scaled.info.height / sliceH);
  const picks = total <= maxSlices ? [...Array(total).keys()] : Array.from({ length: maxSlices }, (_, i) => Math.round((i * (total - 1)) / (maxSlices - 1)));

  const slices = [];
  for (const i of picks) {
    const top = i * sliceH;
    const height = Math.min(sliceH, scaled.info.height - top);
    const buf = await encode(sharp(scaled.data).extract({ left: 0, top, width: scaled.info.width, height }));
    slices.push({ media_type: 'image/jpeg', data: buf.toString('base64') });
  }
  return slices;
}

// A single small JPEG/PNG preview for MCP clients.
export async function preview(file, thumb, maxEdge = 1024) {
  if (sharp) {
    try {
      const buf = await sharp(file, { animated: false }).rotate().flatten({ background: '#ffffff' })
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 }).toBuffer();
      return { mimeType: 'image/jpeg', data: buf.toString('base64') };
    } catch { /* fall through */ }
  }
  for (const candidate of [thumb, file]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const mime = candidate.endsWith('.webp') ? 'image/webp' : mimeFor(candidate);
    if (CLAUDE_TYPES.has(mime) && fs.statSync(candidate).size < MAX_BYTES) {
      return { mimeType: mime, data: fs.readFileSync(candidate).toString('base64') };
    }
  }
  return null;
}

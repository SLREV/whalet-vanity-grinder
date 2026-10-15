/**
 * make-icons.mjs - membuat SEMUA ikon aplikasi tanpa dependensi apa pun.
 *
 * Sandbox/CI sering tidak punya ImageMagick atau `sharp`, dan mengunduh
 * libvips butuh akses keluar. Karena itu PNG-nya ditulis langsung: encoder
 * PNG + rasterizer vektor sederhana (rounded rect + gradien + glyph "V").
 *
 * Hasil: www/icons/* (PWA + Play Store), ikon/splash Android di
 * android/app/src/main/res/*, dan ikon listing docs/assets/play-icon-512.png.
 *
 * Pakai: node tools/make-icons.mjs
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPERSAMPLE = 2;

// ---------------------------------------------------------------------------
// Glyph "V" (8 x 9), digambar tebal supaya tetap terbaca di 48 px
// ---------------------------------------------------------------------------
const GLYPH = [
  '11000011',
  '11000011',
  '11000011',
  '01100110',
  '01100110',
  '00111100',
  '00111100',
  '00011000',
  '00011000',
];
const GW = 8;
const GH = 9;

// ---------------------------------------------------------------------------
// Warna
// ---------------------------------------------------------------------------
function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}
const C_TOP = hex('#12e79d');
const C_BOT = hex('#1693f2');
const C_GLYPH = hex('#06121f');
const C_SPLASH = hex('#0b1220');

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ---------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------
/**
 * Render ke buffer RGBA Float64 berukuran size x size.
 * @param {object} o {glyphWidth, cornerRadius (0 = kotak penuh), circle (bool), glyph (bool)}
 */
function rasterize(size, o) {
  const px = new Float64Array(size * size * 4);
  const r = (o.cornerRadius || 0) * size;
  const gw = o.glyphWidth * size;
  const gh = (gw * GH) / GW;
  const gx = (size - gw) / 2;
  const gy = (size - gh) / 2 + size * 0.01;

  const insideShape = (x, y) => {
    if (o.circle) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      return dx * dx + dy * dy <= (size / 2) * (size / 2);
    }
    if (r <= 0) return true;
    // rounded rect: cek pojok
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  const glyphAt = (x, y) => {
    const lx = (x - gx) / gw;
    const ly = (y - gy) / gh;
    if (lx < 0 || lx >= 1 || ly < 0 || ly >= 1) return false;
    const col = Math.floor(lx * GW);
    const row = Math.floor(ly * GH);
    return GLYPH[row][col] === '1';
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideShape(x + 0.5, y + 0.5)) continue;
      const i = (y * size + x) * 4;
      // Gradien diagonal.
      const t = (x / size) * 0.45 + (y / size) * 0.55;
      let c = mix(C_TOP, C_BOT, t);
      // PNG RGBA memakai alpha 0..255 (bukan 0..1).
      let a = 255;
      if (o.glyph && glyphAt(x + 0.5, y + 0.5)) c = C_GLYPH;
      if (o.transparent) {
        // Hanya glyph (untuk adaptive foreground).
        if (!glyphAt(x + 0.5, y + 0.5)) {
          px[i + 3] = 0;
          continue;
        }
        c = C_GLYPH;
      }
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = a;
    }
  }
  return px;
}

/** Box-downsample dari buffer besar ke ukuran target (anti-aliasing). */
function downsample(src, srcSize, dstSize) {
  const out = new Uint8Array(dstSize * dstSize * 4);
  const ratio = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      const y0 = Math.floor(y * ratio);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * srcSize + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const o = (y * dstSize + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encoder PNG (RGBA 8 bit)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Master render (sekali), lalu diturunkan ke semua ukuran
// ---------------------------------------------------------------------------
const MASTER = 512;
const masters = {
  // Kotak penuh + glyph besar: ikon PWA, ikon Play Store, mipmap legacy.
  full: rasterize(MASTER * SUPERSAMPLE, {
    glyphWidth: 0.5,
    cornerRadius: 0,
    glyph: true,
  }),
  fullSize: MASTER * SUPERSAMPLE,
  rounded: rasterize(MASTER * SUPERSAMPLE, {
    glyphWidth: 0.5,
    cornerRadius: 0.22,
    glyph: true,
  }),
  roundedSize: MASTER * SUPERSAMPLE,
  circle: rasterize(MASTER * SUPERSAMPLE, {
    glyphWidth: 0.5,
    circle: true,
    glyph: true,
  }),
  circleSize: MASTER * SUPERSAMPLE,
  // Adaptive icon Android: foreground transparan (glyph di safe zone),
  // background gradien penuh.
  fg: rasterize(432, { glyphWidth: 0.42, glyph: true, transparent: true }),
  fgSize: 432,
  bg: rasterize(432, { glyphWidth: 0, cornerRadius: 0, glyph: false }),
  bgSize: 432,
};

function derive(master, masterSize, size) {
  return downsample(master, masterSize, size);
}

/** Full-bleed dark Android splash with the same centered VanitySol mark. */
function renderSplash(width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = C_SPLASH[0];
    out[i * 4 + 1] = C_SPLASH[1];
    out[i * 4 + 2] = C_SPLASH[2];
    out[i * 4 + 3] = 255;
  }

  const size = Math.round(Math.min(width, height) * 0.34);
  const logo = derive(masters.rounded, masters.roundedSize, size);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      const target = ((top + y) * width + left + x) * 4;
      const alpha = logo[source + 3] / 255;
      for (let c = 0; c < 3; c++) {
        out[target + c] = Math.round(logo[source + c] * alpha + C_SPLASH[c] * (1 - alpha));
      }
      out[target + 3] = 255;
    }
  }
  return out;
}

async function writePng(file, rgba, width, height = width) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodePng(width, height, rgba));
  console.log('  ' + path.relative(ROOT, file).padEnd(58) + width + 'x' + height);
}

async function main() {
  console.log('\nMembuat ikon aplikasi…\n');

  // --- PWA / Play Store -------------------------------------------------
  await writePng(path.join(ROOT, 'www/icons/icon-96.png'), derive(masters.rounded, masters.roundedSize, 96), 96);
  await writePng(path.join(ROOT, 'www/icons/icon-192.png'), derive(masters.rounded, masters.roundedSize, 192), 192);
  await writePng(path.join(ROOT, 'www/icons/icon-512.png'), derive(masters.rounded, masters.roundedSize, 512), 512);
  await writePng(
    path.join(ROOT, 'www/icons/icon-512-maskable.png'),
    derive(masters.full, masters.fullSize, 512),
    512
  );
  await fs.writeFile(
    path.join(ROOT, 'www/icons/icon-512.png'),
    encodePng(512, 512, derive(masters.rounded, masters.roundedSize, 512))
  );

  // --- Android: mipmap legacy (API < 26) --------------------------------
  const RES = path.join(ROOT, 'android/app/src/main/res');
  const legacy = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192],
  ];
  for (const [dir, size] of legacy) {
    await writePng(
      path.join(RES, dir, 'ic_launcher.png'),
      derive(masters.full, masters.fullSize, size),
      size
    );
    await writePng(
      path.join(RES, dir, 'ic_launcher_round.png'),
      derive(masters.circle, masters.circleSize, size),
      size
    );
    // Adaptive icon (API 26+): foreground 108dp, background 108dp.
    const dp = (size / 48) * 108;
    await writePng(
      path.join(RES, dir, 'ic_launcher_foreground.png'),
      derive(masters.fg, masters.fgSize, dp),
      dp
    );
    await writePng(
      path.join(RES, dir, 'ic_launcher_background.png'),
      derive(masters.bg, masters.bgSize, dp),
      dp
    );
  }

  // drawable-anydpi-v26 dipakai kalau template Capacitor merujuk ke sana
  await writePng(
    path.join(RES, 'drawable-xxxhdpi', 'ic_launcher_foreground.png'),
    derive(masters.fg, masters.fgSize, 432),
    432
  );

  // Splash screen Capacitor bermerek, untuk portrait dan landscape pada semua density.
  const splashAssets = [
    ['drawable', 480, 320],
    ['drawable-land-mdpi', 480, 320],
    ['drawable-land-hdpi', 800, 480],
    ['drawable-land-xhdpi', 1280, 720],
    ['drawable-land-xxhdpi', 1600, 960],
    ['drawable-land-xxxhdpi', 1920, 1280],
    ['drawable-port-mdpi', 320, 480],
    ['drawable-port-hdpi', 480, 800],
    ['drawable-port-xhdpi', 720, 1280],
    ['drawable-port-xxhdpi', 960, 1600],
    ['drawable-port-xxxhdpi', 1280, 1920],
  ];
  for (const [dir, width, height] of splashAssets) {
    await writePng(path.join(RES, dir, 'splash.png'), renderSplash(width, height), width, height);
  }

  // Ikon Play Store (512x512, tanpa alpha lebih aman) -> simpan salinan
  await writePng(
    path.join(ROOT, 'docs/assets/play-icon-512.png'),
    derive(masters.full, masters.fullSize, 512),
    512
  );

  console.log('\nSelesai.\n');
}

main().catch((err) => {
  console.error('Gagal membuat ikon:', err);
  process.exit(1);
});

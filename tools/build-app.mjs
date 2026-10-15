/**
 * build-app.mjs - menyusun folder `www/` yang dipakai Capacitor & PWA.
 *
 *   www/  =  salinan app/  +  js/core/*.js (dari src/core)  +  build-info.js
 *
 * Sengaja tanpa bundler/minifier: aplikasi ini membuat private key, jadi kode
 * yang di-audit harus sama persis dengan kode yang dijalankan.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const CORE = path.join(ROOT, 'src', 'core');
const OUT = path.join(ROOT, 'www');

const CORE_FILES = ['base58.js', 'grinder-core.js'];
const LICENSED_PACKAGES = [
  ['@capacitor/core', 'capacitor-core'],
  ['@capacitor/android', 'capacitor-android'],
  ['@capacitor/filesystem', 'capacitor-filesystem'],
  ['@capacitor/share', 'capacitor-share'],
  ['@capacitor/haptics', 'capacitor-haptics'],
  ['@capacitor/status-bar', 'capacitor-status-bar'],
  ['@capacitor/synapse', 'capacitor-synapse'],
  ['tweetnacl', 'tweetnacl'],
];

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function main() {
  const pkg = await readJson(path.join(ROOT, 'package.json'));

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(APP, OUT, { recursive: true });
  await fs.copyFile(path.join(ROOT, 'docs', 'privacy.html'), path.join(OUT, 'privacy.html'));

  await fs.mkdir(path.join(OUT, 'js', 'core'), { recursive: true });
  for (const f of CORE_FILES) {
    await fs.copyFile(path.join(CORE, f), path.join(OUT, 'js', 'core', f));
  }

  // Sertakan teks lisensi penuh untuk kode pihak ketiga yang dikemas bersama app.
  const licenseDir = path.join(OUT, 'licenses');
  await fs.mkdir(licenseDir, { recursive: true });
  const licenseIndex = [
    'VanitySol - pemberitahuan perangkat lunak pihak ketiga',
    '',
    'Versi lisensi di bawah mengikuti package-lock.json pada build ini.',
    'Setiap berkas berisi teks lisensi asli paket terkait.',
    '',
  ];
  for (const [packageName, slug] of LICENSED_PACKAGES) {
    const packageDir = path.join(ROOT, 'node_modules', packageName);
    const packageInfo = await readJson(path.join(packageDir, 'package.json'));
    let licenseSource = null;
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
      try {
        await fs.access(path.join(packageDir, name));
        licenseSource = path.join(packageDir, name);
        break;
      } catch {}
    }
    if (!licenseSource) throw new Error('Berkas lisensi tidak ditemukan untuk ' + packageName);
    const licenseName = slug + '-LICENSE.txt';
    await fs.copyFile(licenseSource, path.join(licenseDir, licenseName));
    licenseIndex.push(
      packageName + ' ' + packageInfo.version + ' (' + packageInfo.license + '): ' + licenseName
    );
  }
  await fs.writeFile(
    path.join(licenseDir, 'THIRD-PARTY-NOTICES.txt'),
    licenseIndex.join('\n') + '\n',
    'utf8'
  );

  const now = new Date();
  const stamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0');

  const buildInfo =
    '// Dibuat otomatis oleh tools/build-app.mjs - jangan diedit manual.\n' +
    'window.SolanaVanityBuild = ' +
    JSON.stringify(
      {
        version: pkg.version,
        build: stamp + '.' + (pkg.buildNumber || 1),
        builtAt: now.toISOString(),
        androidVersionCode: Number(pkg.androidVersionCode || pkg.buildNumber || 1),
      },
      null,
      2
    ) +
    ';\n' +
    '// Deteksi runtime apakah berjalan di dalam APK (Capacitor) atau di browser.\n' +
    'window.SolanaVanityBuild.isNative = (function () {\n' +
    '  try {\n' +
    '    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function") {\n' +
    '      return window.Capacitor.isNativePlatform();\n' +
    '    }\n' +
    '    // Android Capacitor menyuntikkan Plugins, sedangkan versi web tidak.\n' +
    '    if (window.Capacitor && window.Capacitor.Plugins) return true;\n' +
    '    return false;\n' +
    '  } catch (e) { return false; }\n' +
    '})();\n';

  await fs.writeFile(path.join(OUT, 'build-info.js'), buildInfo, 'utf8');

  // Laporkan isi supaya hasil build bisa diverifikasi tanpa membuka browser.
  const files = [];
  await (async function walk(dir, rel) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(abs, r);
      else files.push([r, (await fs.stat(abs)).size]);
    }
  })(OUT, '');

  files.sort((a, b) => a[0].localeCompare(b[0]));
  const total = files.reduce((n, f) => n + f[1], 0);
  console.log(`\nwww/ siap  (${files.length} file, ${(total / 1024).toFixed(1)} kB)\n`);
  for (const [name, size] of files) {
    console.log('  ' + name.padEnd(34) + String(size).padStart(8) + ' B');
  }
  console.log('\nBerikutnya: npx cap sync android');
}

main().catch((err) => {
  console.error('Build app gagal:', err);
  process.exit(1);
});

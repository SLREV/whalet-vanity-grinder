// Dibuat otomatis oleh tools/build-app.mjs - jangan diedit manual.
window.SolanaVanityBuild = {
  "version": "1.0.0",
  "build": "20261015.1",
  "builtAt": "2026-10-15T03:50:09.034Z",
  "androidVersionCode": 1
};
// Deteksi runtime apakah berjalan di dalam APK (Capacitor) atau di browser.
window.SolanaVanityBuild.isNative = (function () {
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function") {
      return window.Capacitor.isNativePlatform();
    }
    // Android Capacitor menyuntikkan Plugins, sedangkan versi web tidak.
    if (window.Capacitor && window.Capacitor.Plugins) return true;
    return false;
  } catch (e) { return false; }
})();

// Without a Developer ID certificate electron-builder skips macOS signing and
// leaves the bundle with a broken seal (Electron's linker signature, with
// resources added after it). Apple Silicon refuses such an app outright
// ("damaged" / won't open) instead of offering Open Anyway, so ad-hoc sign the
// whole bundle. When a certificate is configured, electron-builder signs and
// notarizes it properly right after this hook and this does nothing.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${app} (no Developer ID certificate configured)`);
};

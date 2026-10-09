import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  console.error("Safari packaging requires macOS and Xcode. The portable bundle is in dist-safari/.");
  process.exit(1);
}

// Keep generated Xcode output separate from the portable extension sources.
const command = ["safari-web-extension-packager", "safari-web-extension-converter"].find((name) =>
  spawnSync("xcrun", ["--find", name], { encoding: "utf8" }).status === 0,
);
if (!command) {
  const selected = spawnSync("xcode-select", ["--print-path"], { encoding: "utf8" });
  console.error(`No Safari extension packaging tool found in the selected developer directory: ${process.env.DEVELOPER_DIR || selected.stdout?.trim() || "unknown"}.
Install the full Xcode app (Command Line Tools alone are insufficient), open it to complete setup, then retry with:
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run safari:convert
Adjust that path if Xcode is installed elsewhere. This overrides the developer directory for this command only.`);
  process.exit(1);
}
const result = spawnSync("xcrun", [
  command, resolve("dist-safari"),
  "--project-location", resolve("safari-build"),
  "--app-name", "Jev Ad Blocker",
  "--bundle-identifier", "org.icosahedron.jev-adblock",
  "--macos-only", "--swift", "--no-open", "--no-prompt",
  ...process.argv.slice(2),
], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

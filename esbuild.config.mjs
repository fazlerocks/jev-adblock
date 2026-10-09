import * as esbuild from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const safari = process.argv.includes("--safari");
const outdir = safari ? "dist-safari" : "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  target: safari ? "safari16.4" : "chrome121",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
};

const builds = [
  { entryPoints: { content: "src/content/index.ts" }, format: "iife", outdir },
  {
    entryPoints: {
      background: "src/background/index.ts",
      "popup/popup": "src/popup/popup.ts",
      "options/options": "src/options/options.ts",
    },
    format: "esm",
    outdir,
  },
];

const copyStatic = async () => {
  await cp("static", outdir, { recursive: true });
  if (safari) {
    const manifest = JSON.parse(await readFile(`${outdir}/manifest.json`, "utf8"));
    delete manifest.minimum_chrome_version;
    await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  }
};

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context({ ...common, ...b })));
  await Promise.all(contexts.map((c) => c.watch()));
  await copyStatic();
  const { watch: fsWatch } = await import("node:fs");
  fsWatch("static", { recursive: true }, () => copyStatic().catch(console.error));
  console.log("watching src/ and static/ …");
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
  await copyStatic();
}

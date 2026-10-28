import { defineConfig } from "vite-plus/pack";

export default defineConfig({
  deps: {
    // tsdown <0.23 compatibility: resolve external dependency subpaths.
    // Remove to preserve subpath imports as written (the new default).
    // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
    resolveDepSubpath: true,
  },
  entry: ["src/index.ts", "src/diff.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "browser",
  copy: [{ from: "src/styles.css", to: "dist" }],
});

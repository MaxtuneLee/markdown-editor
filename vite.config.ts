import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import tsdownConfig from "./tsdown.config.js";

export default defineConfig({
  pack: tsdownConfig,
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["test/setup.ts"] },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {
    ignorePatterns: ["dist"],
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    sortPackageJson: false,
  },
});

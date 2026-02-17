import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/background.ts", "src/content.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  // Bundle @wild/shared so the extension has no bare specifier at runtime.
  noExternal: ["@wild/shared"],
});

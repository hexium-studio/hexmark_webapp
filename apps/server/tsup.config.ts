import { defineConfig } from "tsup";

// Bundles workspace packages (shipped as TypeScript source) into dist/;
// npm dependencies stay external and are installed in the runtime image.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@hexmark\//],
});

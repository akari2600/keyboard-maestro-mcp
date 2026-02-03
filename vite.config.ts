import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

export default defineConfig({
  plugins: [viteSingleFile()],
  root: "src/ui",
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        config: resolve(__dirname, "src/ui/config.html"),
      },
    },
  },
});

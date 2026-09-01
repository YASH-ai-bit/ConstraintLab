import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sites } from "@openai/sites-vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sites(),
    {
      name: "constraintlab-static-worker",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "server/index.js",
          source: "export default { async fetch(request, env) { return env.ASSETS.fetch(request); } };\n",
        });
      },
    },
  ],
  worker: { format: "es" },
  build: { target: "es2022" },
});

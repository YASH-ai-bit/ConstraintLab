import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sites } from "@openai/sites-vite-plugin";
import { copyFile, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

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
          source: `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === "GET" && !url.pathname.split("/").at(-1)?.includes(".")) {
      url.pathname = "/index.html";
      response = await env.ASSETS.fetch(new Request(url, request));
    }
    return response;
  },
};
`,
        });
      },
      async closeBundle() {
        const output = resolve("dist");
        const client = resolve(output, "client");
        await mkdir(client, { recursive: true });
        await Promise.all([
          copyFile(resolve(output, "index.html"), resolve(client, "index.html")),
          copyFile(resolve(output, "highs.wasm"), resolve(client, "highs.wasm")),
          copyFile(resolve(output, "constraintlab-logo.svg"), resolve(client, "constraintlab-logo.svg")),
          cp(resolve(output, "assets"), resolve(client, "assets"), { recursive: true }),
        ]);
      },
    },
  ],
  worker: { format: "es" },
  build: { target: "es2022" },
});

import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../node_modules/highs/build/highs.wasm", import.meta.url),
  new URL("../public/highs.wasm", import.meta.url),
);

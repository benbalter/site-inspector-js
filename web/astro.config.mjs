// @ts-check
import { defineConfig, passthroughImageService } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// The site-inspector engine spawns headless Chrome (lighthouse), jsdom, and other
// native/Node-only deps. It must run in Node SSR and be loaded natively from
// node_modules rather than bundled by Vite — so we externalize it for SSR.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // This app has no images; skip the sharp-based image service so the SSR build
  // doesn't require the optional `sharp` native dependency.
  image: { service: passthroughImageService() },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ["site-inspector"],
    },
  },
});

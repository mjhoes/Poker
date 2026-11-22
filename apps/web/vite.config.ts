import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/analyses\/manifest\.json$/,
            handler: "NetworkFirst",
            options: { cacheName: "perfect-draw-manifest-v4", networkTimeoutSeconds: 3, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: /\/analyses\/[a-f0-9]{64}\.bin$/,
            handler: "CacheFirst",
            options: { cacheName: "perfect-draw-analyses-v4", cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 8 } },
          },
        ],
      },
      manifest: {
        name: "Perfect Draw",
        short_name: "Perfect Draw",
        description: "A local-first video poker trainer.",
        theme_color: "#101a18",
        background_color: "#101a18",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

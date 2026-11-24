import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      workbox: {
        // Fonts are part of the app shell: precache them so the interface looks the same offline.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
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
        description: "Practice perfect video poker against any pay table.",
        theme_color: "#174d3e",
        background_color: "#f1f0e8",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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

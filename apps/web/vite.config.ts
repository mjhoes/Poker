import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";

/*
 * Content-Security-Policy for the deployed app (Tech Spec §7.1): only this site's own scripts, and network calls only to
 * this site and the two AI providers, to limit the damage any injected script could do to a stored API key. Build only:
 * the dev server needs Vite's websocket and inline client.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React style attributes
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com https://api.openai.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
const contentSecurityPolicy: Plugin = {
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
};

export default defineConfig({
  plugins: [
    react(),
    contentSecurityPolicy,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      workbox: {
        // Fonts are part of the app shell: precache them so the interface looks the same offline.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // The AI SDKs load on first use and need the network anyway; don't make every install download them. The same goes
        // for the HEIC decoder (3 MB, only for HEIC photos on browsers that can't open them, which are read online).
        globIgnores: ["**/assets/anthropic-*.js", "**/assets/openai-*.js", "**/assets/heic-to-*.js"],
        // Open-source notices, license texts and source archives are files, not app pages: never answer them with the app.
        navigateFallbackDenylist: [/^\/licenses\//],
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

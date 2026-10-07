import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves project sites under /<repo>/. Override with VITE_BASE=/ for root hosting.
const base = process.env.VITE_BASE ?? '/quack-doku/';

export default defineConfig({
  base,
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', testTimeout: 120_000 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png', 'cover.png'],
      manifest: {
        id: base,
        name: 'Quack-doku',
        short_name: 'Quack-doku',
        description: 'Place one rubber duck in every row, column and colour, and no two ducks may touch. 400 cozy logic puzzles and a Daily Duck.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#e6f6fd',
        theme_color: '#cdeefc',
        categories: ['games', 'puzzle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [{ src: 'cover.png', sizes: '1200x630', type: 'image/png', form_factor: 'wide', label: 'Quack-doku puzzle board' }],
      },
      workbox: {
        // Precache the app shell, the puzzle packs, fonts and icons so the game runs fully
        // offline once installed. Splash screens are only fetched by iOS at install time.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['splash/**', 'cover.png'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});

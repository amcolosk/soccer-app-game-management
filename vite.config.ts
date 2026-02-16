import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Read version from package.json
const packageJson = await import('./package.json', { with: { type: 'json' } });
const version = packageJson.default.version;

// Generate build timestamp
const buildTimestamp = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
    'import.meta.env.VITE_DEPLOYMENT_ID': JSON.stringify(process.env.AWS_DEPLOYMENT_ID || process.env.AWS_BRANCH || 'local'),
    'import.meta.env.VITE_APP_ID': JSON.stringify(process.env.AWS_APP_ID || ''),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['soccer_app_192.png', 'soccer_app_512.png'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Sports Game Management',
        short_name: 'TeamTrack',
        description: 'Manage your soccer team, track game time, and record goals',
        theme_color: '#1a472a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'soccer_app_192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'soccer_app_512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/(?!api\/).*/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.execute-api\..*\.amazonaws\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'amplify-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})

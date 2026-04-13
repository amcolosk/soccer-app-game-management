import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Read version from package.json
const packageJson = await import('./package.json', { with: { type: 'json' } });
const version = packageJson.default.version;

function sanitizeBuildId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim().replace(/[^A-Za-z0-9._-]/g, '');
  if (!candidate) {
    return null;
  }

  return candidate;
}

function sanitizeHash(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim().toLowerCase();
  if (!candidate) {
    return null;
  }

  if (!/^[0-9a-f]+$/.test(candidate)) {
    return null;
  }

  return candidate.slice(0, 8);
}

function resolveCommitHash(): string | null {
  const envHash =
    sanitizeHash(process.env.VITE_GIT_SHA) ??
    sanitizeHash(process.env.GITHUB_SHA) ??
    sanitizeHash(process.env.AWS_COMMIT_ID);

  if (envHash) {
    return envHash;
  }

  try {
    const gitHash = execSync('git rev-parse --short=8 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    return sanitizeHash(gitHash);
  } catch {
    return null;
  }
}

// Compose build version as: semver[-buildId][+hash]
const buildId = sanitizeBuildId(process.env.AWS_JOB_ID);
const commitHash = resolveCommitHash();
const versionWithBuildId = buildId ? `${version}-${buildId}` : version;
const fullVersion = commitHash ? `${versionWithBuildId}+${commitHash}` : versionWithBuildId;

// Generate build timestamp
const buildTimestamp = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(fullVersion),
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

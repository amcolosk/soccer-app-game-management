# PWA Update Guide

## Why PWA Updates Weren't Working

The app was configured with `registerType: 'autoUpdate'` but wasn't properly:
1. Registering the service worker
2. Checking for updates
3. Prompting users to reload
4. Handling the update lifecycle

## What Was Fixed

### 1. Service Worker Registration
- Added proper service worker registration in `main.tsx`
- Service worker now checks for updates every 60 seconds
- Added `UpdatePrompt` component for user-friendly update notifications

### 2. Update Strategy
Changed from `autoUpdate` to `prompt`:
- **autoUpdate**: Silently updates in background (can cause inconsistencies)
- **prompt**: Shows user notification when update is available (more reliable)

### 3. Workbox Configuration
- `skipWaiting: false` - New service worker waits for user confirmation
- `clientsClaim: false` - Allows controlled activation
- `cleanupOutdatedCaches: true` - Removes old cached data

## How to Deploy Updates

### Step 1: Update Version Number
Edit `package.json`:
```json
{
  "version": "1.0.1"  // Increment this
}
```

### Step 2: Build the App
```bash
npm run build
```

### Step 3: Deploy to Amplify
```bash
git add .
git commit -m "Release v1.0.1"
git push
```

### Step 4: What Users Will See
1. App checks for updates every 60 seconds
2. When new version is detected, a popup appears:
   - "New version available!"
   - "Click reload to get the latest updates"
3. User clicks "Reload" → App updates immediately
4. Version number in footer updates to show new version

## Testing Updates on Your Phone

### Method 1: Force Update Check
1. Close the PWA completely (swipe away from recent apps)
2. Wait 30 seconds
3. Reopen the PWA
4. Update prompt should appear if new version exists

### Method 2: Clear PWA Data (Nuclear Option)
**iOS:**
1. Settings → Safari → Advanced → Website Data
2. Find your app domain
3. Swipe left and delete
4. Reopen PWA

**Android:**
1. Settings → Apps → [Your App Name]
2. Storage → Clear Storage
3. Or: Chrome → Settings → Site Settings → [Your Domain] → Clear & Reset
4. Reopen PWA

### Method 3: Uninstall and Reinstall
1. Long-press the app icon
2. Select "Remove from Home Screen" or "Uninstall"
3. Open browser and navigate to your app URL
4. Install PWA again

## Verifying the Update

Check the version number in the footer:
- Should show the new version from `package.json`
- Format: "Version 1.0.1" (or current version)

## Update Lifecycle

```
User opens PWA
    ↓
Service Worker checks for updates (every 60s)
    ↓
New version found?
    ↓ Yes
Update prompt appears
    ↓
User clicks "Reload"
    ↓
New service worker activates
    ↓
Page reloads with new code
    ↓
Version number updates in footer
```

## Common Issues & Solutions

### "Updates not showing immediately"
- PWA checks every 60 seconds, not instantly
- Close and reopen app to trigger immediate check

### "Old version still showing after update"
- User clicked "Later" on update prompt
- They need to click "Reload" when prompted

### "Update prompt not appearing"
- Check browser console for service worker errors
- Verify app is served over HTTPS
- Ensure service worker is registered (check DevTools → Application → Service Workers)

## Development vs Production

### Development (npm run dev)
- Service worker enabled via `devOptions`
- Updates check more frequently
- Easier to test update flow

### Production (deployed)
- Service worker caches all assets
- Update checks happen every 60 seconds
- More aggressive caching for performance

## Best Practices

1. **Always increment version** in `package.json` before deploying
2. **Test locally** with `npm run build && npm run preview`
3. **Communicate updates** to users (consider release notes)
4. **Monitor adoption** - check analytics for version numbers
5. **Don't force updates** too frequently - respect user's choice to update later

// Vitest stand-in for vite-plugin-pwa's `virtual:pwa-register/react`, which only exists
// when the PWA plugin runs (not under vitest). Aliased in vitest.config.ts.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: () => Promise.resolve(),
  };
}

/**
 * Returns true when running on a likely iOS/iPadOS device.
 *
 * Detection strategy:
 *  - Classic: UA contains "iPad", "iPhone", or "iPod"
 *  - iPadOS 13+: UA reports "Macintosh" but device exposes multiple touch points
 */
export function isLikelyIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

import toast from 'react-hot-toast';

/**
 * Centralized toast notification helpers.
 * Wraps react-hot-toast with consistent styling and durations.
 */

/** Show an error toast (red, 4s) */
export const showError = (message: string) =>
  toast.error(message, { duration: 4000 });

/** Show a success toast (green, 2.5s) */
export const showSuccess = (message: string) =>
  toast.success(message, { duration: 2500 });

/** Show a warning toast (amber, 3.5s) */
export const showWarning = (message: string) =>
  toast(message, {
    icon: '⚠️',
    duration: 3500,
    style: { background: '#fff3cd', color: '#856404', border: '1px solid #ffc107' },
  });

/** Show an info toast (blue, 3s) */
export const showInfo = (message: string) =>
  toast(message, {
    icon: 'ℹ️',
    duration: 3000,
    style: { background: '#d1ecf1', color: '#0c5460', border: '1px solid #17a2b8' },
  });

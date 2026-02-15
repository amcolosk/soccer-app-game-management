import { showError } from './toast';

/** Log error and show toast to user. Use for operations where user should know something failed. */
export function handleApiError(error: unknown, userMessage: string): void {
  console.error(userMessage, error);
  showError(userMessage);
}

/** Log error only. Use for non-critical failures where the app still works (auth init, localStorage restore). */
export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error);
}

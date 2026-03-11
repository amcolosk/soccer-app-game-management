import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApiError, logError } from './errorHandler';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockShowError } = vi.hoisted(() => ({
  mockShowError: vi.fn(),
}));

vi.mock('./toast', () => ({
  showError: mockShowError,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('errorHandler', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('handleApiError', () => {
    it('logs the error to console.error', () => {
      const error = new Error('Test error');
      const message = 'Failed to save data';

      handleApiError(error, message);

      expect(consoleErrorSpy).toHaveBeenCalledWith(message, error);
    });

    it('calls showError with the user-readable message', () => {
      const error = new Error('Test error');
      const message = 'Failed to save data';

      handleApiError(error, message);

      expect(mockShowError).toHaveBeenCalledWith(message);
    });
  });

  describe('logError', () => {
    it('logs the error with context prefix to console.error', () => {
      const error = new Error('Test error');
      const context = 'Auth Init';

      logError(context, error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(`[${context}]`, error);
    });

    it('does NOT call showError', () => {
      const error = new Error('Test error');
      const context = 'Auth Init';

      logError(context, error);

      expect(mockShowError).not.toHaveBeenCalled();
    });
  });
});

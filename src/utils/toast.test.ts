import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showError, showSuccess, showWarning, showInfo } from './toast';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockToast, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(mockToast, {
    error: mockToastError,
    success: mockToastSuccess,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('showError', () => {
    it('calls toast.error with message and 4s duration', () => {
      showError('Something went wrong');

      expect(mockToastError).toHaveBeenCalledWith('Something went wrong', {
        duration: 4000,
      });
    });
  });

  describe('showSuccess', () => {
    it('calls toast.success with message and 2.5s duration', () => {
      showSuccess('Operation successful');

      expect(mockToastSuccess).toHaveBeenCalledWith('Operation successful', {
        duration: 2500,
      });
    });
  });

  describe('showWarning', () => {
    it('calls toast with amber/orange style and 3.5s duration', () => {
      showWarning('This is a warning');

      expect(mockToast).toHaveBeenCalledWith('This is a warning', {
        icon: '⚠️',
        duration: 3500,
        style: {
          background: '#fff3cd',
          color: '#856404',
          border: '1px solid #ffc107',
        },
      });
    });
  });

  describe('showInfo', () => {
    it('calls toast with blue style and 3s duration', () => {
      showInfo('This is informational');

      expect(mockToast).toHaveBeenCalledWith('This is informational', {
        icon: 'ℹ️',
        duration: 3000,
        style: {
          background: '#d1ecf1',
          color: '#0c5460',
          border: '1px solid #17a2b8',
        },
      });
    });
  });
});

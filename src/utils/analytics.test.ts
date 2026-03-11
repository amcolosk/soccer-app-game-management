import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initGA, trackPageView, trackEvent, AnalyticsEvents } from './analytics';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockInitialize, mockSend, mockEvent } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockSend: vi.fn(),
  mockEvent: vi.fn(),
}));

vi.mock('react-ga4', () => ({
  default: {
    initialize: mockInitialize,
    send: mockSend,
    event: mockEvent,
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initGA', () => {
    it('calls ReactGA.initialize with the provided measurement ID', () => {
      const measurementId = 'G-XXXXXXXXXX';

      initGA(measurementId);

      expect(mockInitialize).toHaveBeenCalledWith(measurementId);
    });
  });

  describe('trackPageView', () => {
    it('sends correct page path', () => {
      const path = '/game/123';

      trackPageView(path);

      expect(mockSend).toHaveBeenCalledWith({
        hitType: 'pageview',
        page: path,
      });
    });
  });

  describe('trackEvent', () => {
    it('calls ReactGA.event with category and action', () => {
      trackEvent('TestCategory', 'TestAction');

      expect(mockEvent).toHaveBeenCalledWith({
        category: 'TestCategory',
        action: 'TestAction',
        label: undefined,
      });
    });

    it('calls ReactGA.event with label when provided', () => {
      trackEvent('TestCategory', 'TestAction', 'TestLabel');

      expect(mockEvent).toHaveBeenCalledWith({
        category: 'TestCategory',
        action: 'TestAction',
        label: 'TestLabel',
      });
    });
  });

  describe('AnalyticsEvents', () => {
    it('all exported event constants have non-empty category and action strings', () => {
      const events = Object.values(AnalyticsEvents);

      expect(events.length).toBeGreaterThan(0);

      for (const event of events) {
        expect(event.category).toBeTruthy();
        expect(event.category).not.toBe('');
        expect(event.action).toBeTruthy();
        expect(event.action).not.toBe('');
      }
    });
  });
});

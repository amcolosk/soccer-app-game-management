/**
 * Tests for src/help.ts — HELP_CONTENT registry validation.
 *
 * These tests enforce the content authoring guidelines:
 * - All HelpScreenKey values are present
 * - Each article has required fields with non-empty content
 * - Tasks ≤ 4 per screen, each with ≥ 1 step and ≤ 6 steps
 * - Tips ≤ 3 per screen, each with non-empty text
 * - Related screens ≤ 2 per article, all keys are valid
 */
import { describe, it, expect } from 'vitest';
import { HELP_CONTENT } from './help';
import type { HelpScreenKey } from './help';

const ALL_KEYS: HelpScreenKey[] = [
  'home',
  'game-scheduled',
  'game-in-progress',
  'game-halftime',
  'game-completed',
  'game-planner',
  'season-reports',
  'manage-teams',
  'manage-players',
  'manage-formations',
  'manage-sharing',
  'manage-app',
  'profile',
  'formation-visual-editor',
];

describe('HELP_CONTENT registry', () => {
  it('contains exactly 14 entries', () => {
    expect(Object.keys(HELP_CONTENT)).toHaveLength(14);
  });

  it.each(ALL_KEYS)('contains an entry for key "%s"', (key) => {
    expect(HELP_CONTENT[key]).toBeDefined();
  });

  describe.each(ALL_KEYS)('article for key "%s"', (key) => {
    it('has a non-empty screenTitle', () => {
      const { screenTitle } = HELP_CONTENT[key];
      expect(typeof screenTitle).toBe('string');
      expect(screenTitle.trim().length).toBeGreaterThan(0);
    });

    it('has a non-empty overview', () => {
      const { overview } = HELP_CONTENT[key];
      expect(typeof overview).toBe('string');
      expect(overview.trim().length).toBeGreaterThan(0);
    });

    it('has at least 1 task', () => {
      expect(HELP_CONTENT[key].tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('has at most 4 tasks', () => {
      expect(HELP_CONTENT[key].tasks.length).toBeLessThanOrEqual(4);
    });

    it('has at least 1 tip', () => {
      expect(HELP_CONTENT[key].tips.length).toBeGreaterThanOrEqual(1);
    });

    it('has at most 3 tips', () => {
      expect(HELP_CONTENT[key].tips.length).toBeLessThanOrEqual(3);
    });

    it('has no empty tip text', () => {
      HELP_CONTENT[key].tips.forEach((tip) => {
        expect(tip.text.trim().length).toBeGreaterThan(0);
      });
    });

    it('each task has at least 1 step', () => {
      HELP_CONTENT[key].tasks.forEach((task) => {
        expect(task.steps.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('each task has at most 6 steps', () => {
      HELP_CONTENT[key].tasks.forEach((task) => {
        expect(task.steps.length).toBeLessThanOrEqual(6);
      });
    });

    it('each task has a non-empty title', () => {
      HELP_CONTENT[key].tasks.forEach((task) => {
        expect(task.title.trim().length).toBeGreaterThan(0);
      });
    });

    it('each step is a non-empty string', () => {
      HELP_CONTENT[key].tasks.forEach((task) => {
        task.steps.forEach((step) => {
          expect(step.trim().length).toBeGreaterThan(0);
        });
      });
    });

    it('relatedScreens has at most 2 entries (if present)', () => {
      const { relatedScreens } = HELP_CONTENT[key];
      if (relatedScreens !== undefined) {
        expect(relatedScreens.length).toBeLessThanOrEqual(2);
      }
    });

    it('relatedScreens entries are valid HelpScreenKeys (if present)', () => {
      const { relatedScreens } = HELP_CONTENT[key];
      if (relatedScreens !== undefined) {
        relatedScreens.forEach((relatedKey) => {
          expect(ALL_KEYS).toContain(relatedKey);
        });
      }
    });
  });
});

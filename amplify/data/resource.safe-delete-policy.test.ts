import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('safe-delete authorization policy', () => {
  const filePath = resolve(__dirname, 'resource.ts');
  const source = readFileSync(filePath, 'utf-8');

  it('does not grant model delete to Formation, Team, Player, or Game', () => {
    const blockedDeleteModels = ['Formation', 'Team', 'Player', 'Game'];

    for (const modelName of blockedDeleteModels) {
      const modelStart = source.indexOf(`${modelName}: a`);
      expect(modelStart).toBeGreaterThanOrEqual(0);
      const nextModel = source.indexOf('\n\n  ', modelStart + 1);
      const block = source.slice(modelStart, nextModel > modelStart ? nextModel : undefined);

      expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read', 'update'\]\)/);
    }
  });

  it('declares authoritative safe-delete mutations for the same entities', () => {
    expect(source).toContain('deleteFormationSafe: a');
    expect(source).toContain('deleteTeamSafe: a');
    expect(source).toContain('deletePlayerSafe: a');
    expect(source).toContain('deleteGameSafe: a');
  });
});

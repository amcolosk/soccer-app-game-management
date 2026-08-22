import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filePath = resolve(__dirname, 'resource.ts');
// amplify/data/resource.ts is CRLF on disk (confirmed: 557 \r\n, 0 bare \n).
// readFileSync(..., 'utf-8') does not normalize line endings, so every block
// boundary below is computed on a normalized copy, not the raw file text.
const rawSource = readFileSync(filePath, 'utf-8');
const source = rawSource.replace(/\r\n/g, '\n');

/**
 * Extracts a source block starting at the line exactly matching
 * `^  ${label}: a$` (top-level schema entries are declared at 2-space
 * indent) through the next line that is empty OR whitespace-only (some
 * separators in this file are a lone "  ", not a truly empty line — e.g.
 * between deletePlayerSafe and QueuedSubstitution). Anchoring on the full
 * line — not a raw substring search — means this can never accidentally
 * match a differently-named declaration that merely contains `${label}: a`
 * as a substring (e.g. `Team: a` inside `archiveTeam: a`), so unlike the
 * original test, block order in the file has no bearing on correctness.
 */
function extractBlock(label: string): string {
  const lines = source.split('\n');
  // label is always one of a fixed, hardcoded set of model/operation names
  // passed at call sites in this file; never derived from external input.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const startPattern = new RegExp(`^  ${label}: a$`);
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  expect(startIndex).toBeGreaterThanOrEqual(0);

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^\s*$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

describe('safe-delete authorization policy', () => {
  it('does not grant model delete to Formation, Team, Player, Game, or GameNote; Game also has no model-level create (TEAM-ARCHIVE-STEP11)', () => {
    const blockedDeleteModels = ['Formation', 'Team', 'Player', 'Game', 'GameNote'];

    for (const modelName of blockedDeleteModels) {
      const block = extractBlock(modelName);

      if (modelName === 'GameNote') {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)/);
      } else if (modelName === 'Game') {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['read', 'update'\]\)/);
      } else {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read', 'update'\]\)/);
      }
    }
  });

  it('declares authoritative safe-delete mutations for the same entities', () => {
    expect(source).toContain('deleteFormationSafe: a');
    expect(source).toContain('deleteTeamSafe: a');
    expect(source).toContain('deletePlayerSafe: a');
    expect(source).toContain('deleteGameSafe: a');
    expect(source).toContain('deleteSecureGameNote: a');
  });

  it('declares a Lambda-backed createGameSafe mutation returning Game with no client-supplied coaches argument', () => {
    const block = extractBlock('createGameSafe');

    expect(block).toContain('.mutation()');
    expect(block).toContain('teamId: a.string().required()');
    expect(block).toContain('opponent: a.string().required()');
    expect(block).toContain('isHome: a.boolean().required()');
    expect(block).not.toContain('coaches:');
    expect(block).toContain(".returns(a.ref('Game'))");
    expect(block).toContain('allow.authenticated()');
    expect(block).toContain('a.handler.function(createGameSafe)');
  });
});

describe('team lifecycle field authorization policy', () => {
  const teamBlock = extractBlock('Team');

  it('keeps the whole Team model in one block bounded by a blank/whitespace-only line', () => {
    // Guards the bounding logic every other test in this describe depends
    // on: a blank line inside the Team model would silently truncate the
    // block and weaken every assertion made against it.
    expect(teamBlock).toContain('archivedBy');
    expect(teamBlock).toContain("allow.ownersDefinedIn('coaches').to(['create', 'read', 'update'])");
  });

  it('lets the creator stamp ownerId at create time but never update it', () => {
    expect(teamBlock).toMatch(
      /ownerId: a\.string\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read'\]\)\]\)/
    );
  });

  it('keeps status, archivedAt, and archivedBy read-only for coaches', () => {
    expect(teamBlock).toMatch(
      /status: a\.string\(\)\.default\('active'\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
    expect(teamBlock).toMatch(
      /archivedAt: a\.datetime\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
    expect(teamBlock).toMatch(
      /archivedBy: a\.string\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
  });

  it('grants no update on any lifecycle field', () => {
    const lifecycleFieldLines = teamBlock
      .split('\n')
      .filter((line) => /^\s+(ownerId|status|archivedAt|archivedBy):/.test(line));

    expect(lifecycleFieldLines).toHaveLength(4);
    for (const line of lifecycleFieldLines) {
      expect(line).toContain('.authorization(');
      expect(line).not.toContain("'update'");
    }
  });

  it('declares owner-authorized lifecycle mutations returning Team', () => {
    for (const operation of ['archiveTeam', 'restoreTeam', 'assignTeamOwner']) {
      const block = extractBlock(operation);

      expect(block).toContain('.mutation()');
      expect(block).toContain('teamId: a.string().required()');
      expect(block).toContain(".returns(a.ref('Team'))");
      expect(block).toContain('allow.authenticated()');
      expect(block).toContain(`a.handler.function(${operation})`);
    }
  });
});

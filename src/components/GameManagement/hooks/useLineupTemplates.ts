import { useCallback, useRef, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import { assertMutationResult } from "../../../services/amplifyMutationResult";
import {
  MAX_LINEUP_TEMPLATES,
  normalizeTemplateName,
  parseLineupTemplates,
  parseLineupTemplatesLenient,
  serializeLineupTemplates,
  type LineupTemplate,
  type LineupTemplateInput,
} from "../../../utils/planTemplateUtils";

const client = generateClient<Schema>();

interface UseLineupTemplatesResult {
  /** undefined until the first load completes. */
  templates: LineupTemplate[] | undefined;
  loadError: string | null;
  refresh: () => Promise<void>;
  saveTemplate: (input: LineupTemplateInput) => Promise<LineupTemplate>;
  renameTemplate: (id: string, name: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

/**
 * Templates live in Team.lineupTemplates. The team prop is a one-time navigation snapshot, so this hook
 * reads the team itself and writes from a fresh read; it never trusts a cached copy.
 */
export function useLineupTemplates(teamId: string): UseLineupTemplatesResult {
  const [templates, setTemplates] = useState<LineupTemplate[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const writeInFlightRef = useRef(false);

  const fetchRaw = useCallback(async (): Promise<unknown> => {
    const result = await client.models.Team.get({ id: teamId });
    return assertMutationResult(result, "Team not found").lineupTemplates;
  }, [teamId]);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      // Display path tolerates malformed entries; the write path below still refuses to overwrite unreadable data.
      setTemplates(parseLineupTemplatesLenient(await fetchRaw()));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load templates");
      setTemplates((prev) => prev ?? []);
    }
  }, [fetchRaw]);

  const write = useCallback(
    async <T,>(change: (current: LineupTemplate[]) => { next: LineupTemplate[]; value: T }): Promise<T> => {
      if (writeInFlightRef.current) {
        throw new Error("Another template change is still saving. Try again in a moment.");
      }
      writeInFlightRef.current = true;
      try {
        const current = parseLineupTemplates(await fetchRaw());
        const { next, value } = change(current);
        const result = await client.models.Team.update({
          id: teamId,
          lineupTemplates: serializeLineupTemplates(next),
        });
        assertMutationResult(result, "Failed to save templates");
        setTemplates(next);
        return value;
      } finally {
        writeInFlightRef.current = false;
      }
    },
    [fetchRaw, teamId]
  );

  const saveTemplate = useCallback(
    (input: LineupTemplateInput) =>
      write((current) => {
        if (current.length >= MAX_LINEUP_TEMPLATES) {
          throw new Error(`You can save up to ${MAX_LINEUP_TEMPLATES} templates. Delete one to save another.`);
        }
        const name = normalizeTemplateName(input.name);
        if (!name) throw new Error("Enter a name for the template.");
        const now = new Date().toISOString();
        const template: LineupTemplate = {
          ...input,
          name,
          id: crypto.randomUUID(),
          savedAt: now,
          updatedAt: now,
        };
        return { next: [...current, template], value: template };
      }),
    [write]
  );

  const renameTemplate = useCallback(
    (id: string, name: string) =>
      write((current) => {
        const trimmed = normalizeTemplateName(name);
        if (!trimmed) throw new Error("Enter a name for the template.");
        if (!current.some((t) => t.id === id)) throw new Error("That template no longer exists.");
        const now = new Date().toISOString();
        return {
          next: current.map((t) => (t.id === id ? { ...t, name: trimmed, updatedAt: now } : t)),
          value: undefined,
        };
      }),
    [write]
  );

  const deleteTemplate = useCallback(
    (id: string) =>
      write((current) => ({ next: current.filter((t) => t.id !== id), value: undefined })),
    [write]
  );

  return { templates, loadError, refresh, saveTemplate, renameTemplate, deleteTemplate };
}

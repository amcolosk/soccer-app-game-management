import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  mapTemplateToTeam,
  type LineupTemplate,
  type TemplateMapResult,
} from "../../utils/planTemplateUtils";
import type { FormationPosition, PlayerWithRoster } from "./types";

interface LineupTemplatesPanelProps {
  templates: LineupTemplate[] | undefined;
  error: string | null;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  teamFormationId?: string | null;
  /** Why Apply is unavailable right now (unsaved edits, offline, archived team, data not loaded). */
  applyBlockedReason: string | null;
  canManage: boolean;
  /** Why rename/delete are unavailable when canManage is false. */
  manageBlockedReason?: string | null;
  onRetry?: () => void;
  isBusy: boolean;
  onApply: (template: LineupTemplate, mapped: TemplateMapResult) => void;
  onRename: (template: LineupTemplate) => void;
  onDelete: (template: LineupTemplate) => void;
}

export function LineupTemplatesPanel({
  templates,
  error,
  players,
  positions,
  teamFormationId,
  applyBlockedReason,
  canManage,
  manageBlockedReason,
  onRetry,
  isBusy,
  onApply,
  onRename,
  onDelete,
}: LineupTemplatesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef(templates?.length ?? 0);
  const reasonId = useId();

  const mapContext = useMemo(
    () => ({
      rosterPlayerIds: new Set(players.map((p) => p.id)),
      positionIds: positions.map((p) => p.id),
      teamFormationId,
    }),
    [players, positions, teamFormationId]
  );

  const sorted = useMemo(
    () => [...(templates ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    [templates]
  );

  useEffect(() => {
    // A deleted row unmounts whatever had focus; park focus on the panel instead of dropping it to <body>.
    if (sorted.length < previousCountRef.current) panelRef.current?.focus();
    previousCountRef.current = sorted.length;
  }, [sorted.length]);

  const selected = sorted.find((t) => t.id === selectedId) ?? null;
  const mapped = useMemo(
    () => (selected ? mapTemplateToTeam(selected, mapContext) : null),
    [selected, mapContext]
  );

  const playerLabel = (playerId: string) => {
    if (!playerId) return "Empty";
    const p = players.find((x) => x.id === playerId);
    return p ? `#${p.playerNumber ?? "?"} ${p.firstName} ${p.lastName}` : "Not on roster";
  };
  const positionLabel = (positionId: string) =>
    positions.find((p) => p.id === positionId)?.abbreviation ?? "?";

  if (templates === undefined) {
    return <p>Loading templates…</p>;
  }

  const applyDisabled =
    isBusy || !!applyBlockedReason || !mapped || mapped.formationMismatch || mapped.nothingApplicable;

  const loadFailed = !!error && sorted.length === 0;

  return (
    <div className="lineup-templates" ref={panelRef} tabIndex={-1}>
      {error && (
        <div className="lineup-templates__error" role="alert">
          <p>{error}</p>
          {loadFailed && onRetry && (
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {!canManage && manageBlockedReason && (
        <p className="template-preview__note">{manageBlockedReason}</p>
      )}

      {loadFailed ? null : sorted.length === 0 ? (
        <p className="empty-state">No saved templates yet. Save your first one from this Plan tab.</p>
      ) : (
        <ul className="previous-games-list">
          {sorted.map((t) => {
            const isOtherFormation = !!t.formationId && !!teamFormationId && t.formationId !== teamFormationId;
            return (
              <li key={t.id} className="lineup-template-row">
                <button
                  type="button"
                  className={`game-option lineup-template-row__select${selectedId === t.id ? " is-selected" : ""}${isOtherFormation ? " is-other-formation" : ""}`}
                  aria-pressed={selectedId === t.id}
                  disabled={isBusy}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="game-info">
                    <strong>{t.name}</strong>
                    <span>
                      {new Date(t.updatedAt || t.savedAt).toLocaleDateString()}
                      {isOtherFormation ? " · different formation" : ""}
                    </span>
                  </div>
                </button>
                {canManage && (
                  <div className="lineup-template-row__actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Rename ${t.name}`}
                      disabled={isBusy}
                      onClick={() => onRename(t)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn-secondary lineup-template-row__delete"
                      aria-label={`Delete ${t.name}`}
                      disabled={isBusy}
                      onClick={() => {
                        if (selectedId === t.id) setSelectedId(null);
                        onDelete(t);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selected && mapped && (
        <div className="template-preview" aria-live="polite">
          <h3>{selected.name}</h3>
          {mapped.formationMismatch && (
            <p className="template-preview__warning" role="alert">
              This template was saved for a different formation and can&apos;t be applied to this team.
            </p>
          )}
          <p className="template-preview__heading">Starting lineup</p>
          <ul className="template-preview__list">
            {selected.startingLineup.map((e) => (
              <li key={`s-${e.positionId}`}>
                <strong>{positionLabel(e.positionId)}</strong> {playerLabel(e.playerId)}
              </li>
            ))}
          </ul>
          {selected.halftimeLineup && (
            <>
              <p className="template-preview__heading">Second-half lineup</p>
              <ul className="template-preview__list">
                {selected.halftimeLineup.map((e) => (
                  <li key={`h-${e.positionId}`}>
                    <strong>{positionLabel(e.positionId)}</strong> {playerLabel(e.playerId)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!mapped.formationMismatch && mapped.skipped.length > 0 && (
            <p className="template-preview__warning">
              {mapped.skipped.length} slot{mapped.skipped.length === 1 ? "" : "s"} can&apos;t be applied and will be left empty.
            </p>
          )}
          {mapped.nothingApplicable && !mapped.formationMismatch && (
            <p className="template-preview__warning" role="alert">
              None of this template&apos;s starters are on the current roster.
            </p>
          )}
          {applyBlockedReason && (
            <p id={reasonId} className="template-preview__warning">
              {applyBlockedReason}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={applyDisabled}
            aria-describedby={applyBlockedReason ? reasonId : undefined}
            onClick={() => onApply(selected, mapped)}
          >
            {isBusy ? "Applying…" : "Apply template"}
          </button>
        </div>
      )}
    </div>
  );
}

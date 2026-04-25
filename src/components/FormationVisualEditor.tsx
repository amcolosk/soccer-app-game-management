import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { buildLineupShapeNodes } from './GameManagement/shape/lineupShapeDeterminism';
import { clampCoord, validateAndClampCoordinates } from '../utils/validation';
import {
  clearFormationLayoutOverride,
  getFormationLayoutOverride,
  MAX_OVERRIDE_AGE_MS,
  setFormationLayoutOverride,
} from '../utils/formationLayoutOverride';
import { useHelpFab } from '../contexts/HelpFabContext';
import { SoccerPitchSurface } from './shared/SoccerPitchSurface';
import { getFvePitchWidthStyle } from './formationVisualEditorLayout';

const client = generateClient<Schema>();

function clampOverrideCoordinate(value: number): number {
  return Math.min(99, Math.max(1, value));
}

function parseUpdatedAtEpochMs(position: { updatedAt?: unknown }): number | null {
  if (typeof position.updatedAt !== 'string') {
    return null;
  }

  const parsed = Date.parse(position.updatedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormationVisualEditorProps {
  formationId: string;
  formationName: string;
  onClose: () => void;
  onSaved: (positions: DraftPosition[]) => void;
  initialPositions?: DraftPosition[];
}

export type DraftPosition = {
  id: string;
  positionName: string;
  abbreviation: string;
  xPct: number;
  yPct: number;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormationVisualEditor({
  formationId,
  formationName,
  onClose,
  onSaved,
  initialPositions,
}: FormationVisualEditorProps) {
  const { setHelpContext } = useHelpFab();

  // @help-content: formation-visual-editor
  useEffect(() => {
    setHelpContext('formation-visual-editor');
    return () => setHelpContext('manage-formations');
  }, [setHelpContext]);

  // ---- state ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState(false);
  const [serverLayoutVersion, setServerLayoutVersion] = useState(0);
  const [serverPositions, setServerPositions] = useState<DraftPosition[]>([]);
  const [draft, setDraft] = useState<DraftPosition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // Drag state refs (avoid re-renders during pointer move)
  const draggingIdRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Focus trap refs
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const confirmInvokerRef = useRef<HTMLElement | null>(null);

  const focusElement = useCallback((target: HTMLElement | null): boolean => {
    if (!target || !target.isConnected) {
      return false;
    }
    target.focus();
    return true;
  }, []);

  const restoreFocusToOpener = useCallback(() => {
    setTimeout(() => {
      if (focusElement(openerRef.current)) {
        return;
      }
      if (focusElement(document.body)) {
        return;
      }
      closeButtonRef.current?.focus();
    }, 0);
  }, [focusElement]);

  const closeEditor = useCallback(() => {
    onClose();
    restoreFocusToOpener();
  }, [onClose, restoreFocusToOpener]);

  const closeConfirmAndRestoreFocus = useCallback(() => {
    setShowCancelConfirm(false);
    setTimeout(() => {
      if (focusElement(confirmInvokerRef.current)) {
        return;
      }
      if (focusElement(cancelButtonRef.current)) {
        return;
      }
      closeButtonRef.current?.focus();
    }, 0);
  }, [focusElement]);

  // ---- load on mount ----
  useEffect(() => {
    void loadPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationId]);

  // ---- empty state announcement ----
  useEffect(() => {
    if (!loading && draft.length === 0) {
      setAnnouncement('Formation has no positions');
    }
  }, [loading, draft.length]);

  async function loadPositions() {
    setLoading(true);
    setLoadError(null);
    try {
      if (initialPositions && initialPositions.length > 0) {
        // Warm path: parent seeded positions from a previous save — only fetch
        // layoutVersion for conflict detection; skip the eventually-consistent scan.
        const { data: formData } = await client.models.Formation.get({ id: formationId });
        const layoutVer = (formData as { layoutVersion?: number | null } | null)?.layoutVersion ?? 0;
        setServerLayoutVersion(layoutVer);
        setServerPositions(initialPositions);
        setDraft(initialPositions);
      } else {
        // Cold load: fetch formation + positions from DynamoDB.
        const [formResult, posResult] = await Promise.all([
          client.models.Formation.get({ id: formationId }),
          // limit:1000 ensures we scan enough rows for the filter to find all
          // positions in this formation even when the total table is large.
          client.models.FormationPosition.list({
            filter: { formationId: { eq: formationId } },
            limit: 1000,
          }),
        ]);
        const positions = posResult.data ?? [];
        const layoutVer = (formResult.data as { layoutVersion?: number | null } | null)?.layoutVersion ?? 0;

        // Build fallback coords via buildLineupShapeNodes
        const shapeInput = positions.map((position) => {
          const source = position as {
            id: string;
            formationId?: string;
            positionName?: string | null;
            abbreviation?: string | null;
            sortOrder?: number | null;
            coaches?: string[] | null;
            createdAt?: string;
            updatedAt?: string;
          };

          return {
            id: source.id,
            positionName: source.positionName ?? '',
            abbreviation: source.abbreviation ?? '',
            sortOrder: source.sortOrder ?? 0,
            formationId: source.formationId ?? formationId,
            coaches: source.coaches ?? [],
            createdAt: source.createdAt ?? '',
            updatedAt: source.updatedAt ?? '',
          };
        });

        const shapeNodes = buildLineupShapeNodes(shapeInput as Parameters<typeof buildLineupShapeNodes>[0]);

        const merged: DraftPosition[] = positions.map(p => {
          if (p.xPct != null && p.yPct != null) {
            return {
              id: p.id,
              positionName: p.positionName ?? '',
              abbreviation: p.abbreviation ?? '',
              xPct: clampCoord(p.xPct),
              yPct: clampCoord(p.yPct),
            };
          }
          const node = shapeNodes.find(n => n.positionId === p.id);
          return {
            id: p.id,
            positionName: p.positionName ?? '',
            abbreviation: p.abbreviation ?? '',
            xPct: node ? clampCoord(node.xPct) : 50,
            yPct: node ? clampCoord(node.yPct) : 50,
          };
        });

        const override = getFormationLayoutOverride(formationId);
        let resolvedPositions = merged;

        if (override) {
          if (Date.now() - override.savedAt > MAX_OVERRIDE_AGE_MS) {
            clearFormationLayoutOverride(formationId);
          } else {
            const normalizedOverridePositions = override.positions.map(positionOverride => ({
              ...positionOverride,
              xPct: clampOverrideCoordinate(positionOverride.xPct),
              yPct: clampOverrideCoordinate(positionOverride.yPct),
            }));
            const serverMap = new Map(positions.map(position => [position.id, position]));
            const overrideMap = new Map(normalizedOverridePositions.map(position => [position.id, position]));

            const serverMatchesOverride =
              normalizedOverridePositions.every(positionOverride => serverMap.has(positionOverride.id)) &&
              normalizedOverridePositions.every(positionOverride => {
                const serverPosition = serverMap.get(positionOverride.id);
                if (!serverPosition) {
                  return false;
                }

                if (
                  typeof serverPosition.xPct !== 'number' ||
                  !Number.isFinite(serverPosition.xPct) ||
                  typeof serverPosition.yPct !== 'number' ||
                  !Number.isFinite(serverPosition.yPct)
                ) {
                  return false;
                }

                return (
                  clampOverrideCoordinate(serverPosition.xPct) === positionOverride.xPct &&
                  clampOverrideCoordinate(serverPosition.yPct) === positionOverride.yPct
                );
              });

            if (serverMatchesOverride) {
              clearFormationLayoutOverride(formationId);
            } else {
              const serverIsNewerThanOverride =
                normalizedOverridePositions.length > 0 &&
                normalizedOverridePositions.every(positionOverride => {
                  const serverPosition = serverMap.get(positionOverride.id);
                  if (!serverPosition) {
                    return false;
                  }

                  const updatedAtMs = parseUpdatedAtEpochMs(serverPosition);
                  if (updatedAtMs === null) {
                    return false;
                  }

                  return updatedAtMs >= override.savedAt;
                });

              if (serverIsNewerThanOverride) {
                clearFormationLayoutOverride(formationId);
              } else {
                resolvedPositions = merged.map(position => {
                  const positionOverride = overrideMap.get(position.id);
                  if (!positionOverride) {
                    return position;
                  }

                  return {
                    ...position,
                    xPct: positionOverride.xPct,
                    yPct: positionOverride.yPct,
                  };
                });
              }
            }
          }
        }

        setServerLayoutVersion(layoutVer);
        setServerPositions(resolvedPositions);
        setDraft(resolvedPositions);
      }
    } catch {
      setLoadError('Failed to load formation positions. Please close and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ---- focus trap ----
  useEffect(() => {
    if (loading || showCancelConfirm) return;
    const el = modalRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = Array.from(
        el!.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [loading, showCancelConfirm]);

  // ---- nested confirm dialog focus trap ----
  useEffect(() => {
    if (!showCancelConfirm) return;
    const el = confirmDialogRef.current;
    if (!el) return;
    
    // Focus on primary action (Discard) button by default
    const buttons = el.querySelectorAll<HTMLButtonElement>('button');
    buttons[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmAndRestoreFocus();
      } else if (e.key === 'Tab') {
        const focusableElements = Array.from(
          el!.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [closeConfirmAndRestoreFocus, showCancelConfirm]);

  // ---- nudge ----
  function nudge(dx: number, dy: number, targetId: string | null = selectedId) {
    if (!targetId) return;
    setDraft(prev => {
      const next = prev.map(p =>
        p.id === targetId
          ? { ...p, xPct: clampCoord(p.xPct + dx), yPct: clampCoord(p.yPct + dy) }
          : p,
      );
      const updated = next.find(p => p.id === targetId);
      if (updated) {
        setAnnouncement(`${updated.positionName}: ${updated.xPct}% across, ${updated.yPct}% down`);
      }
      return next;
    });
    setIsDirty(true);
  }

  // ---- drag handlers ----
  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingIdRef.current = id;
    setSelectedId(id);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (draggingIdRef.current === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top) / rect.height) * 100;
    const newX = clampCoord(rawX);
    const newY = clampCoord(rawY);
    const id = draggingIdRef.current;
    setDraft(prev => prev.map(p => (p.id === id ? { ...p, xPct: newX, yPct: newY } : p)));
    setIsDirty(true);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    draggingIdRef.current = null;
  }

  // ---- keyboard ----
  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -2],
      ArrowDown: [0, 2],
      ArrowLeft: [-2, 0],
      ArrowRight: [2, 0],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setSelectedId(id);
      nudge(move[0], move[1], id);
    }
  }

  // ---- save ----
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: formation } = await client.models.Formation.get({ id: formationId });
      const currentVersion = (formation as { layoutVersion?: number | null } | null)?.layoutVersion ?? 0;
      if (currentVersion !== serverLayoutVersion) {
        setConflictWarning(true);
        return;
      }
      const clamped = validateAndClampCoordinates(
        draft.map(p => ({ id: p.id, xPct: p.xPct, yPct: p.yPct })),
      );
      await Promise.all(
        clamped.map(p =>
          client.models.FormationPosition.update({ id: p.id, xPct: p.xPct, yPct: p.yPct }),
        ),
      );
      await client.models.Formation.update({
        id: formationId,
        layoutVersion: serverLayoutVersion + 1,
      });
      setServerLayoutVersion(serverLayoutVersion + 1);
      setServerPositions(prev => prev.map(p => {
        const saved = clamped.find(c => c.id === p.id);
        return saved ? { ...p, xPct: saved.xPct, yPct: saved.yPct } : p;
      }));
      setIsDirty(false);
      const savedDraft: DraftPosition[] = draft.map(p => {
        const c = clamped.find(cp => cp.id === p.id);
        return c ? { ...p, xPct: c.xPct, yPct: c.yPct } : p;
      });
      setFormationLayoutOverride(
        formationId,
        savedDraft.map(({ id, xPct, yPct }) => ({ id, xPct, yPct })),
      );
      onSaved(savedDraft);
    } catch {
      setSaveError('Failed to save layout. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ---- reset ----
  function handleReset() {
    setDraft(serverPositions.map(p => ({ ...p })));
    setSelectedId(null);
    setIsDirty(false);
    setSaveError(null);
    setConflictWarning(false);
  }

  // ---- cancel ----
  function handleCancel() {
    if (isDirty) {
      confirmInvokerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : cancelButtonRef.current;
      setShowCancelConfirm(true);
    } else {
      closeEditor();
    }
  }

  // ---- render ----
  return (
    <div
      className="fve-modal"
      data-testid="fve-modal-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget && !showCancelConfirm) {
          handleCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal={showCancelConfirm ? undefined : true}
        aria-hidden={showCancelConfirm}
        aria-labelledby="fve-title"
        ref={modalRef}
        className="fve-modal__dialog"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            handleCancel();
          }
        }}
      >
      {/* Header */}
      <div className="fve-modal__header">
        <h2 id="fve-title" className="fve-modal__title">
          Customize Layout — {formationName}
        </h2>
        <button
          onClick={handleCancel}
          aria-label="Close editor"
          className="fve-modal__close-button"
          ref={closeButtonRef}
          style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
        >
          ✕
        </button>
      </div>

      {/* Canvas container */}
        <div className="fve-modal__content">
          {loading ? (
            <div role="status" aria-label="Loading formation positions" style={{ color: 'var(--text-secondary)' }}>
              Loading…
            </div>
          ) : loadError ? (
            <div role="alert" className="fve-load-error">
              {loadError}
            </div>
          ) : draft.length === 0 ? (
            <>
              <SoccerPitchSurface
                ref={canvasRef}
                className="fve-pitch"
                style={{
                  width: getFvePitchWidthStyle(),
                  height: 'auto',
                  touchAction: 'none',
                  '--soccer-pitch-aspect-ratio': '2 / 3',
                  '--soccer-pitch-border-radius': '4px',
                  '--soccer-pitch-background': 'var(--fve-pitch-background)',
                  '--soccer-pitch-border-color': 'var(--fve-pitch-border-color)',
                  '--soccer-pitch-line-color': 'var(--fve-pitch-line-color)',
                  '--soccer-pitch-spot-color': 'var(--fve-pitch-spot-color)',
                  '--soccer-pitch-penalty-width': '24%',
                  '--soccer-pitch-penalty-height': '6%',
                  '--soccer-pitch-center-circle-width': '20%',
                } as CSSProperties}
              >
                {/* Empty state: no position nodes */}
              </SoccerPitchSurface>
              <div className="fve-empty-state" role="status" aria-live="polite">
                No positions added.
              </div>
            </>
          ) : (
            <SoccerPitchSurface
              ref={canvasRef}
              className="fve-pitch"
              style={{
                /* Defensive sizing for short/tall viewports.
                  Width is derived from available modal height at 2:3,
                  then guarded with max() and clamp(). */
                width: getFvePitchWidthStyle(),
                height: 'auto',
                touchAction: 'none',
                '--soccer-pitch-aspect-ratio': '2 / 3',
                '--soccer-pitch-border-radius': '4px',
                '--soccer-pitch-background': 'var(--fve-pitch-background)',
                '--soccer-pitch-border-color': 'var(--fve-pitch-border-color)',
                '--soccer-pitch-line-color': 'var(--fve-pitch-line-color)',
                '--soccer-pitch-spot-color': 'var(--fve-pitch-spot-color)',
                '--soccer-pitch-penalty-width': '24%',
                '--soccer-pitch-penalty-height': '6%',
                '--soccer-pitch-center-circle-width': '20%',
              } as CSSProperties}
            >

            {/* Position nodes */}
            {draft.map(pos => {
              const isSelected = pos.id === selectedId;
              const isDragging = draggingIdRef.current === pos.id;
              return (
                <button
                  key={pos.id}
                  aria-label={isSelected ? `${pos.positionName}, selected` : pos.positionName}
                  aria-pressed={isSelected}
                  onPointerDown={e => handlePointerDown(e, pos.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onKeyDown={e => handleKeyDown(e, pos.id)}
                  onClick={() => setSelectedId(pos.id)}
                  className={`shared-shape-node fve-node ${isSelected ? 'fve-node--selected' : ''} ${isDragging ? 'fve-node--dragging' : ''}`}
                  style={{
                    left: `${pos.xPct}%`,
                    top: `${pos.yPct}%`,
                  }}
                >
                  <span className="shared-shape-node__position">{pos.abbreviation}</span>
                </button>
              );
            })}
          </SoccerPitchSurface>
          )}
        </div>

      {/* Conflict warning / save error banners */}
        {conflictWarning && (
          <div
            role="alert"
            className="fve-conflict-banner"
          >
            ⚠ Another coach saved this layout while you had the editor open. Reload to get the latest layout before saving.
          </div>
        )}
        {saveError && (
          <div
            role="alert"
            className="fve-error-banner"
          >
            {saveError}
          </div>
        )}

      {/* Nudge strip */}
        <div
          className="fve-nudge-strip"
          style={{
            '--nudge-visibility': selectedId === null ? 'hidden' : 'visible',
          } as CSSProperties}
        >
        <button
          onClick={() => nudge(0, -2)}
          aria-label="Nudge up"
          disabled={!selectedId}
          className="fve-nudge-button"
          style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
        >
          ↑
        </button>
        <button
          onClick={() => nudge(0, 2)}
          aria-label="Nudge down"
          disabled={!selectedId}
          className="fve-nudge-button"
          style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
        >
          ↓
        </button>
        <button
          onClick={() => nudge(-2, 0)}
          aria-label="Nudge left"
          disabled={!selectedId}
          className="fve-nudge-button"
          style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
        >
          ←
        </button>
        <button
          onClick={() => nudge(2, 0)}
          aria-label="Nudge right"
          disabled={!selectedId}
          className="fve-nudge-button"
          style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
        >
          →
        </button>
        </div>

      {/* Button bar */}
        <div className="fve-action-buttons">
        <button
          onClick={() => void handleSave()}
          disabled={saving || loading || conflictWarning || draft.length === 0}
          className="fve-action-button fve-action-button--primary"
          style={{ minWidth: '44px', minHeight: '44px' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving || loading || !isDirty}
          className="fve-action-button fve-action-button--secondary"
          style={{ minWidth: '44px', minHeight: '44px' }}
        >
          Reset
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="fve-action-button fve-action-button--secondary"
          ref={cancelButtonRef}
          style={{ minWidth: '44px', minHeight: '44px' }}
        >
          Cancel
        </button>
        </div>

      {/* aria-live announcement region */}
        <div
          aria-live="polite"
          className="sr-only"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
        >
          {announcement}
        </div>

      </div>

      {/* Unsaved-changes confirm dialog */}
      {showCancelConfirm && (
        <>
          <div
            className="fve-confirm-overlay"
            data-testid="fve-confirm-backdrop"
            onClick={event => {
              if (event.target === event.currentTarget) {
                closeConfirmAndRestoreFocus();
              }
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fve-cancel-title"
            className="fve-confirm-modal"
            ref={confirmDialogRef}
          >
            <h3 id="fve-cancel-title" className="fve-confirm-title">
              Discard unsaved changes?
            </h3>
            <p className="fve-confirm-message">
              Your layout changes have not been saved.
            </p>
            <div className="fve-confirm-buttons">
              <button
                onClick={closeEditor}
                className="fve-confirm-button fve-confirm-button--primary"
                autoFocus
                style={{ minWidth: '44px', minHeight: '44px' }}
              >
                Discard
              </button>
              <button
                onClick={closeConfirmAndRestoreFocus}
                className="fve-confirm-button fve-confirm-button--secondary"
                style={{ minWidth: '44px', minHeight: '44px' }}
              >
                Keep editing
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Token-compliant FormationVisualEditor component.
// All colors use design tokens from App.css; no hardcoded hex/rgb values.

import { useEffect, useRef, useState } from 'react';
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

  // ---- load on mount ----
  useEffect(() => {
    void loadPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationId]);

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
    if (loading) return;
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
  }, [loading]);

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
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  }

  // ---- render ----
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '8px',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fve-title"
        ref={modalRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          width: 'min(480px, calc(100vw - 16px))',
          backgroundColor: 'white',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
        }}
      >

      {/* Header */}
      <div
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <h2 id="fve-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--primary-green)' }}>
          Customize Layout — {formationName}
        </h2>
        <button
          onClick={handleCancel}
          aria-label="Close editor"
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.25rem', cursor: 'pointer', padding: '8px' }}
        >
          ✕
        </button>
      </div>

      {/* Canvas container */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: '8px',
            backgroundColor: 'var(--color-surface-light)',
          }}
        >
          {loading ? (
          <div role="status" aria-label="Loading formation positions" style={{ color: 'var(--text-secondary)' }}>
            Loading…
          </div>
          ) : loadError ? (
            <div role="alert" style={{ color: '#dc2626', textAlign: 'center', padding: '8px' }}>
              {loadError}
            </div>
          ) : (
          <div
            ref={canvasRef}
            style={{
              /* Fix: set width as definite value so aspect-ratio can derive height.
                 width = min(available container width, width-from-max-height).
                 Max height = 90vh minus fixed chrome (56+52+64+16px padding) = 90vh-188px.
                 Width from that height at 2:3 ratio = (90vh-188px)*2/3. */
              width: 'min(100%, calc((90vh - 188px) * 2 / 3))',
              height: 'auto',
              aspectRatio: '2/3',
              position: 'relative',
              touchAction: 'none',
              backgroundColor: '#2d7a2d',
              borderRadius: '4px',
              border: '2px solid rgba(255,255,255,0.3)',
              flexShrink: 0,
            }}
          >
            {/* Pitch markings */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '10%',
                right: '10%',
                top: '50%',
                height: '1px',
                backgroundColor: 'rgba(255,255,255,0.4)',
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: '20%',
                height: '10%',
                transform: 'translate(-50%, -50%)',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '50%',
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: '6px',
                height: '6px',
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.65)',
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                width: '24%',
                height: '6%',
                transform: 'translateX(-50%)',
                border: '2px solid rgba(255,255,255,0.35)',
                borderTop: 'none',
                borderRadius: '0 0 10px 10px',
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 0,
                width: '24%',
                height: '6%',
                transform: 'translateX(-50%)',
                border: '2px solid rgba(255,255,255,0.35)',
                borderBottom: 'none',
                borderRadius: '10px 10px 0 0',
              }}
            />

            {/* Position nodes */}
            {draft.map(pos => {
              const isSelected = pos.id === selectedId;
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
                  style={{
                    position: 'absolute',
                    left: `${pos.xPct}%`,
                    top: `${pos.yPct}%`,
                    transform: 'translate(-50%, -50%)',
                    minWidth: '44px',
                    minHeight: '44px',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: isSelected ? '3px solid #fff' : '2px solid rgba(255,255,255,0.6)',
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.3)' : 'rgba(26,71,42,0.85)',
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'grab',
                    touchAction: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                  }}
                >
                  {pos.abbreviation}
                </button>
              );
            })}
          </div>
          )}
        </div>

      {/* Conflict warning / save error banners */}
        {conflictWarning && (
          <div
            role="alert"
            style={{
              padding: '8px 16px',
              backgroundColor: '#fffbeb',
              borderTop: '1px solid #fcd34d',
              color: '#92400e',
              fontSize: '0.85rem',
              flexShrink: 0,
            }}
          >
            ⚠ Another coach saved this layout while you had the editor open. Reload to get the latest layout before saving.
          </div>
        )}
        {saveError && (
          <div
            role="alert"
            style={{
              padding: '8px 16px',
              backgroundColor: '#fef2f2',
              borderTop: '1px solid #fca5a5',
              color: '#dc2626',
              fontSize: '0.85rem',
              flexShrink: 0,
            }}
          >
            {saveError}
          </div>
        )}

      {/* Nudge strip */}
        <div
          style={{
            height: '52px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flexShrink: 0,
            visibility: selectedId === null ? 'hidden' : 'visible',
            borderTop: '1px solid var(--border-color)',
          }}
        >
        <button
          onClick={() => nudge(0, -2)}
          aria-label="Nudge up"
          disabled={!selectedId}
          style={nudgeBtnStyle}
        >
          ↑
        </button>
        <button
          onClick={() => nudge(0, 2)}
          aria-label="Nudge down"
          disabled={!selectedId}
          style={nudgeBtnStyle}
        >
          ↓
        </button>
        <button
          onClick={() => nudge(-2, 0)}
          aria-label="Nudge left"
          disabled={!selectedId}
          style={nudgeBtnStyle}
        >
          ←
        </button>
        <button
          onClick={() => nudge(2, 0)}
          aria-label="Nudge right"
          disabled={!selectedId}
          style={nudgeBtnStyle}
        >
          →
        </button>
        </div>

      {/* Button bar */}
        <div
          style={{
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 16px',
            flexShrink: 0,
            borderTop: '1px solid var(--border-color)',
          }}
        >
        <button
          onClick={() => void handleSave()}
          disabled={saving || loading || conflictWarning}
          className="btn-primary"
          style={{ flex: 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving || loading || !isDirty}
          className="btn-secondary"
          style={{ flex: 1 }}
        >
          Reset
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="btn-secondary"
          style={{ flex: 1 }}
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

      {/* Unsaved-changes confirm dialog */}
        {showCancelConfirm && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fve-cancel-title"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              gap: '16px',
              zIndex: 10,
            }}
          >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '360px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
          <h3 id="fve-cancel-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Discard unsaved changes?
          </h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Your layout changes have not been saved.
          </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={onClose}
                className="btn-delete"
                style={{ flex: 1 }}
              >
                Discard
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="btn-secondary"
                style={{ flex: 1 }}
              >
                Keep editing
              </button>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

const nudgeBtnStyle: CSSProperties = {
  minWidth: '44px',
  minHeight: '44px',
  width: '44px',
  height: '44px',
  background: 'none',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '1.1rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

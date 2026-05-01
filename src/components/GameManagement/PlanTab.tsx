import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { PlayerAvailabilityGrid } from "../PlayerAvailabilityGrid";
import { LineupPanel } from "./LineupPanel";
import { useGamePlanner } from "./hooks/useGamePlanner";
import { generateCanonicalKey, getHalftimeSentinelKey } from "../../utils/plannerKeyUtils";
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  GamePlan,
  PlannedRotation,
} from "./types";
import type { PlannedSubstitution } from "../../types/schema";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";

interface PlanConflict {
  playerId: string;
  playerName: string;
  status: string;
  type: 'starter' | 'rotation' | 'on-field';
  rotationNumbers: number[];
}

interface PlanTabProps {
  /** When true, hides availability grid and mutation controls (for in-progress/halftime viewing). */
  readOnly: boolean;
  gamePlan: GamePlan | null;
  plannedRotations?: PlannedRotation[];
  planConflicts: PlanConflict[];
  isRecalculating: boolean;
  onRecalculateRotations: () => void;
  // Forwarded to LineupPanel and PlayerAvailabilityGrid
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  onSubstitute: (position: FormationPosition) => void;
  mutations: GameMutationInput;
  currentUserId?: string;
  viewMode?: "list" | "shape";
  onViewModeChange?: (mode: "list" | "shape") => void;
  onResetViewPreference?: () => void;
  /** Called when half length changes; GameManagement persists to Game record. Scheduled only. */
  onHalfLengthChange?: (minutes: number) => Promise<void>;
  /** Called when rotation interval changes; optional parent notification. */
  onIntervalChange?: (minutes: number) => Promise<void>;
  /** External halftime lineup override (Map<positionId, playerId>). Falls back to planner draft. */
  halftimeLineup?: Map<string, string>;
  /** External handler for halftime lineup changes. Falls back to planner.updateHalftimeLineup. */
  onHalftimeLineupChange?: (lineup: Map<string, string>) => Promise<void>;
  /** Calls calculateFairRotations and persists PlannedRotations. Status-gated in parent. Scheduled only. */
  onGenerateRotations?: () => void | Promise<void>;
}

export function PlanTab({
  readOnly,
  gamePlan,
  plannedRotations = [],
  planConflicts,
  isRecalculating,
  onRecalculateRotations,
  gameState,
  game,
  team,
  players,
  positions,
  lineup,
  playTimeRecords,
  currentTime,
  onSubstitute,
  mutations,
  currentUserId,
  viewMode,
  onViewModeChange,
  onResetViewPreference,
  onHalfLengthChange,
  onIntervalChange,
  halftimeLineup: externalHalftimeLineup,
  onHalftimeLineupChange: externalOnHalftimeLineupChange,
  onGenerateRotations,
}: PlanTabProps) {
  const lineupPlayerIds = lineup.filter(l => l.isStarter).map(l => l.playerId);
  const isScheduled = game.status === "scheduled";

  // Use planner hook for scheduled state
  const startingLineupAssignments = useMemo(
    () => lineup.filter(l => l.isStarter),
    [lineup]
  );

  const planner = useGamePlanner(game, team, gamePlan, plannedRotations, startingLineupAssignments);

  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const selectedPillRef = useRef<HTMLButtonElement>(null);

  // Local half-length state (editable; persists to Game record via onHalfLengthChange)
  const derivedHalfLength = (gameState.halfLengthMinutes ?? team.halfLengthMinutes) || 30;
  const [halfLengthInput, setHalfLengthInput] = useState<number>(derivedHalfLength);
  const halfLengthEditingRef = useRef(false);

  // Sync external half-length changes (e.g. from subscription) while user is not editing
  useEffect(() => {
    if (!halfLengthEditingRef.current) {
      setHalfLengthInput(derivedHalfLength);
    }
  }, [derivedHalfLength]);

  // Build timeline keys from planned rotations
  const timelineKeys = useMemo(() => {
    const rotsByCanonicalized = new Map<string, PlannedRotation>();
    
    for (const rot of plannedRotations) {
      try {
        const key = generateCanonicalKey(rot.half, rot.gameMinute, false);
        if (!rotsByCanonicalized.has(key)) {
          rotsByCanonicalized.set(key, rot);
        }
      } catch (e) {
        console.warn("[PlanTab] Failed to generate key:", e);
      }
    }
    
    // Add halftime sentinel if we have starting lineup
    if (planner.draft.startingLineup.size > 0) {
      rotsByCanonicalized.set(getHalftimeSentinelKey(), null as unknown as PlannedRotation);
    }
    
    return Array.from(rotsByCanonicalized.keys()).sort();
  }, [plannedRotations, planner.draft.startingLineup]);

  // Determine selected rotation or halftime
  const selectedKey = planner.draft.selectedTimelineKey || timelineKeys[0] || null;
  
  const selectedRotation = useMemo(() => {
    if (!selectedKey) return null;
    if (selectedKey === getHalftimeSentinelKey()) {
      return planner.computeHalftimeRotation();
    }
    return plannedRotations.find(rot => {
      try {
        const key = generateCanonicalKey(rot.half, rot.gameMinute, false);
        return key === selectedKey;
      } catch {
        return false;
      }
    }) || null;
  }, [selectedKey, plannedRotations, planner]);

  // Keyboard navigation for timeline pills
  const handleTimelineKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedKey || timelineKeys.length === 0) return;

    const currentIndex = timelineKeys.indexOf(selectedKey);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % timelineKeys.length;
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + timelineKeys.length) % timelineKeys.length;
      e.preventDefault();
    } else if (e.key === "Home") {
      nextIndex = 0;
      e.preventDefault();
    } else if (e.key === "End") {
      nextIndex = timelineKeys.length - 1;
      e.preventDefault();
    }

    if (nextIndex !== currentIndex) {
      planner.selectTimelineKey(timelineKeys[nextIndex]);
      // Focus after state update
      setTimeout(() => {
        const pill = timelineContainerRef.current?.querySelector(`[data-timeline-key="${timelineKeys[nextIndex]}"]`) as HTMLButtonElement;
        if (pill) {
          pill.focus({ preventScroll: true });
          pill.scrollIntoView({ inline: "nearest", block: "nearest" });
        }
      }, 0);
    }
  }, [selectedKey, timelineKeys, planner]);

  const handleSavePlan = useCallback(async () => {
    if (!isScheduled || readOnly) return;
    setIsSavingPlan(true);
    try {
      const hasPendingHalfLengthSave = halfLengthInput !== derivedHalfLength;
      if (hasPendingHalfLengthSave) {
        halfLengthEditingRef.current = false;
        const clamped = Math.max(1, Math.min(99, halfLengthInput));
        setHalfLengthInput(clamped);
        if (onHalfLengthChange) {
          await onHalfLengthChange(clamped);
        }
      }
      if (planner.isDirty) {
        await planner.savePlan();
      }
    } finally {
      setIsSavingPlan(false);
    }
  }, [isScheduled, readOnly, planner, halfLengthInput, derivedHalfLength, onHalfLengthChange]);

  const handleRotationIntervalChange = useCallback(
    async (minutes: number) => {
      if (!isScheduled || readOnly) return;
      const clamped = Math.max(1, Math.min(99, minutes));
      await planner.updateRotationInterval(clamped);
      if (onIntervalChange) {
        await onIntervalChange(clamped);
      }
    },
    [isScheduled, planner, onIntervalChange, readOnly]
  );

  const handleHalftimeLineupChange = useCallback(
    async (newLineup: Map<string, string>) => {
      if (!isScheduled || readOnly) return;
      if (externalOnHalftimeLineupChange) {
        await externalOnHalftimeLineupChange(newLineup);
      } else {
        await planner.updateHalftimeLineup(newLineup);
      }
    },
    [isScheduled, planner, externalOnHalftimeLineupChange, readOnly]
  );

  const saveHalfLength = useCallback(
    async (value: number) => {
      if (game.status !== 'scheduled') return;
      const clamped = Math.max(1, Math.min(99, value));
      setHalfLengthInput(clamped);
      if (onHalfLengthChange) {
        await onHalfLengthChange(clamped);
      }
    },
    [game.status, onHalfLengthChange]
  );

  const handleResetHalfLengthToDefault = useCallback(async () => {
    await saveHalfLength(team.halfLengthMinutes ?? 30);
  }, [saveHalfLength, team.halfLengthMinutes]);

  const halfLengthMinutes = halfLengthInput;
  const hasPendingHalfLengthSave = isScheduled && !readOnly && halfLengthInput !== derivedHalfLength;
  const rotationsPerHalf =
    halfLengthMinutes > 0 && planner.draft.rotationIntervalMinutes > 0
      ? Math.max(
          0,
          Math.floor(halfLengthMinutes / planner.draft.rotationIntervalMinutes) - 1
        )
      : 0;

  // Effective halftime lineup: prefer external prop if provided, else planner draft
  const effectiveHalftimeLineup = externalHalftimeLineup ?? planner.draft.halftimeLineup;

  const hasNoPlans = !gamePlan && timelineKeys.length === 0;
  const isHalftimeSelected = selectedKey === getHalftimeSentinelKey();

  return (
    <div className={`plan-tab${readOnly ? ' plan-tab--readonly' : ''}`}>
      {readOnly && (
        <div className="plan-tab__readonly-banner">
          📋 Plan view — read-only during live play
        </div>
      )}

      {isScheduled && !readOnly && (
        <div className="planner-setup-card">
          <h3 className="planner-setup-label">Rotation Settings</h3>
          <div className="rotation-stepper">
            <label htmlFor="half-length-input" className="planner-setup-label">
              Half length (minutes)
            </label>
            <div className="rotation-stepper-controls">
              <button
                type="button"
                className="rotation-stepper-btn"
                aria-label="Decrease half length"
                onClick={() => void saveHalfLength(halfLengthInput - 1)}
                disabled={halfLengthInput <= 1}
              >
                −
              </button>
              <input
                id="half-length-input"
                type="number"
                min="1"
                max="99"
                inputMode="numeric"
                value={halfLengthInput}
                className="rotation-stepper-input"
                onChange={(e) => {
                  halfLengthEditingRef.current = true;
                  const val = parseInt(e.currentTarget.value, 10);
                  if (!isNaN(val)) setHalfLengthInput(val);
                }}
                onBlur={() => {
                  halfLengthEditingRef.current = false;
                  void saveHalfLength(halfLengthInput);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    halfLengthEditingRef.current = false;
                    void saveHalfLength(halfLengthInput);
                    e.currentTarget.blur();
                  }
                }}
                onFocus={() => { halfLengthEditingRef.current = true; }}
              />
              <button
                type="button"
                className="rotation-stepper-btn"
                aria-label="Increase half length"
                onClick={() => void saveHalfLength(halfLengthInput + 1)}
                disabled={halfLengthInput >= 99}
              >
                +
              </button>
            </div>
            {halfLengthInput !== (team.halfLengthMinutes ?? 30) && (
              <button
                type="button"
                className="half-length-reset-btn"
                onClick={handleResetHalfLengthToDefault}
              >
                Reset to team default ({team.halfLengthMinutes ?? 30} min)
              </button>
            )}
          </div>

          <div className="rotation-stepper-row">
            <div className="rotation-stepper">
              <label className="planner-setup-label">Rotations / half</label>
              <div className="rotation-stepper-controls" aria-live="polite">
                <span className="rotation-derived-value">
                  {rotationsPerHalf}
                </span>
              </div>
            </div>

            <div className="rotation-stepper">
              <label htmlFor="rotation-interval-input" className="planner-setup-label">
                Every (min)
              </label>
              <div className="rotation-stepper-controls">
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Decrease rotation interval"
                  onClick={() => void handleRotationIntervalChange(planner.draft.rotationIntervalMinutes - 1)}
                  disabled={planner.draft.rotationIntervalMinutes <= 1}
                >
                  −
                </button>
                <input
                  id="rotation-interval-input"
                  type="number"
                  min="1"
                  max="99"
                  inputMode="numeric"
                  value={planner.draft.rotationIntervalMinutes}
                  className="rotation-stepper-input"
                  onChange={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) {
                      void handleRotationIntervalChange(val);
                    }
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) void handleRotationIntervalChange(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(e.currentTarget.value, 10);
                      if (!isNaN(val)) void handleRotationIntervalChange(val);
                      e.currentTarget.blur();
                    }
                  }}
                />
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Increase rotation interval"
                  onClick={() => void handleRotationIntervalChange(planner.draft.rotationIntervalMinutes + 1)}
                  disabled={planner.draft.rotationIntervalMinutes >= 99}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleSavePlan}
            disabled={isSavingPlan || (!planner.isDirty && !hasPendingHalfLengthSave)}
            className="btn-primary plan-tab__save-btn"
          >
            {isSavingPlan ? "Saving..." : "Save Settings"}
          </button>

          {onGenerateRotations && (
            <button
              onClick={() => void onGenerateRotations()}
              disabled={isRecalculating}
              className="btn-secondary plan-tab__generate-btn"
            >
              {isRecalculating ? "Generating..." : "Generate Rotations"}
            </button>
          )}

          {hasNoPlans && (
            <p className="plan-tab__empty-state">
              No plan yet. Set rotation settings and lineup to create your plan.
            </p>
          )}

          {!hasNoPlans && timelineKeys.length === 0 && (
            <p className="plan-tab__empty-state">
              No rotations generated yet. Use Auto-Generate to create a timeline.
            </p>
          )}
        </div>
      )}

      {gamePlan && planConflicts.length > 0 && (
        <div className="plan-conflict-banner">
          <h4>⚠️ Plan Conflicts</h4>
          <p>The following players are in the game plan but currently unavailable:</p>
          <ul>
            {planConflicts.map(c => (
              <li key={c.playerId}>
                <strong>{c.playerName}</strong> — {c.status}
                {c.type === 'starter' && ' (starting lineup)'}
                {c.rotationNumbers.length > 0 && ` · Rotation${c.rotationNumbers.length > 1 ? 's' : ''} ${c.rotationNumbers.join(', ')}`}
              </li>
            ))}
          </ul>
          <p className="conflict-hint">Update availability or adjust the game plan before starting.</p>
          {!readOnly && (
            <button
              onClick={onRecalculateRotations}
              disabled={isRecalculating}
              className="btn-secondary"
              style={{ marginTop: '8px' }}
            >
              {isRecalculating ? '⏳ Recalculating...' : '🔄 Recalculate Rotations'}
            </button>
          )}
        </div>
      )}

      {/* Timeline Pills */}
      {timelineKeys.length > 0 && (
        <div className="plan-tab__timeline-section">
          <h4>Plan Timeline</h4>
          <div
            ref={timelineContainerRef}
            className="planner-timeline-strip"
            role="tablist"
            aria-label="Plan timeline"
            onKeyDown={handleTimelineKeyDown}
          >
            {timelineKeys.map((key) => {
              const isHalftime = key === getHalftimeSentinelKey();
              const isPillSelected = key === selectedKey;
              const pillarId = `plan-timeline-tab-${key}`;

              return (
                <button
                  key={key}
                  ref={isPillSelected ? selectedPillRef : null}
                  data-timeline-key={key}
                  id={pillarId}
                  role="tab"
                  aria-selected={isPillSelected}
                  aria-controls={`plan-timeline-panel-${key}`}
                  tabIndex={isPillSelected ? 0 : -1}
                  className={`planner-timeline-pill ${isPillSelected ? 'planner-timeline-pill--active' : ''} ${isHalftime ? 'planner-timeline-pill--halftime' : ''}`}
                  onClick={() => planner.selectTimelineKey(key)}
                >
                  {isHalftime ? 'HT' : `R${plannedRotations.find(r => {
                    try {
                      return generateCanonicalKey(r.half, r.gameMinute, false) === key;
                    } catch {
                      return false;
                    }
                  })?.rotationNumber ?? '?'}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline Details Panel */}
      {selectedKey && selectedRotation && (
        <div
          id={`plan-timeline-panel-${selectedKey}`}
          role="tabpanel"
          aria-labelledby={`plan-timeline-tab-${selectedKey}`}
          className="plan-tab__timeline-panel"
        >
          {isHalftimeSelected ? (
            <div className="plan-tab__halftime-editor">
              <h4>Halftime Lineup</h4>
              <HalftimeLineupEditor
                positions={positions}
                players={players}
                startingLineup={planner.draft.startingLineup}
                halftimeLineup={effectiveHalftimeLineup}
                onChangeHalftime={handleHalftimeLineupChange}
                readOnly={readOnly}
              />
            </div>
          ) : (
            <div className="plan-tab__rotation-details">
              <h4>Rotation {selectedRotation.rotationNumber ?? '?'}</h4>
              <p>Half: {selectedRotation.half}, Minute: {selectedRotation.gameMinute}</p>
              {selectedRotation.plannedSubstitutions ? (
                <RotationSubstitutionsList
                  substitutions={selectedRotation.plannedSubstitutions as string}
                  players={players}
                  positions={positions}
                />
              ) : (
                <p className="plan-tab__empty-state">No players assigned for this step.</p>
              )}
            </div>
          )}
        </div>
      )}

      {players.length > 0 && !readOnly && (
        <PlayerAvailabilityGrid
          players={players}
          gameId={game.id}
          coaches={team.coaches || []}
          lineupPlayerIds={lineupPlayerIds}
        />
      )}

      <LineupPanel
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        positions={positions}
        lineup={lineup}
        playTimeRecords={playTimeRecords}
        currentTime={currentTime}
        onSubstitute={onSubstitute}
        mutations={mutations}
        currentUserId={currentUserId}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onResetViewPreference={onResetViewPreference}
        hideAvailablePlayers={readOnly}
        isReadOnly={readOnly}
      />

    </div>
  );
}

/**
 * Halftime Lineup Editor Component
 */
interface HalftimeLineupEditorProps {
  positions: FormationPosition[];
  players: PlayerWithRoster[];
  startingLineup: Map<string, string>;
  halftimeLineup: Map<string, string>;
  onChangeHalftime: (lineup: Map<string, string>) => Promise<void>;
  readOnly: boolean;
}

function HalftimeLineupEditor({
  positions,
  players,
  startingLineup,
  halftimeLineup,
  onChangeHalftime,
  readOnly,
}: HalftimeLineupEditorProps) {
  const playerMap = useMemo(
    () => new Map(players.map(p => [p.id, p])),
    [players]
  );

  return (
    <div className="halftime-editor">
      {positions.map(pos => {
        const startingPlayerId = startingLineup.get(pos.id);
        const halftimePlayerId = halftimeLineup.get(pos.id);
        const startingPlayer = startingPlayerId ? playerMap.get(startingPlayerId) : null;
        const halftimePlayer = halftimePlayerId ? playerMap.get(halftimePlayerId) : null;

        return (
          <div key={pos.id} className="halftime-editor__position">
            <label htmlFor={`${pos.id}-ht-select`}>{pos.abbreviation || pos.positionName || 'Position'}</label>
            <div className="halftime-editor__players">
              <div className="halftime-editor__starting">
                <strong>Starting:</strong>{' '}
                {startingPlayer
                  ? `${startingPlayer.firstName ?? ''} ${startingPlayer.lastName ?? ''}`.trim() || 'Unassigned'
                  : 'Unassigned'}
              </div>
              {!readOnly && (
                <select
                  id={`${pos.id}-ht-select`}
                  value={halftimePlayerId || ''}
                  onChange={async (e) => {
                    const newLineup = new Map(halftimeLineup);
                    const playerId = e.target.value;
                    if (playerId) {
                      newLineup.set(pos.id, playerId);
                    } else {
                      newLineup.delete(pos.id);
                    }
                    await onChangeHalftime(newLineup);
                  }}
                  className="halftime-editor__select"
                  disabled={readOnly}
                >
                  <option value="">Keep starting player</option>
                  {players.map(p => (
                    <option key={p.id} value={p.id}>
                      {`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.id}
                    </option>
                  ))}
                </select>
              )}
              {readOnly && (
                <div className="halftime-editor__readonly">
                  Halftime:{' '}
                  {halftimePlayer
                    ? `${halftimePlayer.firstName ?? ''} ${halftimePlayer.lastName ?? ''}`.trim()
                    : startingPlayer
                    ? `${startingPlayer.firstName ?? ''} ${startingPlayer.lastName ?? ''}`.trim()
                    : 'Unassigned'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rotation Substitutions List Component
 */
interface RotationSubstitutionsListProps {
  substitutions: string; // JSON stringified PlannedSubstitution[]
  players: PlayerWithRoster[];
  positions: FormationPosition[];
}

function RotationSubstitutionsList({
  substitutions,
  players,
  positions,
}: RotationSubstitutionsListProps) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(substitutions);
    } catch {
      return [];
    }
  }, [substitutions]);

  const playerMap = useMemo(
    () => new Map(players.map(p => [p.id, p])),
    [players]
  );
  const positionMap = useMemo(
    () => new Map(positions.map(p => [p.id, p])),
    [positions]
  );

  if (parsed.length === 0) {
    return <p className="plan-tab__empty-state">No substitutions scheduled.</p>;
  }

  return (
    <div className="rotation-subs-list">
      {parsed.map((sub: PlannedSubstitution, idx: number) => {
        const playerOut = playerMap.get(sub.playerOutId);
        const playerIn = playerMap.get(sub.playerInId);
        const position = positionMap.get(sub.positionId);
        const playerOutName = playerOut
          ? `${playerOut.firstName ?? ''} ${playerOut.lastName ?? ''}`.trim() || 'Unknown'
          : 'Unknown';
        const playerInName = playerIn
          ? `${playerIn.firstName ?? ''} ${playerIn.lastName ?? ''}`.trim() || 'Unknown'
          : 'Unknown';
        const posLabel = position?.abbreviation || position?.positionName || 'Pos';
        return (
          <div key={idx} className="rotation-subs-list__item">
            <span className="rotation-subs-list__out">{playerOutName} out</span>
            <span className="rotation-subs-list__arrow">→</span>
            <span className="rotation-subs-list__in">{playerInName} in</span>
            <span className="rotation-subs-list__position">({posLabel})</span>
          </div>
        );
      })}
    </div>
  );
}

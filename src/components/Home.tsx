import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSwipeDelete } from '../hooks/useSwipeDelete';
import { deleteGameCascade } from '../services/cascadeDeleteService';
import { useConfirm } from './ConfirmModal';
import { isoToDatetimeLocal } from '../utils/gameTimeUtils';
import { useNavigate } from 'react-router-dom';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { getCurrentUser } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { Game } from '../types/schema';
import { showError, showWarning, showSuccess } from '../utils/toast';
import { syncTeamCalendar } from '../services/calendarSyncService';
import type { CalendarSyncResult } from '../types/schema';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { handleApiError } from '../utils/errorHandler';
import { useAmplifyQuery } from '../hooks/useAmplifyQuery';
import { isTeamActive } from '../utils/teamUtils';
import { useHelpFab } from '../contexts/HelpFabContext';
import { buildFlatDebugSnapshot } from '../utils/debugUtils';
import type { HomeDebugContext } from '../types/debug';
import { useOnboarding } from '../contexts/OnboardingContext';
import { removeDemoData } from '../services/demoDataService';
import { createGame } from '../services/gameService';
import { WelcomeModal } from './Onboarding/WelcomeModal';
import { QuickStartChecklist } from './Onboarding/QuickStartChecklist';

const client = generateClient<Schema>();

// Module-scope comparator (lifted out of the inline `useAmplifyQuery` call so
// it can be reapplied after merging in a pending, not-yet-synced addition —
// see gamesForDisplay). Body unchanged from the original inline `sort` option.
function compareGamesForHomeDisplay(a: Game, b: Game): number {
  const statusA = a.status || 'scheduled';
  const statusB = b.status || 'scheduled';

  const getPriority = (status: string) => {
    if (status === 'in-progress' || status === 'halftime') return 1;
    if (status === 'scheduled') return 2;
    return 3; // completed
  };

  const priorityA = getPriority(statusA);
  const priorityB = getPriority(statusB);

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  // Within same priority, sort by date
  const dateA = a.gameDate ? new Date(a.gameDate).getTime() : 0;
  const dateB = b.gameDate ? new Date(b.gameDate).getTime() : 0;

  if (statusA === 'completed') {
    // Completed: most recent first
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  }

  // In-progress/scheduled: upcoming first
  return dateA - dateB;
}

export function Home() {
  const navigate = useNavigate();
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  const { setHelpContext, setDebugContext } = useHelpFab();
  const { welcomed, dismissed, collapsed, markWelcomed, expand, dismiss, clearDismissed } = useOnboarding();

  // Register 'home' help context while this screen is mounted
  useEffect(() => {
    setHelpContext('home');
    return () => setHelpContext(null);
  }, [setHelpContext]);

  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [selectedTeamForGame, setSelectedTeamForGame] = useState('');
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editOpponent, setEditOpponent] = useState('');
  const [editGameDate, setEditGameDate] = useState('');
  const [editIsHome, setEditIsHome] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);
  const [isProfileCompletionResolved, setIsProfileCompletionResolved] = useState(false);
  const [pendingCreatedGames, setPendingCreatedGames] = useState<Game[]>([]);
  const [gameRefreshKey, setGameRefreshKey] = useState(0);
  const [isSubmittingGame, setIsSubmittingGame] = useState(false);

  // Calendar Feed Import (Phase 2: file-upload path). See "Sync interaction
  // flow" in docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md — one CTA slot,
  // dryRun preview modal, loading/error states.
  const [isImportingCalendar, setIsImportingCalendar] = useState(false);
  const [importTeamId, setImportTeamId] = useState('');
  const [isCheckingImport, setIsCheckingImport] = useState(false);
  const [importPreview, setImportPreview] = useState<CalendarSyncResult | null>(null);
  const [importPreviewArgs, setImportPreviewArgs] = useState<{ teamId: string; icsContent?: string } | null>(null);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  // Once a feed is saved for a team, that team's slot in the panel offers
  // "Sync now" (re-sync the saved feed) instead of a file picker, with a
  // small fallback toggle back to file upload (Phase 3+ CTA rule).
  const [showFileFallback, setShowFileFallback] = useState(false);

  const scheduleGameButtonRef = useRef<HTMLButtonElement>(null);
  const { getSwipeProps, getSwipeStyle, close: closeSwipe } = useSwipeDelete({ openWidthPx: 160, maxDistancePx: 180 });
  const confirm = useConfirm();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      getCurrentUser().then(u => setCurrentUserId(u.userId)).catch(() => {});
    } else {
      setCurrentUserId(undefined);
    }
  }, [authStatus]);

  // Subscribe to teams, roster, and gamePlans for onboarding progress
  const { data: teams, isSynced: isTeamsSynced } = useAmplifyQuery('Team');
  const activeTeams = useMemo(() => teams.filter(isTeamActive), [teams]);
  // `gameRefreshKey` as a dep forces useAmplifyQuery to unsubscribe and
  // re-subscribe with a fresh observeQuery — the same mechanism
  // Management.tsx's `teamRefreshKey` already relies on. Bumped in three
  // places: after handleCreateGame settles (below), after a successful
  // delete/edit of a pending game (defensive — see below), and on window
  // focus / tab-visibility (see the effect after this block — mitigation for
  // the cross-coach real-time lag documented in
  // docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md, Decision 0).
  const { data: games, isSynced: isGamesSynced } = useAmplifyQuery('Game', {
    sort: compareGamesForHomeDisplay,
  }, [gameRefreshKey]);

  // createGame writes via the DynamoDB SDK directly inside its Lambda handler —
  // like archiveTeam/restoreTeam/assignTeamOwner (Step 1) and unlike a plain
  // client.models.Game.create() call, it never triggers an onCreateGame AppSync
  // subscription event (see Decision 0 of the plan above — this was evaluated
  // and deliberately not changed). `games` (from useAmplifyQuery/observeQuery)
  // can lag a just-created game until the next re-subscription.
  // `pendingCreatedGames` layers the Lambda's own returned Game on top of
  // `games` until the raw list independently picks it up, at which point the
  // addition is dropped and `games` alone becomes authoritative for that id
  // again. See docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md,
  // Decision 3.
  const gamesForDisplay = useMemo(() => {
    const additions = pendingCreatedGames.filter(
      (pending) => !games.some((g) => g.id === pending.id)
    );
    if (additions.length === 0) return games;
    return [...games, ...additions].sort(compareGamesForHomeDisplay);
  }, [games, pendingCreatedGames]);

  // Reconciler: once the raw `games` list independently contains a pending
  // addition's id, drop it from the override set — self-heals with no further
  // action once the eventually-consistent list catches up.
  useEffect(() => {
    setPendingCreatedGames((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((pending) => !games.some((g) => g.id === pending.id));
      return next.length === prev.length ? prev : next;
    });
  }, [games]);

  // Re-list on window focus / tab visibility. Concrete mitigation for the
  // cross-coach real-time propagation lag accepted in Decision 0 — a coach
  // who leaves Home.tsx mounted in a background tab and later refocuses it
  // (or switches back from another app) gets a fresh observeQuery scan
  // without needing a full remount. It does NOT make the lag disappear (a
  // coach who stays focused on Home.tsx the whole time still won't see
  // another coach's newly created game until they navigate away and back or
  // refocus). `wasHiddenRef` collapses the visibilitychange-to-visible and
  // the subsequent focus event into a single bump, since both fire together
  // when a backgrounded tab regains focus.
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    const bump = () => setGameRefreshKey((k) => k + 1);
    const markAway = () => {
      wasHiddenRef.current = true;
    };
    const markReturnedIfAway = () => {
      if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        bump();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markReturnedIfAway();
      } else {
        markAway();
      }
    };
    // Tab switch away/back fires both `visibilitychange` and `focus`; window
    // blur/refocus without a tab switch fires only `focus`/`blur`. Gating
    // `focus` (and `visibilitychange`-to-visible) behind `wasHiddenRef` means
    // whichever of the two "away" signals (`blur` or tab-hidden) fires first
    // arms exactly one bump, and whichever "back" signal fires first consumes
    // it — so a single tab-return never double-bumps `gameRefreshKey`.
    window.addEventListener('focus', markReturnedIfAway);
    window.addEventListener('blur', markAway);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', markReturnedIfAway);
      window.removeEventListener('blur', markAway);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Auto-welcome users who already had teams before the onboarding feature launched.
  // Once teams have fully synced and the user has at least one team, skip the WelcomeModal.
  // This prevents existing coaches from accidentally loading unwanted demo data.
  useEffect(() => {
    if (!welcomed && isTeamsSynced && teams.length > 0) {
      markWelcomed();
    }
  }, [welcomed, isTeamsSynced, teams.length, markWelcomed]);

  const { data: teamRosters, isSynced: isTeamRostersSynced } = useAmplifyQuery('TeamRoster');
  const { data: gamePlans, isSynced: isGamePlansSynced } = useAmplifyQuery('GamePlan');

  const isChecklistSourceDataReady =
    isTeamsSynced && isGamesSynced && isTeamRostersSynced && isGamePlansSynced;

  const canEvaluateDismissedReopen =
    dismissed && isProfileCompletionResolved && isChecklistSourceDataReady;

  const checklistStepCompletion = useMemo(
    () => [
      activeTeams.length >= 1,
      profileComplete,
      (teamRosters as { teamId: string }[]).some((r) =>
        (activeTeams as { id: string }[]).some((t) => t.id === r.teamId)
      ),
      (activeTeams as { id: string; formationId?: string | null }[]).some(
        (t) => t.formationId != null && t.formationId !== ''
      ),
      gamesForDisplay.length >= 1,
      gamePlans.length >= 1,
      (gamesForDisplay as { status?: string }[]).some(
        (g) => g.status === 'in-progress' || g.status === 'completed'
      ),
    ],
    [activeTeams, profileComplete, teamRosters, gamesForDisplay, gamePlans]
  );

  const readDismissedStepSnapshot = useCallback((): boolean[] | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const raw = localStorage.getItem('onboarding:lastCompletedSteps');
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== checklistStepCompletion.length) {
        return null;
      }
      if (!parsed.every((value) => typeof value === 'boolean')) {
        return null;
      }
      return parsed as boolean[];
    } catch {
      return null;
    }
  }, [checklistStepCompletion.length]);

  const handleChecklistDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify(checklistStepCompletion));
    }
    dismiss();
  }, [checklistStepCompletion, dismiss]);

  useEffect(() => {
    if (!canEvaluateDismissedReopen) {
      return;
    }

    const previousSteps = readDismissedStepSnapshot();
    if (!previousSteps) {
      return;
    }

    const hasRegression = previousSteps.some(
      (wasComplete, index) => wasComplete && !checklistStepCompletion[index]
    );

    if (hasRegression) {
      clearDismissed();
      if (typeof window !== 'undefined') {
        localStorage.removeItem('onboarding:lastCompletedSteps');
      }
    }
  }, [
    canEvaluateDismissedReopen,
    readDismissedStepSnapshot,
    checklistStepCompletion,
    clearDismissed,
  ]);

  const homeDebugContext = useMemo((): HomeDebugContext => ({
    teamCount: teams.length,
    gameCount: gamesForDisplay.length,
    scheduledCount: gamesForDisplay.filter(g => g.status === 'scheduled' || !g.status).length,
    inProgressCount: gamesForDisplay.filter(g => g.status === 'in-progress' || g.status === 'halftime').length,
    completedCount: gamesForDisplay.filter(g => g.status === 'completed').length,
    isCreatingGame,
  }), [teams, gamesForDisplay, isCreatingGame]);

  const homeDebugSnapshot = useMemo(
    () => buildFlatDebugSnapshot('Home Debug Snapshot', { ...homeDebugContext }),
    [homeDebugContext]
  );

  useEffect(() => {
    setDebugContext(homeDebugSnapshot);
    return () => setDebugContext(null);
  }, [homeDebugSnapshot, setDebugContext]);

  // Read demo team ID from localStorage
  const demoTeamId = typeof window !== 'undefined' ? localStorage.getItem('onboarding:demoTeamId') : null;

  const handleRemoveDemoData = async () => {
    if (!demoTeamId) return;
    try {
      await removeDemoData(demoTeamId);
    } catch (error) {
      console.error('Failed to remove demo data', error);
      showError(error instanceof Error ? error.message : 'Failed to remove demo data');
      throw error; // re-throw so checklist stays open if removal fails
    }
  };

  // Handle navigation from checklist
  const handleNavigateFromChecklist = (stepId: number) => {
    switch (stepId) {
      case 1:
        void navigate('/manage?section=teams');
        break;
      case 2:
        void navigate('/profile');
        break;
      case 3:
        void navigate('/manage?section=players');
        break;
      case 4:
        void navigate('/manage?section=teams');
        break;
      case 5:
        // Scroll to Schedule Game button
        scheduleGameButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scheduleGameButtonRef.current?.focus();
        break;
      case 6: {
        // Navigate to first scheduled game (now shows Plan tab in GameManagement)
        const firstScheduledGame = gamesForDisplay.find(g => (g.status || 'scheduled') === 'scheduled');
        if (firstScheduledGame) {
          void navigate(`/game/${firstScheduledGame.id}`);
        }
        break;
      }
      case 7: {
        // Navigate to first in-progress or scheduled game
        const firstGame = gamesForDisplay.find(g => g.status === 'in-progress' || g.status === 'halftime') ||
                          gamesForDisplay.find(g => (g.status || 'scheduled') === 'scheduled');
        if (firstGame) {
          void navigate(`/game/${firstGame.id}`);
        } else {
          // Fallback: scroll to step 4 button
          scheduleGameButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          scheduleGameButtonRef.current?.focus();
        }
        break;
      }
    }
  };

  const handleOpenQuickStart = () => {
    markWelcomed();
    void navigate('/profile');
  };

  useEffect(() => {
    if (!currentUserId || authStatus !== 'authenticated') {
      setProfileComplete(false);
      setIsProfileCompletionResolved(authStatus !== 'authenticated');
      return;
    }

    const coachProfileModel = client.models.CoachProfile;
    if (!coachProfileModel?.get) {
      setProfileComplete(false);
      setIsProfileCompletionResolved(false);
      return;
    }

    let isMounted = true;
    setIsProfileCompletionResolved(false);
    void coachProfileModel.get({ id: currentUserId })
      .then((result) => {
        if (!isMounted) {
          return;
        }

        const normalizedFirstName = result.data?.firstName?.trim() ?? '';
        setProfileComplete(normalizedFirstName.length > 0);
        setIsProfileCompletionResolved(true);
      })
      .catch(() => {
        if (isMounted) {
          // Fetch failures are unresolved profile state; do not treat as confirmed regression.
          setIsProfileCompletionResolved(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authStatus, currentUserId]);

  // Intentionally searches the full `teams` list, not activeTeams — historical
  // games for an archived team must still resolve their team name/info here.
  // See docs/plans/TEAM-ARCHIVE-STEP5-FRONTEND-UX.md.
  const getTeam = (teamId: string) => {
    return teams.find(t => t.id === teamId);
  };

  const handleCreateGame = async () => {
    if (!currentUserId) {
      showError('User not found. Please refresh.');
      return;
    }

    if (!opponent.trim() || !selectedTeamForGame) {
      showWarning('Please enter opponent name and select a team');
      return;
    }

    const team = teams.find(t => t.id === selectedTeamForGame);
    if (!team) {
      showError('Team not found');
      return;
    }
    if (!isTeamActive(team)) {
      showError('Cannot schedule a game for an archived team.');
      return;
    }

    setIsSubmittingGame(true);
    try {
      const created = await createGame({
        teamId: selectedTeamForGame,
        opponent,
        isHome,
        gameDate: gameDate ? new Date(gameDate).toISOString() : undefined,
      });
      // `createGame`'s return type is the flat custom-mutation shape (no lazy
      // relation loaders — team, lineupAssignments, etc.), unlike `Game` (from
      // `useAmplifyQuery('Game')`), which carries them. Nothing that reads
      // `pendingCreatedGames`/`gamesForDisplay` in this component invokes a
      // lazy relation loader on a Game object, so this cast is safe today —
      // see docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md,
      // Risks and Edge Cases.
      setPendingCreatedGames((prev) => [...prev, created as unknown as Game]);
      setOpponent('');
      setGameDate('');
      setIsHome(true);
      setSelectedTeamForGame('');
      setIsCreatingGame(false);
      trackEvent(AnalyticsEvents.GAME_CREATED.category, AnalyticsEvents.GAME_CREATED.action);
    } catch (error) {
      console.error('Failed to create game', error);
      showError(error instanceof Error ? error.message : 'Failed to create game');
    } finally {
      setIsSubmittingGame(false);
      setGameRefreshKey((k) => k + 1);
    }
  };

  const isImportResultNoOp = (result: CalendarSyncResult): boolean =>
    (result.createdGames?.length ?? 0) === 0 &&
    (result.updatedGames?.length ?? 0) === 0 &&
    (result.adoptedCount ?? 0) === 0 &&
    (result.cancelledCount ?? 0) === 0;

  const absorbImportResult = (result: CalendarSyncResult) => {
    const created = (result.createdGames ?? []).filter((g): g is Game => g != null);
    if (created.length > 0) {
      // Same overlay mechanism createGameSafe already uses (Home.tsx:130) —
      // SDK writes don't fire AppSync subscriptions, so newly created games
      // need to be shown immediately rather than waiting for observeQuery.
      setPendingCreatedGames((prev) => [...prev, ...created]);
    }
    // updatedGames (including adopted games) can't be absorbed by the
    // addition-only overlay above — an updated game's id is already present
    // in `games`, so an overlay entry for it would be silently dropped
    // (round-2 Major C). Force a re-subscribe instead.
    setGameRefreshKey((k) => k + 1);
  };

  const describeImportResult = (result: CalendarSyncResult): string => {
    const parts: string[] = [];
    const createdCount = result.createdGames?.length ?? 0;
    const updatedCount = (result.updatedGames?.length ?? 0) - (result.adoptedCount ?? 0);
    if (createdCount > 0) parts.push(`created ${createdCount}`);
    if (updatedCount > 0) parts.push(`updated ${updatedCount}`);
    if (result.adoptedCount) parts.push(`linked ${result.adoptedCount} you already entered`);
    if (result.cancelledCount) parts.push(`flagged ${result.cancelledCount} cancelled`);

    let message = parts.length > 0 ? `Calendar sync: ${parts.join(', ')}` : 'Calendar sync complete';

    // Per-event write failures during a real sync are swallowed by the
    // handler so the rest of the batch keeps processing (sync-team-calendar
    // handler.ts ~line 416-430) — surface that here rather than silently
    // dropping it, since there's no other UI surface for it.
    const failedCount = result.failedCount ?? 0;
    if (failedCount > 0) {
      message += `, but ${failedCount} game${failedCount === 1 ? '' : 's'} failed to sync`;
    }

    const warningsCount = result.warnings?.length ?? 0;
    if (warningsCount > 0) {
      message += ` (${warningsCount} warning${warningsCount === 1 ? '' : 's'})`;
    }

    return `${message}.`;
  };

  const resetImportPanel = useCallback(() => {
    setIsImportingCalendar(false);
    setImportTeamId('');
    setImportPreview(null);
    setImportPreviewArgs(null);
    setShowFileFallback(false);
  }, []);

  const handleImportFileSelected = useCallback(async (file: File) => {
    if (!importTeamId) {
      showWarning('Select a team first');
      return;
    }
    // Advisory client-side cap (the handler enforces this again server-side
    // — Security requirements: the client cap is advisory only).
    const MAX_ICS_BYTES = 512 * 1024;
    if (file.size > MAX_ICS_BYTES) {
      showError('That calendar file is too large (max 512 KB).');
      return;
    }

    let icsContent: string;
    try {
      icsContent = await file.text();
    } catch {
      showError('Could not read that file.');
      return;
    }

    setIsCheckingImport(true);
    try {
      const result = await syncTeamCalendar({ teamId: importTeamId, icsContent, dryRun: true });
      if (isImportResultNoOp(result)) {
        showSuccess('No changes — schedule already up to date');
        resetImportPanel();
        return;
      }
      setImportPreview(result);
      setImportPreviewArgs({ teamId: importTeamId, icsContent });
    } catch (error) {
      console.error('Failed to preview calendar import', error);
      showError(error instanceof Error ? error.message : 'Failed to check calendar file');
    } finally {
      setIsCheckingImport(false);
    }
  }, [importTeamId, resetImportPanel]);

  // "Sync now" (Phase 3+): re-syncs the team's already-saved feed — no
  // feedUrl/icsContent argument, so the Lambda fetches from the saved
  // CalendarFeed row. Same dryRun-preview/no-op-toast flow as the file path.
  const handleSyncNowForSelectedTeam = useCallback(async () => {
    if (!importTeamId) {
      showWarning('Select a team first');
      return;
    }
    setIsCheckingImport(true);
    try {
      const result = await syncTeamCalendar({ teamId: importTeamId, dryRun: true });
      if (isImportResultNoOp(result)) {
        showSuccess('No changes — schedule already up to date');
        resetImportPanel();
        return;
      }
      setImportPreview(result);
      setImportPreviewArgs({ teamId: importTeamId });
    } catch (error) {
      console.error('Failed to preview calendar sync', error);
      showError(error instanceof Error ? error.message : 'Failed to check calendar feed');
    } finally {
      setIsCheckingImport(false);
    }
  }, [importTeamId, resetImportPanel]);

  const handleConfirmImport = useCallback(async () => {
    if (!importPreviewArgs) return;
    setIsApplyingImport(true);
    try {
      const result = await syncTeamCalendar({ ...importPreviewArgs, dryRun: false });
      absorbImportResult(result);
      const message = describeImportResult(result);
      if ((result.failedCount ?? 0) > 0) {
        showWarning(message);
      } else {
        showSuccess(message);
      }
      resetImportPanel();
      trackEvent(AnalyticsEvents.CALENDAR_IMPORT_APPLIED.category, AnalyticsEvents.CALENDAR_IMPORT_APPLIED.action);
    } catch (error) {
      console.error('Failed to apply calendar import', error);
      showError(error instanceof Error ? error.message : 'Failed to import calendar');
    } finally {
      setIsApplyingImport(false);
    }
  }, [importPreviewArgs, resetImportPanel]);

  const handleCancelImportPreview = useCallback(() => {
    setImportPreview(null);
    setImportPreviewArgs(null);
  }, []);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    
    // Compare calendar dates, not time differences
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = dateOnly.getTime() - nowOnly.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Tomorrow at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === -1) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString('en-US', { 
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string | null | undefined) => {
    if (!status || status === 'scheduled') return '📅 Scheduled';
    if (status === 'in-progress') return '⚽ In Progress';
    if (status === 'halftime') return '⏸️ Halftime';
    if (status === 'completed') return '✅ Completed';
    return status;
  };

  // Pill-badge convention (.status-badge, App.css) rather than the
  // plain-text .game-status style. Priority rule (UI review round 1):
  // cancelled suppresses unverified-home/away on the same card, since a
  // cancelled game's home/away accuracy is moot. The durable adopted
  // indicator (externalAdoptedAt) is provenance information, not a warning,
  // and can co-occur with either.
  const renderFeedStatusBadges = (game: Game) => {
    const cancelled = Boolean(game.externalCancelled);
    const unverified = !cancelled && Boolean(game.externalHomeAwayUnverified);
    const adopted = Boolean(game.externalAdoptedAt);
    if (!cancelled && !unverified && !adopted) return null;

    return (
      <>
        {cancelled && <span className="status-badge status-feed-cancelled">Cancelled by organizer</span>}
        {unverified && <span className="status-badge status-unverified-home-away">⚠ Verify home/away</span>}
        {adopted && <span className="import-adopted-tag">Linked from your entry</span>}
      </>
    );
  };

  const formatArriveByTime = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Imported venue/arrive-by details (Phase 4 UI polish). "may be
  // overwritten on the next sync" per the plan's "Coach edits vs. re-sync"
  // section — surfaced once, in CalendarFeedSettings, not repeated per card.
  const renderImportedGameMeta = (game: Game) => {
    const arriveBy = formatArriveByTime(game.arriveByTime);
    if (!game.locationName && !arriveBy) return null;
    return (
      <p className="game-meta-imported">
        {game.locationName && `📍 ${game.locationName}`}
        {game.locationName && arriveBy && ' • '}
        {arriveBy && `Arrive by ${arriveBy}`}
      </p>
    );
  };

  const handleGameClick = (game: Game) => {
    const team = getTeam(game.teamId);
    // Amplify model instances contain lazy-loader functions for relations
    // which cannot be structured-cloned by history.pushState. JSON round-trip
    // strips those non-serializable properties.
    void navigate(`/game/${game.id}`, {
      state: JSON.parse(JSON.stringify({ game, team: team || null })),
    });
  };

  const handleEditGame = useCallback((game: Game) => {
    closeSwipe();
    setEditingGameId(game.id);
    setEditOpponent(game.opponent ?? '');
    setEditGameDate(isoToDatetimeLocal(game.gameDate));
    setEditIsHome(game.isHome ?? true);
  }, [closeSwipe]);

  const handleSaveEditGame = useCallback(async () => {
    if (!editingGameId) return;
    if (!editOpponent.trim()) {
      showWarning('Please enter an opponent name');
      return;
    }
    setIsSavingEdit(true);
    const timeoutId = setTimeout(() => {
      setIsSavingEdit(false);
      showError('Could not confirm save — check your connection and try again.');
    }, 5000);
    try {
      await client.models.Game.update({
        id: editingGameId,
        opponent: editOpponent.trim(),
        isHome: editIsHome,
        gameDate: editGameDate ? new Date(editGameDate).toISOString() : null,
      });
      clearTimeout(timeoutId);
      setPendingCreatedGames((prev) => prev.map((g) =>
        g.id === editingGameId
          ? { ...g, opponent: editOpponent.trim(), isHome: editIsHome, gameDate: editGameDate ? new Date(editGameDate).toISOString() : null }
          : g
      ));
      trackEvent(AnalyticsEvents.GAME_UPDATED.category, AnalyticsEvents.GAME_UPDATED.action);
      setEditingGameId(null);
      setIsSavingEdit(false);
      setGameRefreshKey((k) => k + 1);
    } catch (error) {
      clearTimeout(timeoutId);
      setIsSavingEdit(false);
      handleApiError(error, 'Failed to update game');
    }
  }, [editingGameId, editOpponent, editIsHome, editGameDate]);

  const handleCancelEditGame = useCallback(() => {
    setEditingGameId(null);
    setIsSavingEdit(false);
  }, []);

  const handleDeleteGameFromHome = useCallback(async (game: Game) => {
    closeSwipe();
    const confirmed = await confirm({
      title: 'Delete Game',
      message: 'Are you sure you want to delete this game? This action cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteGameCascade(game.id);
      setPendingCreatedGames((prev) => prev.filter((g) => g.id !== game.id));
      trackEvent(AnalyticsEvents.GAME_DELETED.category, AnalyticsEvents.GAME_DELETED.action);
      setGameRefreshKey((k) => k + 1);
    } catch (error) {
      console.error('Failed to delete game', error);
      showError(error instanceof Error ? error.message : 'Failed to delete game');
    }
  }, [closeSwipe, confirm]);

  // Group games by status
  const inProgressGames = gamesForDisplay.filter(g => {
    const status = g.status || 'scheduled';
    return status === 'in-progress' || status === 'halftime';
  });
  const scheduledGames = gamesForDisplay.filter(g => (g.status || 'scheduled') === 'scheduled');
  const completedGames = gamesForDisplay.filter(g => g.status === 'completed');

  // Calendar Feed Import CTA state (Phase 3+ relabeling rule): once at least
  // one active team has a saved feed, the trigger becomes "Sync now"; the
  // panel then offers a re-sync of the selected team's saved feed, with a
  // fallback toggle back to file upload.
  const hasAnyLinkedFeed = activeTeams.some((t) => Boolean(t.calendarFeedHost));
  const selectedImportTeam = activeTeams.find((t) => t.id === importTeamId);
  const selectedTeamHasFeed = Boolean(selectedImportTeam?.calendarFeedHost);
  const showFileInput = !selectedTeamHasFeed || showFileFallback || !importTeamId;

  if (authStatus !== 'authenticated') return null;

  return (
    <div className="home">
      {/* Show WelcomeModal only once we know the user has no existing teams,
          preventing a flash for existing users being auto-welcomed */}
      {!welcomed && isTeamsSynced && (
        <WelcomeModal
          onClose={markWelcomed}
          onGetStarted={handleOpenQuickStart}
        />
      )}

      {/* Show QuickStartChecklist if not dismissed */}
      {!dismissed && welcomed && (
        <QuickStartChecklist
          teams={activeTeams}
          games={gamesForDisplay}
          teamRosters={teamRosters}
          gamePlans={gamePlans}
          collapsed={collapsed}
          demoTeamId={demoTeamId}
          onDismiss={handleChecklistDismiss}
          onExpand={expand}
          onNavigate={handleNavigateFromChecklist}
          onRemoveDemoData={demoTeamId ? handleRemoveDemoData : undefined}
                  profileComplete={profileComplete}
        />
      )}

      {!isCreatingGame && (
        <button
          ref={scheduleGameButtonRef}
          onClick={() => setIsCreatingGame(true)}
          className="btn-primary"
        >
          + Schedule New Game
        </button>
      )}

      {/* Calendar Feed Import: one CTA slot (not competing with "+ Schedule
          New Game" above), relabeled by state -- "Import from calendar"
          (Phase 2, file picker) becomes "Sync now" once a feed is saved
          (Phase 3+). See "Sync interaction flow" in the plan. */}
      {!isCreatingGame && !isImportingCalendar && activeTeams.length > 0 && (
        <button
          onClick={() => setIsImportingCalendar(true)}
          className="btn-secondary calendar-import-trigger"
        >
          {hasAnyLinkedFeed ? '🔄 Sync now' : '📅 Import from calendar'}
        </button>
      )}

      {isImportingCalendar && (
        <div className="create-form calendar-import-panel">
          <h3>{selectedTeamHasFeed && !showFileFallback ? 'Sync Calendar' : 'Import from Calendar'}</h3>
          {!selectedTeamHasFeed || showFileFallback ? (
            <p className="calendar-import-hint">Upload a team schedule .ics file to import games.</p>
          ) : (
            <p className="calendar-import-hint">
              Linked to <strong>{selectedImportTeam?.calendarFeedHost}</strong>. Re-sync to pick up changes.
            </p>
          )}
          <select
            value={importTeamId}
            onChange={(e) => {
              setImportTeamId(e.target.value);
              setShowFileFallback(false);
            }}
            disabled={isCheckingImport}
            aria-label="Team to import games for"
          >
            <option value="">Select Team *</option>
            {activeTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>

          {showFileInput ? (
            <input
              type="file"
              accept=".ics,text/calendar"
              disabled={!importTeamId || isCheckingImport}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFileSelected(file);
                e.target.value = '';
              }}
              aria-label="Calendar .ics file"
            />
          ) : (
            <>
              <button
                onClick={() => void handleSyncNowForSelectedTeam()}
                className="btn-primary"
                disabled={isCheckingImport}
              >
                {isCheckingImport ? 'Checking…' : '🔄 Sync now'}
              </button>
              <button
                type="button"
                className="btn-link calendar-import-file-fallback"
                onClick={() => setShowFileFallback(true)}
                disabled={isCheckingImport}
              >
                or upload a file instead
              </button>
            </>
          )}

          {isCheckingImport && <p className="calendar-import-status">Checking…</p>}
          <div className="form-actions">
            <button onClick={resetImportPanel} className="btn-secondary" disabled={isCheckingImport}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="modal-overlay" onClick={handleCancelImportPreview}>
          <div className="modal-content calendar-import-preview-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import Preview</h2>
            <ul className="calendar-import-summary">
              {(importPreview.createdGames?.length ?? 0) > 0 && (
                <li>This will create {importPreview.createdGames!.length} game(s).</li>
              )}
              {(importPreview.adoptedCount ?? 0) > 0 && (
                <li>Link {importPreview.adoptedCount} game(s) you already entered by hand.</li>
              )}
              {((importPreview.updatedGames?.length ?? 0) - (importPreview.adoptedCount ?? 0)) > 0 && (
                <li>Update {(importPreview.updatedGames!.length) - (importPreview.adoptedCount ?? 0)} existing game(s).</li>
              )}
              {(importPreview.cancelledCount ?? 0) > 0 && (
                <li>Flag {importPreview.cancelledCount} game(s) as cancelled by the organizer.</li>
              )}
              {(importPreview.skippedCount ?? 0) > 0 && (
                <li>{importPreview.skippedCount} game(s) are already up to date.</li>
              )}
            </ul>
            {importPreview.warnings && importPreview.warnings.length > 0 && (
              <div className="calendar-import-warnings">
                <h4>Warnings</h4>
                <ul>
                  {importPreview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <p className="calendar-import-overwrite-note">
              Imported venue and arrive-by details may be overwritten on the next sync.
            </p>
            <div className="form-actions">
              <button onClick={handleConfirmImport} className="btn-primary" disabled={isApplyingImport}>
                {isApplyingImport ? 'Applying…' : 'Confirm'}
              </button>
              <button onClick={handleCancelImportPreview} className="btn-secondary" disabled={isApplyingImport}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreatingGame && (
        <div className="create-form">
          <h3>Schedule New Game</h3>
          <select
            value={selectedTeamForGame}
            onChange={(e) => setSelectedTeamForGame(e.target.value)}
          >
            <option value="">Select Team *</option>
            {activeTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Opponent Team Name *"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
          />
          <input
            type="datetime-local"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isHome}
              onChange={(e) => setIsHome(e.target.checked)}
            />
            Home Game
          </label>
          <div className="form-actions">
            <button onClick={handleCreateGame} className="btn-primary" disabled={isSubmittingGame}>
              {isSubmittingGame ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => {
                setIsCreatingGame(false);
                setOpponent('');
                setGameDate('');
                setIsHome(true);
                setSelectedTeamForGame('');
              }}
              className="btn-secondary"
              disabled={isSubmittingGame}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {gamesForDisplay.length === 0 && !isCreatingGame && (
        <div className="empty-state">
          <p>No games scheduled yet.</p>
          <p>Click the button above to schedule your first game, or go to the Manage tab to create seasons and teams.</p>
        </div>
      )}

      {inProgressGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Active Games</h3>
          {inProgressGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;
            
            return (
              <div 
                key={game.id} 
                className="game-card active-game"
                onClick={() => handleGameClick(game)}
              >
                <div className="game-status">
                  {getStatusBadge(game.status)}
                </div>
                <div className="game-info">
                  <h4>{team.name} vs {game.opponent}</h4>
                  <p className="game-meta">
                    {game.isHome ? '🏠 Home' : '✈️ Away'}
                    {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scheduledGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Upcoming Games</h3>
          {scheduledGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;

            const isEditingThis = editingGameId === game.id;

            return (
              <div key={game.id} className="swipeable-item-container">
                {isEditingThis ? (
                  <div className="create-form">
                    <h3>Edit Game</h3>
                    <input
                      type="text"
                      placeholder="Opponent Team Name *"
                      value={editOpponent}
                      onChange={(e) => setEditOpponent(e.target.value)}
                      maxLength={100}
                      autoFocus
                    />
                    <input
                      type="datetime-local"
                      value={editGameDate}
                      onChange={(e) => setEditGameDate(e.target.value)}
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editIsHome}
                        onChange={(e) => setEditIsHome(e.target.checked)}
                      />
                      Home Game
                    </label>
                    <div className="form-actions">
                      <button
                        onClick={handleSaveEditGame}
                        className="btn-primary"
                        disabled={isSavingEdit}
                      >
                        {isSavingEdit ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button onClick={handleCancelEditGame} className="btn-secondary" disabled={isSavingEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="game-card"
                      {...getSwipeProps(game.id)}
                      style={getSwipeStyle(game.id)}
                      aria-label={`${team.name} vs ${game.opponent}, scheduled. Swipe left for edit and delete options.`}
                    >
                      <div
                        className="game-card-content"
                        onClick={() => handleGameClick(game)}
                      >
                        <div className="game-status">{getStatusBadge(game.status)}</div>
                        {renderFeedStatusBadges(game)}
                        <div className="game-info">
                          <h4>{team.name} vs {game.opponent}</h4>
                          <p className="game-meta">
                            {game.isHome ? '🏠 Home' : '✈️ Away'}
                            {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                          </p>
                          {renderImportedGameMeta(game)}
                        </div>
                      </div>
                      <div className="game-card-actions">
                        <button
                          className="open-game-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            trackEvent(AnalyticsEvents.GAME_OPENED.category, AnalyticsEvents.GAME_OPENED.action);
                            handleGameClick(game);
                          }}
                        >
                          ▶ Open Game
                        </button>
                      </div>
                    </div>
                    <div className="game-card-swipe-reveal">
                      <button
                        className="btn-edit-swipe"
                        onClick={() => handleEditGame(game)}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="btn-delete-swipe-game"
                        onClick={() => handleDeleteGameFromHome(game)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {completedGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Past Games</h3>
          {completedGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;
            
            return (
              <div 
                key={game.id} 
                className="game-card completed-game"
                onClick={() => handleGameClick(game)}
              >
                <div className="game-status">
                  {getStatusBadge(game.status)}
                </div>
                <div className="game-info">
                  <h4>{team.name} vs {game.opponent}</h4>
                  <p className="game-meta">
                    {game.isHome ? '🏠 Home' : '✈️ Away'}
                    {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineQueueDrain } from "./useOfflineQueueDrain";

const {
  mockPendingCount,
  mockDequeueAll,
  mockRequeueFailed,
  mockRequeuePreserved,
  mockDeduplicateGameUpdates,
  mockFetchAuthSession,
  mockUseNetworkStatus,
  mockGameUpdate,
  mockGoalCreate,
} = vi.hoisted(() => ({
  mockPendingCount: vi.fn(),
  mockDequeueAll: vi.fn(),
  mockRequeueFailed: vi.fn(),
  mockRequeuePreserved: vi.fn(),
  mockDeduplicateGameUpdates: vi.fn(),
  mockFetchAuthSession: vi.fn(),
  mockUseNetworkStatus: vi.fn(),
  mockGameUpdate: vi.fn(),
  mockGoalCreate: vi.fn(),
}));

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: { create: vi.fn(), update: mockGameUpdate, delete: vi.fn() },
      Goal: { create: mockGoalCreate, update: vi.fn(), delete: vi.fn() },
      PlayTimeRecord: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      Substitution: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      LineupAssignment: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      PlayerAvailability: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
  })),
}));

vi.mock("./useNetworkStatus", () => ({
  useNetworkStatus: (...args: unknown[]) => mockUseNetworkStatus(...args),
}));

vi.mock("../services/offlineQueueService", () => ({
  pendingCount: (...args: unknown[]) => mockPendingCount(...args),
  dequeueAll: (...args: unknown[]) => mockDequeueAll(...args),
  requeueFailed: (...args: unknown[]) => mockRequeueFailed(...args),
  requeuePreserved: (...args: unknown[]) => mockRequeuePreserved(...args),
  deduplicateGameUpdates: (...args: unknown[]) => mockDeduplicateGameUpdates(...args),
}));

describe("useOfflineQueueDrain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPendingCount.mockResolvedValue(0);
    mockDequeueAll.mockResolvedValue([]);
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { payload: { sub: "user-1" } } },
    });

    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
  });

  it("drains queue on startup when online and pending items exist", async () => {
    mockPendingCount.mockResolvedValue(1);
    mockDequeueAll.mockResolvedValue([
      {
        id: "q1",
        model: "Game",
        operation: "update",
        payload: { id: "game-1", elapsedSeconds: 120 },
        ownerSub: "user-1",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
    ]);

    renderHook(() => useOfflineQueueDrain());

    await waitFor(() => {
      expect(mockDeduplicateGameUpdates).toHaveBeenCalled();
      expect(mockDequeueAll).toHaveBeenCalled();
      expect(mockGameUpdate).toHaveBeenCalledWith({ id: "game-1", elapsedSeconds: 120 });
    });
  });

  it("does not drain on startup when offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    renderHook(() => useOfflineQueueDrain());

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockPendingCount).not.toHaveBeenCalled();
    expect(mockDequeueAll).not.toHaveBeenCalled();
  });

  it("drains on reconnect callback from network hook", async () => {
    let onReconnect: (() => void) | undefined;
    mockUseNetworkStatus.mockImplementation((args: { onReconnect: () => void }) => {
      onReconnect = args.onReconnect;
    });

    mockPendingCount.mockResolvedValue(1);
    mockDequeueAll.mockResolvedValue([
      {
        id: "q1",
        model: "Goal",
        operation: "create",
        payload: { gameId: "game-1", scoredByUs: true },
        ownerSub: "user-1",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
    ]);

    renderHook(() => useOfflineQueueDrain());

    await act(async () => {
      onReconnect?.();
    });

    await waitFor(() => {
      expect(mockGoalCreate).toHaveBeenCalledWith({ gameId: "game-1", scoredByUs: true });
    });
  });

  it("preserves non-drainable and cross-user items without replaying them", async () => {
    mockPendingCount.mockResolvedValue(2);
    mockDequeueAll.mockResolvedValue([
      {
        id: "q1",
        model: "GameNote",
        operation: "create",
        payload: { gameId: "game-1", notes: "note" },
        ownerSub: "user-1",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
      {
        id: "q2",
        model: "Game",
        operation: "update",
        payload: { id: "game-1", elapsedSeconds: 300 },
        ownerSub: "user-2",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
    ]);

    renderHook(() => useOfflineQueueDrain());

    await waitFor(() => {
      expect(mockRequeuePreserved).toHaveBeenCalledTimes(2);
      expect(mockGameUpdate).not.toHaveBeenCalled();
    });
  });

  it("requeues failed drainable mutations for retry", async () => {
    mockPendingCount.mockResolvedValue(1);
    mockGameUpdate.mockRejectedValue(new Error("boom"));
    const failedItem = {
      id: "q1",
      model: "Game",
      operation: "update",
      payload: { id: "game-1", elapsedSeconds: 500 },
      ownerSub: "user-1",
      enqueuedAt: Date.now(),
      retryCount: 0,
    };
    mockDequeueAll.mockResolvedValue([failedItem]);

    renderHook(() => useOfflineQueueDrain());

    await waitFor(() => {
      expect(mockRequeueFailed).toHaveBeenCalledWith([
        expect.objectContaining({ id: "q1", model: "Game", operation: "update" }),
      ]);
    });
  });

  it("skips drain when auth session is unavailable", async () => {
    mockPendingCount.mockResolvedValue(1);
    mockFetchAuthSession.mockRejectedValue(new Error("not-authenticated"));
    mockDequeueAll.mockResolvedValue([
      {
        id: "q1",
        model: "Game",
        operation: "update",
        payload: { id: "game-1", elapsedSeconds: 42 },
        ownerSub: "user-1",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
    ]);

    renderHook(() => useOfflineQueueDrain());

    await waitFor(() => {
      expect(mockFetchAuthSession).toHaveBeenCalled();
    });

    expect(mockDequeueAll).not.toHaveBeenCalled();
    expect(mockGameUpdate).not.toHaveBeenCalled();
  });

  it("prevents overlapping drains while a drain is already in progress", async () => {
    let onReconnect: (() => void) | undefined;
    mockUseNetworkStatus.mockImplementation((args: { onReconnect: () => void }) => {
      onReconnect = args.onReconnect;
    });

    let resolveUpdate: (() => void) | undefined;
    const updatePromise = new Promise<void>(resolve => {
      resolveUpdate = resolve;
    });

    mockPendingCount.mockResolvedValue(1);
    mockDequeueAll.mockResolvedValue([
      {
        id: "q1",
        model: "Game",
        operation: "update",
        payload: { id: "game-1", elapsedSeconds: 123 },
        ownerSub: "user-1",
        enqueuedAt: Date.now(),
        retryCount: 0,
      },
    ]);
    mockGameUpdate.mockImplementation(() => updatePromise);

    renderHook(() => useOfflineQueueDrain());

    await waitFor(() => {
      expect(mockGameUpdate).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      onReconnect?.();
      onReconnect?.();
    });

    // While in flight, reconnect events must not trigger a second drain.
    expect(mockPendingCount).toHaveBeenCalledTimes(1);
    expect(mockGameUpdate).toHaveBeenCalledTimes(1);

    resolveUpdate?.();
    await act(async () => {
      await updatePromise;
    });
  });
});

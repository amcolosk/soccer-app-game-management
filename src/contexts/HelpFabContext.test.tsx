/**
 * Tests for HelpFabContext — verifies that helpContext and debugContext
 * are independent state variables, both initialise to null, and update correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HelpFabProvider, useHelpFab } from './HelpFabContext';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Helper component — renders the current context values as data attributes
// ---------------------------------------------------------------------------
function ContextConsumer({
  onMount,
}: {
  onMount?: (ctx: ReturnType<typeof useHelpFab>) => void;
}) {
  const ctx = useHelpFab();

  // Call onMount on the first render so tests can inspect the context values
  // (useLayoutEffect so it fires synchronously after render)
  if (onMount) {
    onMount(ctx);
  }

  return (
    <div
      data-testid="consumer"
      data-help-context={ctx.helpContext ?? 'null'}
      data-debug-context={ctx.debugContext ?? 'null'}
    />
  );
}

function renderWithProvider(ui: ReactNode) {
  return render(<HelpFabProvider>{ui}</HelpFabProvider>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HelpFabContext — useHelpFab guard', () => {
  it('throws when called outside HelpFabProvider', () => {
    // Suppress the expected React error boundary output in tests
    const originalError = console.error;
    console.error = vi.fn();

    expect(() => render(<ContextConsumer />)).toThrow(
      'useHelpFab must be used within a HelpFabProvider'
    );

    console.error = originalError;
  });
});

describe('HelpFabContext — initial values', () => {
  it('helpContext is null initially', () => {
    renderWithProvider(<ContextConsumer />);
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-help-context', 'null');
  });

  it('debugContext is null initially', () => {
    renderWithProvider(<ContextConsumer />);
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-debug-context', 'null');
  });
});

describe('HelpFabContext — setHelpContext', () => {
  it('updates helpContext when setHelpContext is called', () => {
    let capturedCtx: ReturnType<typeof useHelpFab> | null = null;

    renderWithProvider(
      <ContextConsumer onMount={(ctx) => { capturedCtx = ctx; }} />
    );

    act(() => {
      capturedCtx!.setHelpContext('home');
    });

    expect(screen.getByTestId('consumer')).toHaveAttribute('data-help-context', 'home');
  });

  it('clears helpContext when setHelpContext(null) is called', () => {
    let capturedCtx: ReturnType<typeof useHelpFab> | null = null;

    renderWithProvider(
      <ContextConsumer onMount={(ctx) => { capturedCtx = ctx; }} />
    );

    act(() => {
      capturedCtx!.setHelpContext('profile');
    });
    act(() => {
      capturedCtx!.setHelpContext(null);
    });

    expect(screen.getByTestId('consumer')).toHaveAttribute('data-help-context', 'null');
  });
});

describe('HelpFabContext — independence of helpContext and debugContext', () => {
  it('setting helpContext does not affect debugContext', () => {
    let capturedCtx: ReturnType<typeof useHelpFab> | null = null;

    renderWithProvider(
      <ContextConsumer onMount={(ctx) => { capturedCtx = ctx; }} />
    );

    act(() => {
      capturedCtx!.setHelpContext('home');
    });

    // debugContext should still be null
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-debug-context', 'null');
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-help-context', 'home');
  });

  it('setting debugContext does not affect helpContext', () => {
    let capturedCtx: ReturnType<typeof useHelpFab> | null = null;

    renderWithProvider(
      <ContextConsumer onMount={(ctx) => { capturedCtx = ctx; }} />
    );

    act(() => {
      capturedCtx!.setDebugContext('debug data');
    });

    // helpContext should still be null
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-help-context', 'null');
    expect(screen.getByTestId('consumer')).toHaveAttribute('data-debug-context', 'debug data');
  });

  it('both values can be set simultaneously and remain independent', () => {
    let capturedCtx: ReturnType<typeof useHelpFab> | null = null;

    renderWithProvider(
      <ContextConsumer onMount={(ctx) => { capturedCtx = ctx; }} />
    );

    act(() => {
      capturedCtx!.setHelpContext('manage-teams');
      capturedCtx!.setDebugContext('{"rotation":10}');
    });

    const consumer = screen.getByTestId('consumer');
    expect(consumer).toHaveAttribute('data-help-context', 'manage-teams');
    expect(consumer).toHaveAttribute('data-debug-context', '{"rotation":10}');
  });

  it('setHelpContext setter reference is stable between renders', () => {
    // Collect all setter references from every render to verify they're identical
    const setterHistory: Array<(key: ReturnType<typeof useHelpFab>['helpContext']) => void> = [];

    function TrackerConsumer() {
      const ctx = useHelpFab();
      setterHistory.push(ctx.setHelpContext);
      return <div data-testid="tracker" data-help-context={ctx.helpContext ?? 'null'} />;
    }

    renderWithProvider(<TrackerConsumer />);

    // Trigger a re-render by setting a value
    act(() => {
      setterHistory[0]('home');
    });

    // React useState setters are guaranteed stable — all captured references must be identical
    const uniqueSetters = new Set(setterHistory);
    expect(uniqueSetters.size).toBe(1);
  });
});

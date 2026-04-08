import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeDelete } from './useSwipeDelete';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSwipeDelete', () => {
  let result: ReturnType<typeof renderHook<ReturnType<typeof useSwipeDelete>, never>>['result'];

  beforeEach(() => {
    const { result: hookResult } = renderHook(() => useSwipeDelete());
    result = hookResult;
  });

  it('initial state: swipedItemId is null, getSwipeStyle returns translateX(0px)', () => {
    expect(result.current.swipedItemId).toBeNull();

    const style = result.current.getSwipeStyle('any-id');
    expect(style.transform).toBe('translateX(-0px)');
  });

  it('after handleStart fires for item "a", swipedItemId equals "a"', () => {
    const props = result.current.getSwipeProps('a');

    act(() => {
      // Simulate touch start
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    expect(result.current.swipedItemId).toBe('a');
  });

  it('after handleStart + handleMove (diff=50px), getSwipeStyle("a") returns translateX(-50px)', () => {
    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchMove({ touches: [{ clientX: 50 }] } as React.TouchEvent);
    });

    const style = result.current.getSwipeStyle('a');
    expect(style.transform).toBe('translateX(-50px)');
  });

  it('handleMove does NOT exceed MAX_DISTANCE_PX (100px)', () => {
    const props = result.current.getSwipeProps('a');

    act(() => {
      props.onTouchStart({ touches: [{ clientX: 200 }] } as React.TouchEvent);
    });

    // Try to swipe 150px (exceeds MAX_DISTANCE_PX)
    act(() => {
      props.onTouchMove({ touches: [{ clientX: 50 }] } as React.TouchEvent);
    });

    const style = result.current.getSwipeStyle('a');
    // Should not update beyond MAX_DISTANCE_PX, stays at 0 (no update)
    expect(style.transform).toBe('translateX(-0px)');
  });

  it('handleMove ignores moves in the negative direction (diff ≤ 0)', () => {
    const props = result.current.getSwipeProps('a');

    act(() => {
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    // Try to swipe right (negative diff)
    act(() => {
      props.onTouchMove({ touches: [{ clientX: 150 }] } as React.TouchEvent);
    });

    const style = result.current.getSwipeStyle('a');
    expect(style.transform).toBe('translateX(-0px)');
  });

  it('after handleEnd with swipe exceeding threshold, getSwipeStyle("a") returns translateX(-80px)', () => {
    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchMove({ touches: [{ clientX: 40 }] } as React.TouchEvent);
    });

    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchEnd();
    });

    const style = result.current.getSwipeStyle('a');
    // OPEN_WIDTH_PX is 80
    expect(style.transform).toBe('translateX(-80px)');
  });

  it('after handleEnd with swipe below threshold, getSwipeStyle("a") returns translateX(-0px)', () => {
    const props = result.current.getSwipeProps('a');

    act(() => {
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    // Swipe only 30px (below THRESHOLD_PX of 50)
    act(() => {
      props.onTouchMove({ touches: [{ clientX: 70 }] } as React.TouchEvent);
    });

    act(() => {
      props.onTouchEnd();
    });

    const style = result.current.getSwipeStyle('a');
    expect(style.transform).toBe('translateX(-0px)');
    expect(result.current.swipedItemId).toBeNull();
  });

  it('close() resets swipedItemId to null and getSwipeStyle("a") returns 0', () => {
    const props = result.current.getSwipeProps('a');

    act(() => {
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    act(() => {
      props.onTouchMove({ touches: [{ clientX: 40 }] } as React.TouchEvent);
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.swipedItemId).toBeNull();
    const style = result.current.getSwipeStyle('a');
    expect(style.transform).toBe('translateX(-0px)');
  });

  it('getSwipeStyle returns 0 for items other than the currently swiped one', () => {
    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });

    act(() => {
      const props = result.current.getSwipeProps('a');
      props.onTouchMove({ touches: [{ clientX: 50 }] } as React.TouchEvent);
    });

    const styleA = result.current.getSwipeStyle('a');
    const styleB = result.current.getSwipeStyle('b');

    expect(styleA.transform).toBe('translateX(-50px)');
    expect(styleB.transform).toBe('translateX(-0px)');
  });

  it('getSwipeStyle includes a CSS transition when NOT actively swiping (swipeStartX === 0)', () => {
    const style = result.current.getSwipeStyle('a');
    expect(style.transition).toBe('transform 0.3s ease');
  });

  it('getSwipeProps("a") return value includes onTouchStart, onTouchMove, onTouchEnd', () => {
    const props = result.current.getSwipeProps('a');

    expect(props).toHaveProperty('onTouchStart');
    expect(props).toHaveProperty('onTouchMove');
    expect(props).toHaveProperty('onTouchEnd');
    expect(typeof props.onTouchStart).toBe('function');
    expect(typeof props.onTouchMove).toBe('function');
    expect(typeof props.onTouchEnd).toBe('function');
  });

  it('getSwipeProps("a") return value includes onMouseDown, onMouseMove, onMouseUp', () => {
    const props = result.current.getSwipeProps('a');

    expect(props).toHaveProperty('onMouseDown');
    expect(props).toHaveProperty('onMouseMove');
    expect(props).toHaveProperty('onMouseUp');
    expect(typeof props.onMouseDown).toBe('function');
    expect(typeof props.onMouseMove).toBe('function');
    expect(typeof props.onMouseUp).toBe('function');
  });
});

describe('useSwipeDelete — config and direction lock', () => {
  it('default config uses 80px open width (snap sets translateX to -80px)', () => {
    const { result } = renderHook(() => useSwipeDelete());

    act(() => {
      result.current.getSwipeProps('a').onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });
    act(() => {
      result.current.getSwipeProps('a').onTouchMove({ touches: [{ clientX: 50 }] } as React.TouchEvent);
    });
    act(() => {
      result.current.getSwipeProps('a').onTouchEnd();
    });

    // Default openWidthPx=80; swipe of 50px > 40 (80/2) → snaps to 80px
    expect(result.current.getSwipeStyle('a').transform).toBe('translateX(-80px)');
  });

  it('custom openWidthPx config is respected: snap sets translateX to custom width', () => {
    const { result } = renderHook(() => useSwipeDelete({ openWidthPx: 160, maxDistancePx: 180 }));

    act(() => {
      result.current.getSwipeProps('a').onTouchStart({ touches: [{ clientX: 200 }] } as React.TouchEvent);
    });
    act(() => {
      result.current.getSwipeProps('a').onTouchMove({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });
    act(() => {
      result.current.getSwipeProps('a').onTouchEnd();
    });

    // swipe=100px > 80 (160/2) threshold → snaps to 160px
    expect(result.current.getSwipeStyle('a').transform).toBe('translateX(-160px)');
  });

  it('direction-lock: vertical drag (dy > dx * 1.5) does NOT translate the element', () => {
    const { result } = renderHook(() => useSwipeDelete());

    act(() => {
      result.current.getSwipeProps('a').onTouchStart({ touches: [{ clientX: 100, clientY: 200 }] } as unknown as React.TouchEvent);
    });
    // dy=30, dx=5 → dy > dx*1.5 → vertical lock
    act(() => {
      result.current.getSwipeProps('a').onTouchMove({ touches: [{ clientX: 95, clientY: 230 }] } as unknown as React.TouchEvent);
    });

    expect(result.current.getSwipeStyle('a').transform).toBe('translateX(-0px)');
  });

  it('direction-lock: horizontal drag (dx > dy * 1.5) DOES translate the element', () => {
    const { result } = renderHook(() => useSwipeDelete());

    act(() => {
      result.current.getSwipeProps('a').onTouchStart({ touches: [{ clientX: 100, clientY: 200 }] } as unknown as React.TouchEvent);
    });
    // dx=40, dy=2 → dx > dy*1.5 → horizontal lock
    act(() => {
      result.current.getSwipeProps('a').onTouchMove({ touches: [{ clientX: 60, clientY: 202 }] } as unknown as React.TouchEvent);
    });

    expect(result.current.getSwipeStyle('a').transform).toBe('translateX(-40px)');
  });

  it('close() resets swipedItemId to null', () => {
    const { result } = renderHook(() => useSwipeDelete());

    act(() => {
      result.current.getSwipeProps('a').onTouchStart({ touches: [{ clientX: 100 }] } as React.TouchEvent);
    });
    act(() => {
      result.current.close();
    });

    expect(result.current.swipedItemId).toBeNull();
    expect(result.current.getSwipeStyle('a').transform).toBe('translateX(-0px)');
  });
});

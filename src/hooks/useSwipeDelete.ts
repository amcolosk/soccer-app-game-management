import { useState, useRef } from 'react';
import { UI_CONSTANTS } from '../constants/ui';

interface SwipeConfig {
  openWidthPx?: number;
  maxDistancePx?: number;
}

export interface SwipeActionState {
  getSwipeProps: (itemId: string) => {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
  };
  getSwipeStyle: (itemId: string) => {
    transform: string;
    transition: string;
  };
  close: () => void;
  swipedItemId: string | null;
}

export function useSwipeActions(config?: SwipeConfig): SwipeActionState {
  const openWidthPx = config?.openWidthPx ?? UI_CONSTANTS.SWIPE.OPEN_WIDTH_PX;
  const maxDistancePx = config?.maxDistancePx ?? UI_CONSTANTS.SWIPE.MAX_DISTANCE_PX;

  const [swipedItemId, setSwipedItemId] = useState<string | null>(null);
  const [swipeStartX, setSwipeStartX] = useState(0);
  const [swipeCurrentX, setSwipeCurrentX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const directionLocked = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');

  const handleStart = (clientX: number, clientY: number | undefined, itemId: string) => {
    setSwipeStartX(clientX);
    setSwipedItemId(itemId);
    setSwipeCurrentX(0);
    if (clientY !== undefined) {
      setTouchStartY(clientY);
    }
    directionLocked.current = 'undecided';
  };

  const handleMove = (clientX: number, clientY?: number) => {
    if (swipedItemId === null || swipeStartX === 0) return;

    if (clientY !== undefined) {
      if (directionLocked.current === 'vertical') {
        return;
      }
      if (directionLocked.current === 'undecided') {
        const dx = Math.abs(swipeStartX - clientX);
        const dy = Math.abs(touchStartY - clientY);
        if (dy > dx * 1.5) {
          directionLocked.current = 'vertical';
          return;
        } else if (dx > dy * 1.5) {
          directionLocked.current = 'horizontal';
        }
        // Until locked, allow slight translation (existing behavior)
      }
    }

    const diff = swipeStartX - clientX;
    if (diff > 0 && diff <= maxDistancePx) {
      setSwipeCurrentX(diff);
    }
  };

  const handleEnd = () => {
    if (swipeCurrentX > openWidthPx / 2) {
      setSwipeCurrentX(openWidthPx);
    } else {
      setSwipeCurrentX(0);
      setSwipedItemId(null);
    }
    setSwipeStartX(0);
    directionLocked.current = 'undecided';
  };

  const close = () => {
    setSwipeCurrentX(0);
    setSwipedItemId(null);
    setSwipeStartX(0);
    directionLocked.current = 'undecided';
  };

  const getSwipeProps = (itemId: string) => ({
    onTouchStart: (e: React.TouchEvent) => handleStart(e.touches[0].clientX, e.touches[0].clientY, itemId),
    onTouchMove: (e: React.TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: handleEnd,
    onMouseDown: (e: React.MouseEvent) => handleStart(e.clientX, undefined, itemId),
    onMouseMove: (e: React.MouseEvent) => handleMove(e.clientX, undefined),
    onMouseUp: handleEnd,
    onMouseLeave: handleEnd,
  });

  const getSwipeStyle = (itemId: string) => ({
    transform: `translateX(-${swipedItemId === itemId ? swipeCurrentX : 0}px)`,
    transition: swipeStartX === 0 ? 'transform 0.3s ease' : 'none',
  });

  return { getSwipeProps, getSwipeStyle, close, swipedItemId };
}

export function useSwipeDelete(config?: SwipeConfig): SwipeActionState {
  return useSwipeActions(config);
}

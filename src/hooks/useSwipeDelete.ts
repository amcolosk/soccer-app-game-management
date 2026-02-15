import { useState } from 'react';
import { UI_CONSTANTS } from '../constants/ui';

export function useSwipeDelete() {
  const [swipedItemId, setSwipedItemId] = useState<string | null>(null);
  const [swipeStartX, setSwipeStartX] = useState(0);
  const [swipeCurrentX, setSwipeCurrentX] = useState(0);

  const handleStart = (clientX: number, itemId: string) => {
    setSwipeStartX(clientX);
    setSwipedItemId(itemId);
    setSwipeCurrentX(0);
  };

  const handleMove = (clientX: number) => {
    if (swipedItemId === null || swipeStartX === 0) return;
    const diff = swipeStartX - clientX;
    if (diff > 0 && diff <= UI_CONSTANTS.SWIPE.MAX_DISTANCE_PX) {
      setSwipeCurrentX(diff);
    }
  };

  const handleEnd = () => {
    if (swipeCurrentX > UI_CONSTANTS.SWIPE.THRESHOLD_PX) {
      setSwipeCurrentX(UI_CONSTANTS.SWIPE.OPEN_WIDTH_PX);
    } else {
      setSwipeCurrentX(0);
      setSwipedItemId(null);
    }
    setSwipeStartX(0);
  };

  const close = () => {
    setSwipeCurrentX(0);
    setSwipedItemId(null);
    setSwipeStartX(0);
  };

  const getSwipeProps = (itemId: string) => ({
    onTouchStart: (e: React.TouchEvent) => handleStart(e.touches[0].clientX, itemId),
    onTouchMove: (e: React.TouchEvent) => handleMove(e.touches[0].clientX),
    onTouchEnd: handleEnd,
    onMouseDown: (e: React.MouseEvent) => handleStart(e.clientX, itemId),
    onMouseMove: (e: React.MouseEvent) => handleMove(e.clientX),
    onMouseUp: handleEnd,
    onMouseLeave: handleEnd,
  });

  const getSwipeStyle = (itemId: string) => ({
    transform: `translateX(-${swipedItemId === itemId ? swipeCurrentX : 0}px)`,
    transition: swipeStartX === 0 ? 'transform 0.3s ease' : 'none',
  });

  return { getSwipeProps, getSwipeStyle, close, swipedItemId };
}

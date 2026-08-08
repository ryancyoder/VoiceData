import { useRef, useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';

/**
 * 2D joystick pad for moving the selected plant.
 * Floats in the bottom-right of the canvas area.
 * Drag the thumb to continuously nudge the plant in any direction.
 * The further you drag from center, the faster it moves.
 * Like the Feather app's movement control.
 */
export function MovementJoystick() {
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const stamps = useProjectStore((s) => s.stamps);
  const updateStamp = useProjectStore((s) => s.updateStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);
  const stageScale = useProjectStore((s) => s.stageScale);

  const padRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [thumbOffset, setThumbOffset] = useState({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);
  const velocityRef = useRef({ x: 0, y: 0 });
  const hasRecordedHistory = useRef(false);

  const stamp = stamps.find((s) => s.id === selectedStampId);

  const PAD_SIZE = 140;
  const THUMB_SIZE = 52;
  const MAX_OFFSET = (PAD_SIZE - THUMB_SIZE) / 2;
  // Movement speed: pixels per frame at max joystick deflection
  const SPEED = 1.5 / stageScale; // Compensate for stage zoom

  // Continuous movement loop — runs while joystick is held
  useEffect(() => {
    if (!isDragging || !selectedStampId) return;

    const moveLoop = () => {
      const vx = velocityRef.current.x;
      const vy = velocityRef.current.y;

      if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
        const currentStamp = useProjectStore.getState().stamps.find((s) => s.id === selectedStampId);
        if (currentStamp) {
          updateStamp(selectedStampId, {
            x: currentStamp.x + vx * SPEED,
            y: currentStamp.y + vy * SPEED,
          });
        }
      }

      animFrameRef.current = requestAnimationFrame(moveLoop);
    };

    animFrameRef.current = requestAnimationFrame(moveLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isDragging, selectedStampId, updateStamp, SPEED]);

  const getOffset = useCallback(
    (clientX: number, clientY: number) => {
      if (!padRef.current) return { x: 0, y: 0 };
      const rect = padRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let dx = clientX - centerX;
      let dy = clientY - centerY;

      // Clamp to circular bounds
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_OFFSET) {
        dx = (dx / dist) * MAX_OFFSET;
        dy = (dy / dist) * MAX_OFFSET;
      }

      return { x: dx, y: dy };
    },
    [MAX_OFFSET]
  );

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      if (!hasRecordedHistory.current) {
        pushHistory();
        hasRecordedHistory.current = true;
      }
      setIsDragging(true);
      const offset = getOffset(clientX, clientY);
      setThumbOffset(offset);
      velocityRef.current = {
        x: offset.x / MAX_OFFSET,
        y: offset.y / MAX_OFFSET,
      };
    },
    [getOffset, MAX_OFFSET, pushHistory]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;
      const offset = getOffset(clientX, clientY);
      setThumbOffset(offset);
      velocityRef.current = {
        x: offset.x / MAX_OFFSET,
        y: offset.y / MAX_OFFSET,
      };
    },
    [isDragging, getOffset, MAX_OFFSET]
  );

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    setThumbOffset({ x: 0, y: 0 });
    velocityRef.current = { x: 0, y: 0 };
    hasRecordedHistory.current = false;
  }, []);

  // Touch events
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    },
    [handleStart]
  );

  // Mouse events
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleStart(e.clientX, e.clientY);
    },
    [handleStart]
  );

  // Global move/end listeners
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      handleMove(clientX, clientY);
    };

    const onEnd = () => handleEnd();

    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('mouseup', onEnd);

    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('mouseup', onEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  if (!stamp) return null;

  // Directional arrows for visual feedback
  const arrowOpacity = isDragging ? 0.8 : 0.3;

  return (
    <div
      className="absolute right-3 bottom-16 z-20 select-none"
      style={{ WebkitTouchCallout: 'none' }}
    >
      {/* Direction label */}
      <div className={`text-center text-[11px] font-semibold mb-2 px-2 py-0.5 rounded-full mx-auto w-fit ${
        isDragging ? 'bg-blue-500 text-white' : 'bg-black/40 text-white'
      }`}>
        Move
      </div>

      {/* Joystick pad */}
      <div
        ref={padRef}
        className="relative rounded-full bg-black/20 backdrop-blur-sm border border-white/20"
        style={{ width: PAD_SIZE, height: PAD_SIZE }}
        onTouchStart={onTouchStart}
        onMouseDown={onMouseDown}
      >
        {/* Direction arrows */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={PAD_SIZE}
          height={PAD_SIZE}
          viewBox={`0 0 ${PAD_SIZE} ${PAD_SIZE}`}
        >
          {/* Up arrow */}
          <path
            d={`M${PAD_SIZE / 2} 12 l-6 10 h12 z`}
            fill="white"
            opacity={arrowOpacity}
          />
          {/* Down arrow */}
          <path
            d={`M${PAD_SIZE / 2} ${PAD_SIZE - 12} l-6 -10 h12 z`}
            fill="white"
            opacity={arrowOpacity}
          />
          {/* Left arrow */}
          <path
            d={`M12 ${PAD_SIZE / 2} l10 -6 v12 z`}
            fill="white"
            opacity={arrowOpacity}
          />
          {/* Right arrow */}
          <path
            d={`M${PAD_SIZE - 12} ${PAD_SIZE / 2} l-10 -6 v12 z`}
            fill="white"
            opacity={arrowOpacity}
          />
        </svg>

        {/* Center crosshair */}
        <div
          className="absolute rounded-full border border-white/20"
          style={{
            width: 8,
            height: 8,
            left: PAD_SIZE / 2 - 4,
            top: PAD_SIZE / 2 - 4,
          }}
        />

        {/* Draggable thumb */}
        <div
          className={`absolute rounded-full border-2 shadow-lg transition-colors ${
            isDragging ? 'bg-blue-500 border-white' : 'bg-white border-blue-400'
          }`}
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            left: PAD_SIZE / 2 - THUMB_SIZE / 2 + thumbOffset.x,
            top: PAD_SIZE / 2 - THUMB_SIZE / 2 + thumbOffset.y,
            transition: isDragging ? 'none' : 'all 0.2s ease-out',
          }}
        >
          {/* Cross icon in thumb */}
          <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 52 52">
            <line x1="18" y1="26" x2="34" y2="26" stroke={isDragging ? 'white' : '#93c5fd'} strokeWidth="2" strokeLinecap="round" />
            <line x1="26" y1="18" x2="26" y2="34" stroke={isDragging ? 'white' : '#93c5fd'} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

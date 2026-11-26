import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

interface ResizeHandleProps {
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  reverse?: boolean;
  onDragging?: (dragging: boolean) => void;
}

export function ResizeHandle({ axis, value, min, max, onChange, label, reverse = false, onDragging }: ResizeHandleProps) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onDraggingRef = useRef(onDragging);
  const cleanupRef = useRef<(() => void) | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onDraggingRef.current = onDragging;

  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)));
  const stopDragging = () => {
    const active = cleanupRef.current !== null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (active) onDraggingRef.current?.(false);
  };

  useEffect(() => () => stopDragging(), []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    stopDragging();

    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startPosition = axis === 'x' ? event.clientX : event.clientY;
    const startValue = valueRef.current;
    element.setPointerCapture(pointerId);
    onDraggingRef.current?.(true);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      onChangeRef.current(clamp(startValue + (position - startPosition) * (reverse ? -1 : 1)));
    };
    const handlePointerEnd = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId === pointerId) stopDragging();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    };
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = axis === 'x' ? 'ArrowLeft' : reverse ? 'ArrowDown' : 'ArrowUp';
    const increase = axis === 'x' ? 'ArrowRight' : reverse ? 'ArrowUp' : 'ArrowDown';
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    onChange(clamp(valueRef.current + (event.key === increase ? step : -step)));
  };

  return <div
    className={`resize-handle resize-${axis}`}
    role="separator"
    aria-label={label}
    aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    tabIndex={0}
    onPointerDown={handlePointerDown}
    onKeyDown={handleKeyDown}
  />;
}

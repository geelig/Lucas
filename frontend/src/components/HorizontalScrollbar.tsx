import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

interface ScrollInput { viewport: number; content: number; track: number; scrollLeft: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function horizontalThumb({ viewport, content, track, scrollLeft }: ScrollInput) {
  const max = Math.max(0, content - viewport);
  const visible = max > 1 && track > 0;
  const thumb = visible ? clamp(track * viewport / content, 36, 140) : Math.min(140, track);
  const travel = Math.max(0, track - thumb);
  const left = visible ? clamp(scrollLeft / max, 0, 1) * travel : travel / 2;
  return { max, visible, thumb, left, travel };
}

export function scrollLeftAtThumb(left: number, input: ScrollInput): number {
  const geometry = horizontalThumb(input);
  return geometry.travel > 0 ? clamp(left / geometry.travel, 0, 1) * geometry.max : 0;
}

export function HorizontalScrollbar({ target, targetId, label, refreshKey = 0 }: {
  target: RefObject<HTMLElement | null>; targetId: string; label: string; refreshKey?: unknown;
}) {
  const track = useRef<HTMLInputElement>(null);
  const [metrics, setMetrics] = useState({ viewport: 0, content: 0, track: 0, scrollLeft: 0 });
  const geometry = horizontalThumb(metrics);

  useEffect(() => {
    const element = target.current;
    const trackElement = track.current;
    if (!trackElement) return;
    const update = () => {
      const next = {
        viewport: element?.clientWidth ?? 0,
        content: element?.scrollWidth ?? 0,
        track: trackElement.clientWidth,
        scrollLeft: element?.scrollLeft ?? 0,
      };
      setMetrics((current) => Object.keys(next).every((key) => current[key as keyof typeof current] === next[key as keyof typeof next]) ? current : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(trackElement);
    const observeChildren = () => Array.from(element?.children ?? []).forEach((child) => observer.observe(child));
    if (element) { observer.observe(element); observeChildren(); element.addEventListener('scroll', update, { passive: true }); }
    const mutations = new MutationObserver(() => { observeChildren(); update(); });
    if (element) mutations.observe(element, { childList: true, subtree: true });
    update();
    return () => { observer.disconnect(); mutations.disconnect(); element?.removeEventListener('scroll', update); };
  }, [target, refreshKey]);

  return <input
    ref={track}
    className={`panel-horizontal-scrollbar${geometry.visible ? '' : ' disabled'}`}
    style={{ '--scroll-thumb-width': `${geometry.thumb}px` } as CSSProperties}
    type="range"
    min={0}
    max={Math.max(1, Math.round(geometry.max))}
    step={1}
    value={Math.round(metrics.scrollLeft)}
    role="scrollbar"
    aria-label={label}
    aria-controls={targetId}
    aria-orientation="horizontal"
    disabled={!geometry.visible}
    onPointerDown={(event) => event.stopPropagation()}
    onInput={(event) => { if (target.current) target.current.scrollLeft = event.currentTarget.valueAsNumber; }}
    onChange={(event) => { if (target.current) target.current.scrollLeft = event.currentTarget.valueAsNumber; }}
  />;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VIEW, type Rect } from './diagram/layout.ts';
import { WALKTHROUGH } from './walkthrough.ts';

/** Viewbox rect → screen rect, for the diagram's `preserveAspectRatio="xMidYMid meet"`. */
function toScreen(r: Rect): { left: number; top: number; right: number; bottom: number } | null {
  const svg = document.querySelector<SVGSVGElement>('svg.diagram');
  if (!svg) return null;
  const b = svg.getBoundingClientRect();
  const s = Math.min(b.width / VIEW.w, b.height / VIEW.h);
  const ox = b.left + (b.width - VIEW.w * s) / 2;
  const oy = b.top + (b.height - VIEW.h * s) / 2;
  return { left: ox + r.x * s, top: oy + r.y * s, right: ox + (r.x + r.w) * s, bottom: oy + (r.y + r.h) * s };
}

/**
 * WALK-1..5: the caption card for the current walkthrough step. It sits beside the spotlit area
 * (or centred when nothing is spotlit) and stays on screen.
 */
export function WalkCard(props: { index: number; rect: Rect | undefined; onGo: (i: number) => void; onClose: (start: boolean) => void }) {
  const { index, rect, onGo, onClose } = props;
  const step = WALKTHROUGH[index]!;
  const last = index === WALKTHROUGH.length - 1;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const a = rect ? toScreen(rect) : null;
      if (!a) {
        setPos({ left: (innerWidth - w) / 2, top: Math.max(8, (innerHeight - h) / 2) });
        return;
      }
      const gap = 14;
      // Prefer the right of the spotlight, then the left, then below, then above; clamp to the window.
      let left: number;
      let top = a.top;
      if (a.right + gap + w <= innerWidth - 8) left = a.right + gap;
      else if (a.left - gap - w >= 8) left = a.left - gap - w;
      else {
        left = (a.left + a.right) / 2 - w / 2;
        top = a.bottom + gap + h <= innerHeight - 8 ? a.bottom + gap : a.top - gap - h;
      }
      setPos({ left: Math.max(8, Math.min(left, innerWidth - w - 8)), top: Math.max(8, Math.min(top, innerHeight - h - 8)) });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [index, rect?.x, rect?.y, rect?.w, rect?.h]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (last) onClose(true);
        else onGo(index + 1);
      } else if (e.key === 'ArrowLeft' && index > 0) onGo(index - 1);
      else if (e.key === 'Escape') onClose(false);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [index, last, onGo, onClose]);

  return (
    <div className={`walk-card ${step.kind.toLowerCase()}`} ref={ref} style={pos ?? { visibility: 'hidden' }} role="dialog" aria-label="Walkthrough" aria-live="polite">
      <div className="walk-head">
        <span className="walk-kind">{step.kind}</span>
        <span className="walk-count mono">
          {index + 1} / {WALKTHROUGH.length}
        </span>
      </div>
      <h2>{step.title}</h2>
      <p>{step.body}</p>
      <div className="walk-progress" aria-hidden>
        <i style={{ width: `${((index + 1) / WALKTHROUGH.length) * 100}%` }} />
      </div>
      <div className="walk-actions">
        {!last && (
          <button className="link" onClick={() => onClose(false)}>
            Skip
          </button>
        )}
        <span className="grow" />
        {index > 0 && <button onClick={() => onGo(index - 1)}>Back</button>}
        {last ? (
          <>
            <button onClick={() => onClose(false)}>Stay paused</button>
            <button className="primary" autoFocus onClick={() => onClose(true)}>
              Start the simulation
            </button>
          </>
        ) : (
          <button className="primary" autoFocus onClick={() => onGo(index + 1)}>
            {index === 0 ? 'Begin' : 'Next'}
          </button>
        )}
      </div>
      <div className="walk-hint muted">← → to move · Esc to leave</div>
    </div>
  );
}

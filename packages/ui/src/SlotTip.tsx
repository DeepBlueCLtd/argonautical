import { STANDARDS, clockLabel } from '@argonautical/sim';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SlotTip } from './diagram/Diagram.tsx';
import type { Runner } from './runner.ts';

/**
 * MOT-7: a small document-like panel beside an input slot. It says what the document is, what its
 * reader uses it for, and whether it has arrived. Shown for empty slots too.
 */
export function SlotTipPanel({ tip, runner }: { tip: SlotTip; runner: Runner }) {
  const ref = useRef<HTMLDivElement>(null);
  const { decl: d, who, box } = tip;
  // Live: the panel updates if the document lands while it is open.
  const s = runner.slot(tip.reader, d.slot, tip.instance);
  const filled = s.state === 'filled' ? s.token : undefined;
  const [pos, setPos] = useState({ left: box.right + 10, top: box.top - 8 });

  // Beside the icon, flipped left or nudged up to stay on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = box.right + 10 + w <= innerWidth - 8 ? box.right + 10 : Math.max(8, box.left - 10 - w);
    const top = Math.max(8, Math.min(box.top - 8, innerHeight - h - 8));
    setPos({ left, top });
  }, [box.left, box.top, box.right, d.slot, who]);

  return (
    <div className={`slot-tip std-${d.standard}`} ref={ref} style={pos} role="tooltip">
      <div className="sheet">
      <div className="fold" aria-hidden />
      <header>
        <b className={`std-badge std-${d.standard}`}>{d.standard}</b>
        <span>
          <strong>{d.label}</strong>
          <small>
            {who} · {STANDARDS[d.standard]}
          </small>
        </span>
      </header>
      <dl>
        <dt>What it is</dt>
        <dd>{d.what}</dd>
        <dt>What it's for</dt>
        <dd>{d.use}</dd>
      </dl>
      <footer className={filled ? 'ok' : 'waiting'}>
        {filled ? (
          <>
            Received {clockLabel(filled.start)} · <em>click to open</em>
          </>
        ) : (
          <>Empty: waiting for it.{d.whenEmpty ? ` ${d.whenEmpty}` : ''}</>
        )}
      </footer>
      </div>
    </div>
  );
}

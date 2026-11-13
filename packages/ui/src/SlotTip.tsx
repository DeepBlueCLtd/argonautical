import { STANDARDS, clockLabel } from '@argonautical/sim';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SlotTip, TokenTip } from './diagram/Diagram.tsx';
import { kindOf, routeOf } from './TokenPopup.tsx';
import type { Runner } from './runner.ts';

/**
 * MOT-7: a small document-like panel beside an input slot. It says what the document is, what its
 * reader uses it for, and whether it has arrived. Shown for empty slots too.
 */
/**
 * A moving token's hover panel, in the same page style as the input slots: what it is, where it is
 * going and in what format. Opening the full data still needs a pause and a click (MOT-6).
 */
export function TokenTipPanel({ tip, frozen }: { tip: TokenTip; frozen: boolean }) {
  const t = tip.token;
  const p = t.payload;
  const std = p?.standard ?? 'D';
  // Follow the token while it moves: re-anchor to its current position every frame.
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: tip.box.right + 10, top: tip.box.top - 8 });
  useLayoutEffect(() => {
    const el = ref.current;
    const at = document.querySelector(`[data-seq="${t.seq}"]`)?.getBoundingClientRect() ?? tip.box;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = at.right + 12 + w <= innerWidth - 8 ? at.right + 12 : Math.max(8, at.left - 12 - w);
    const top = Math.max(8, Math.min(at.top - 8, innerHeight - h - 8));
    if (Math.abs(left - pos.left) > 0.5 || Math.abs(top - pos.top) > 0.5) setPos({ left, top });
  });
  return (
    <div className={`slot-tip std-${std}`} ref={ref} style={pos} role="tooltip">
      <div className="sheet">
        <div className="fold" aria-hidden />
        <header>
          <b className={`std-badge std-${std}`}>{std}</b>
          <span>
            <strong>{p?.summary ?? t.edge}</strong>
            <small>
              {kindOf(t)} · {routeOf(t)}
            </small>
          </span>
        </header>
        <dl>
          <dt>Standard</dt>
          <dd>{STANDARDS[std]}</dd>
          <dt>Format</dt>
          <dd>{p?.format ?? '—'}</dd>
        </dl>
        <footer className={frozen ? 'ok' : 'waiting'}>
          Sent {clockLabel(t.start)}
          {t.retry ? ' · retry' : ''} · {frozen ? <em>click to open</em> : 'pause, then click to open the data'}
        </footer>
      </div>
    </div>
  );
}

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

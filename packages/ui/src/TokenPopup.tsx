import { EDGES, clockLabel, element, type Token } from '@argonautical/sim';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const KIND: Record<string, string> = {
  send: 'Send',
  write: 'Write',
  read: 'Read (read only)',
  query: 'Query',
  call: 'Call',
  publish: 'Publish',
  deliver: 'Deliver',
  lineage: 'Lineage',
  trigger: 'Trigger',
};

/** Drill-down on one token: what moved along the arrow, in what format, with a mock data object. */
export function TokenPopup({ token, x, y, onClose }: { token: Token; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 });
  const edge = EDGES.find((e) => e.id === token.edge);
  const label = (id: string) => (id === 'consumer' && token.instance ? `Consumer ${token.instance}` : element(id as never).label);

  // Keep the popup on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x + 12, innerWidth - w - 8)), top: Math.max(8, Math.min(y + 12, innerHeight - h - 8)) });
  }, [x, y, token.seq]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);

  const p = token.payload;
  return (
    <div className="token-popup" ref={ref} style={pos} role="dialog" aria-label="What this token carries">
      <header>
        <span className={`kind ${edge?.kind ?? ''}`}>{KIND[edge?.kind ?? ''] ?? edge?.kind}</span>
        <span className="route">
          {edge ? `${label(edge.from)} → ${label(edge.to)}` : token.edge}
        </span>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="meta mono">
        {clockLabel(token.start)}
        {token.retry ? ' · retry' : ''}
      </div>
      {p ? (
        <>
          <p className="summary">{p.summary}</p>
          <p className="format">{p.format}</p>
          <pre className="data">{JSON.stringify(p.data, null, 2)}</pre>
          <p className="note">Mock data: the values are the simulation's, the format is illustrative.</p>
        </>
      ) : (
        <p className="summary">No payload recorded.</p>
      )}
    </div>
  );
}

/**
 * SVG shapes drawn by hand. Each keeps a crisp host shape for the fill and hit area (its stroke is
 * hidden by `.sk-host`) and adds a sketchy stroke path (`.sk`). Both carry the same classes, so the
 * existing CSS colours both; selectors that name `rect` or `circle` also match `.sk-r` / `.sk-c`.
 */
import type { CSSProperties, SVGProps } from 'react';
import { sketchCircle, sketchLine, sketchRect } from './sketch.ts';

const cx = (...c: (string | undefined | false)[]) => c.filter(Boolean).join(' ');

type Shared = { className?: string; state?: string; style?: CSSProperties; opacity?: number; transform?: string; strokeDasharray?: string };

export function SRect({ x, y, width, height, rx = 0, className, state, style, opacity, transform, strokeDasharray, ...rest }: Shared & { x: number; y: number; width: number; height: number; rx?: number } & Omit<SVGProps<SVGRectElement>, keyof Shared | 'x' | 'y' | 'width' | 'height' | 'rx'>) {
  const shared = { style, opacity, transform, strokeDasharray };
  return (
    <>
      <rect x={x} y={y} width={width} height={height} rx={rx} className={cx(className, 'sk-host')} {...shared} {...rest} />
      <path d={sketchRect(x, y, width, height, rx, state ?? className ?? '')} className={cx(className, 'sk', 'sk-r')} {...shared} />
    </>
  );
}

export function SCircle({ cx: x, cy: y, r, className, state, style, opacity, transform, ...rest }: Shared & { cx: number; cy: number; r: number } & Omit<SVGProps<SVGCircleElement>, keyof Shared | 'cx' | 'cy' | 'r'>) {
  const shared = { style, opacity, transform };
  return (
    <>
      <circle cx={x} cy={y} r={r} className={cx(className, 'sk-host')} {...shared} {...rest} />
      <path d={sketchCircle(x, y, r, state ?? className ?? '')} className={cx(className, 'sk', 'sk-c')} {...shared} />
    </>
  );
}

/** A straight line drawn by hand. */
export function SLine({ x1, y1, x2, y2, className, state }: { x1: number; y1: number; x2: number; y2: number; className?: string; state?: string }) {
  return <path d={sketchLine(`M${x1},${y1} L${x2},${y2}`, state)} className={className} />;
}

/** D5: faint engineering grid behind the diagram, in diagram units so it scales with it. */
export function Paper({ w, h }: { w: number; h: number }) {
  return (
    <>
      <defs>
        <pattern id="paper-minor" width={10} height={10} patternUnits="userSpaceOnUse">
          <path d="M10,0 V10 H0" className="grid-minor" />
        </pattern>
        <pattern id="paper-major" width={50} height={50} patternUnits="userSpaceOnUse">
          <rect width={50} height={50} fill="url(#paper-minor)" />
          <path d="M50,0 V50 H0" className="grid-major" />
        </pattern>
      </defs>
      <rect className="paper" width={w} height={h} fill="url(#paper-major)" />
    </>
  );
}

/** Legend swatches, drawn with the same sketch functions as the diagram they explain. */
export function Swatch({ kind }: { kind: 'ours' | 'ots' | 'store' | 'mat' | 'retry' | 'offline' | 'release' | 'check' }) {
  return (
    <svg className={`sk-sw ${kind}`} viewBox="0 0 18 12" aria-hidden>
      {kind === 'release' || kind === 'check' ? (
        <SLine x1={1} y1={6} x2={17} y2={6} state={kind} />
      ) : kind === 'store' ? (
        <>
          <SRect x={1} y={1} width={16} height={10} rx={2} state="sw-store" />
          <SRect x={3.5} y={3.5} width={11} height={5} rx={1} state="sw-store-in" />
        </>
      ) : (
        <SRect x={1} y={1} width={16} height={10} rx={2} state={`sw-${kind}`} />
      )}
    </svg>
  );
}

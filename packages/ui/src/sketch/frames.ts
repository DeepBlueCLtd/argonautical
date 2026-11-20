/**
 * Hand-drawn frames for HTML (popups, buttons): a sketchy rounded rectangle drawn once at start-up
 * and used as a 9-slice border-image, so no per-element SVG or observers are needed.
 */
import { sketchRect } from './sketch.ts';

function frame(stroke: string, width: number, seed: string): string {
  const d = sketchRect(4, 4, 56, 56, 7, seed);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><path d='${d}' fill='none' stroke='${stroke}' stroke-width='${width}' stroke-linecap='round'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function installSketchFrames(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--sk-frame', frame('#7f8b97', 1.6, 'frame'));
  root.style.setProperty('--sk-btn', frame('#7f8b97', 2, 'button'));
  root.style.setProperty('--sk-btn-ink', frame('#1f2933', 2.2, 'button-ink'));
}

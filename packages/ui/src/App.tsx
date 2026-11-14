import { MAX_INPUTS, MIN_INPUTS } from '@argonautical/sim';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Diagram, type Picked, type SlotTip, type TokenTip } from './diagram/Diagram.tsx';
import { PhysicalDiagram, type InspectId } from './diagram/PhysicalDiagram.tsx';
import { StoreInspector } from './StoreInspector.tsx';
import { SlotTipPanel, TokenTipPanel } from './SlotTip.tsx';
import { TokenPopup } from './TokenPopup.tsx';
import { Runner } from './runner.ts';
import { WalkCard } from './Walkthrough.tsx';
import { WALKTHROUGH } from './walkthrough.ts';

const params = new URLSearchParams(location.search);

function useRunner(): Runner {
  const ref = useRef<Runner>();
  if (!ref.current) {
    const inputs = Number(params.get('inputs') ?? 4);
    ref.current = new Runner(params.get('seed') ?? 'demo', inputs >= MIN_INPUTS && inputs <= MAX_INPUTS ? inputs : 4);
    // WALK-1: the app opens paused at T+00:00 while the walkthrough runs.
    if (WALK_ON) ref.current.running = false;
  }
  return ref.current;
}

/** WALK-1: the walkthrough opens by default; `?walkthrough=off` skips it (`?tour=` is kept for TOUR-1's scenario tours). */
const WALK_ON = params.get('walkthrough') !== 'off';

/** Re-render every animation frame while the runner advances. */
function useFrame(runner: Runner): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      runner.frame((now - last) / 1000);
      last = now;
      setN((x) => (x + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runner]);
  return n;
}

export function App() {
  const runner = useRunner();
  useFrame(runner);
  useSyncExternalStore(
    (fn) => runner.subscribe(fn),
    () => runner.sim,
  );
  const [logOpen, setLogOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [tip, setTip] = useState<SlotTip | null>(null);
  const [tokenTip, setTokenTip] = useState<TokenTip | null>(null);
  const [walk, setWalk] = useState<number | null>(WALK_ON && params.get('view') !== 'physical' ? 0 : null);
  // SYS-1: the view is presentation only; switching never touches the simulation.
  const [view, setView] = useState<'logical' | 'physical'>(params.get('view') === 'physical' ? 'physical' : 'logical');
  const [inspecting, setInspecting] = useState<InspectId | null>(null);
  const changeView = (v: 'logical' | 'physical') => {
    setView(v);
    setInspecting(null);
    setTip(null);
    setTokenTip(null);
    const u = new URL(location.href);
    if (v === 'physical') u.searchParams.set('view', 'physical');
    else u.searchParams.delete('view');
    history.replaceState(null, '', u);
  };
  const walkStep = walk === null ? undefined : WALKTHROUGH[walk];
  const spotlight = walkStep ? (walkStep.rect?.(runner.sim.consumers.length) ?? null) : undefined;
  const startWalk = () => {
    // The walkthrough introduces the logical view.
    if (view !== 'logical') changeView('logical');
    runner.setRunning(false);
    setPicked(null);
    setWalk(0);
  };
  // Space: run / pause (not while typing, and not while the walkthrough is open).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || walk !== null) return;
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement || t.getAttribute('role')) return;
      e.preventDefault();
      runner.setRunning(!runner.running);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [runner, walk]);
  const endWalk = (start: boolean) => {
    setWalk(null);
    if (start) runner.setRunning(true);
  };
  const snap = runner.sim.snapshot();
  const controls = { logOpen, onLog: () => setLogOpen(!logOpen), onWalkthrough: startWalk, view, onView: changeView };

  return (
    <div className="app">
      <main className="stage">
        {view === 'logical' ? (
          <Diagram snap={snap} runner={runner} onPick={setPicked} onTip={setTip} onTokenTip={setTokenTip} spotlight={spotlight} controls={controls} />
        ) : (
          <PhysicalDiagram snap={snap} runner={runner} onPick={setPicked} onTokenTip={setTokenTip} controls={controls} inspecting={inspecting} onInspect={(id) => setInspecting(inspecting === id ? null : id)} />
        )}
        {runner.frozen && !picked && walk === null && (
          <div className="inspect-hint">{runner.tokens.length ? 'Paused · click a dot to see what it carries' : 'Paused · press Step to send one tick of tokens, then click a dot'}</div>
        )}
        <Legend />
      </main>
      {walk !== null && <WalkCard index={walk} rect={spotlight ?? undefined} onGo={setWalk} onClose={endWalk} />}
      {logOpen && <EventLogPanel runner={runner} onClose={() => setLogOpen(false)} />}
      {view === 'physical' && inspecting && <StoreInspector id={inspecting} sim={runner.sim} onClose={() => setInspecting(null)} />}
      {tip && !picked && <SlotTipPanel tip={tip} runner={runner} />}
      {/* A token's panel goes when the token arrives (it is no longer on screen). */}
      {tokenTip && !picked && !tip && runner.tokens.some(({ v }) => v.token.seq === tokenTip.token.seq) && <TokenTipPanel tip={tokenTip} frozen={runner.frozen} />}
      {picked && (runner.frozen || picked.fromSlot) && <TokenPopup token={picked.token} x={picked.x} y={picked.y} onClose={() => setPicked(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span>
        <i className="sw ours" /> ours (build)
      </span>
      <span>
        <i className="sw ots" /> off-the-shelf (adopt), mocked
      </span>
      <span>
        <i className="sw store" /> our data store
      </span>
      <span>
        <i className="sw mat" /> materialising
      </span>
      <span>
        <i className="sw retry" /> retry
      </span>
      <span>
        <i className="sw offline" /> offline
      </span>
      <span title="An upstream asset was just materialised, which lets the next step start">
        <i className="sw release" /> dependency releases next step
      </span>
      <span title="At run start: the upstream was already there (a dependency, never a trigger)">
        <i className="sw check" /> dependency checked
      </span>
    </div>
  );
}

/** UI-7: popup, newest first, with the event count. */
function EventLogPanel({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const entries = runner.sim.log.entries;
  const shown = entries.slice(-400).reverse();
  return (
    <aside className="eventlog" role="dialog" aria-label="Event log">
      <header>
        <strong>Event log</strong> <span className="muted">{entries.length} events, newest first · seed {runner.sim.seed} · digest <span className="mono">{runner.sim.log.digest}</span></span>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <ol>
        {shown.map((e, i) => (
          <li key={entries.length - i} className={`ev ${e.kind}`}>
            <span className="mono t">{`T+${String(Math.floor(e.tick / 60)).padStart(2, '0')}:${String(e.tick % 60).padStart(2, '0')}`}</span>
            <span className="k">{e.kind}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

import { DRIFT_BOUNDS, MAX_INPUTS, MIN_INPUTS, NOISE_BOUNDS, type ControlAction, type Snapshot } from '@argonautical/sim';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Diagram, type Picked, type SlotTip, type TokenTip } from './diagram/Diagram.tsx';
import { SlotTipPanel, TokenTipPanel } from './SlotTip.tsx';
import { TokenPopup } from './TokenPopup.tsx';
import { VIEW } from './diagram/layout.ts';
import boundary from './generated/boundary.json';
import { Runner, type Rate } from './runner.ts';
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

type Layout = 'side' | 'bottom';
const layoutParam = params.get('layout');

/**
 * Put the scenario/operator controls in a left sidebar or a bottom strip, whichever leaves the
 * diagram bigger (UI-6). On each resize the page is laid out with the strip, the strip's real
 * height is measured, and the sidebar is chosen if it would give a larger diagram. This all
 * happens before paint, so there is no flicker. `?layout=side|bottom` forces one.
 */
const SIDEBAR = 270;

function sideWins(): boolean {
  const w = innerWidth;
  const h = innerHeight;
  const top = (document.querySelector<HTMLElement>('.bar')?.offsetHeight ?? 52) + (document.querySelector<HTMLElement>('.banner')?.offsetHeight ?? 26);
  const strip = document.querySelector<HTMLElement>('.controls')?.offsetHeight ?? 120;
  const side = Math.min((w - SIDEBAR - 16) / VIEW.w, (h - top - 8) / VIEW.h);
  const bottom = Math.min((w - 16) / VIEW.w, (h - top - strip - 8) / VIEW.h);
  return side > bottom * 1.03;
}

function useLayout(inputs: number): Layout {
  const [layout, setLayout] = useState<Layout>('bottom');
  const [measuring, setMeasuring] = useState(true);
  useLayoutEffect(() => {
    if (!measuring) return;
    setLayout(layoutParam === 'side' || layoutParam === 'bottom' ? layoutParam : sideWins() ? 'side' : 'bottom');
    setMeasuring(false);
  }, [measuring]);
  useEffect(() => {
    const remeasure = () => {
      setLayout('bottom');
      setMeasuring(true);
    };
    addEventListener('resize', remeasure);
    return () => removeEventListener('resize', remeasure);
  }, []);
  // The strip's height depends on how many inputs there are.
  useEffect(() => {
    setLayout('bottom');
    setMeasuring(true);
  }, [inputs]);
  return layout;
}

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
  const [walk, setWalk] = useState<number | null>(WALK_ON ? 0 : null);
  const walkStep = walk === null ? undefined : WALKTHROUGH[walk];
  const spotlight = walkStep ? (walkStep.rect?.(runner.sim.consumers.length) ?? null) : undefined;
  const startWalk = () => {
    runner.setRunning(false);
    setPicked(null);
    setWalk(0);
  };
  const endWalk = (start: boolean) => {
    setWalk(null);
    if (start) runner.setRunning(true);
  };
  const layout = useLayout(runner.sim.inputs.length);
  const snap = runner.sim.snapshot();
  const act = (a: ControlAction) => runner.apply(a);

  return (
    <div className={`app ${layout}`}>
      <PresenterBar runner={runner} snap={snap} logOpen={logOpen} setLogOpen={setLogOpen} onWalkthrough={startWalk} />
      <Banner snap={snap} />
      <main className="stage">
        <Diagram snap={snap} runner={runner} onPick={setPicked} onTip={setTip} onTokenTip={setTokenTip} spotlight={spotlight} />
        {runner.frozen && !picked && walk === null && (
          <div className="inspect-hint">{runner.tokens.length ? 'Paused · click a dot to see what it carries' : 'Paused · press Step to send one tick of tokens, then click a dot'}</div>
        )}
        <Legend />
      </main>
      <footer className="controls">
        <ScenarioPanel snap={snap} act={act} />
        <OperatorPanel snap={snap} act={act} />
      </footer>
      {walk !== null && <WalkCard index={walk} rect={spotlight ?? undefined} onGo={setWalk} onClose={endWalk} />}
      {logOpen && <EventLogPanel runner={runner} onClose={() => setLogOpen(false)} />}
      {tip && !picked && <SlotTipPanel tip={tip} runner={runner} />}
      {/* A token's panel goes when the token arrives (it is no longer on screen). */}
      {tokenTip && !picked && !tip && runner.tokens.some(({ v }) => v.token.seq === tokenTip.token.seq) && <TokenTipPanel tip={tokenTip} frozen={runner.frozen} />}
      {picked && (runner.frozen || picked.fromSlot) && <TokenPopup token={picked.token} x={picked.x} y={picked.y} onClose={() => setPicked(null)} />}
    </div>
  );
}

function PresenterBar(props: { runner: Runner; snap: Snapshot; logOpen: boolean; setLogOpen: (b: boolean) => void; onWalkthrough: () => void }) {
  const { runner, snap } = props;
  const [seed, setSeed] = useState(runner.seed);
  const [inputs, setInputs] = useState(runner.inputs);
  return (
    <header className="bar presenter" aria-label="Presenter controls">
      <div className="brand">
        <a href="../" className="home" title="Back to the explanation">
          ←
        </a>
        <strong>Forecast Pipeline Demonstrator</strong>
      </div>
      <div className="clock mono" aria-live="off">
        {snap.clock}
      </div>
      <span className="kind-tag presenter">Presenter</span>
      <label>
        seed <input value={seed} onChange={(e) => setSeed(e.target.value)} size={8} />
      </label>
      <label>
        inputs{' '}
        <select value={inputs} onChange={(e) => setInputs(Number(e.target.value))}>
          {[3, 4, 5, 6].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <button onClick={() => runner.restart(seed || 'demo', inputs)}>Restart</button>
      <span className="sep" />
      <button onClick={() => runner.setRunning(!runner.running)} className={runner.running ? '' : 'primary'}>
        {runner.running ? 'Pause' : 'Run'}
      </button>
      <button onClick={() => runner.step()}>Step</button>
      <div className="seg" role="group" aria-label="Rate">
        {([0.5, 1, 10, 60] as Rate[]).map((r) => (
          <button key={r} className={runner.rate === r ? 'on' : ''} onClick={() => runner.setRate(r)}>
            {r === 0.5 ? '½' : r}×
          </button>
        ))}
      </div>
      <span className="sep" />
      <button onClick={() => runner.apply({ type: 'addConsumer' })}>Add consumer</button>
      <span className="sep" />
      <button onClick={props.onWalkthrough} title="Introduce each region and component in turn">
        Walkthrough
      </button>
      <button className={props.logOpen ? 'on' : ''} onClick={() => props.setLogOpen(!props.logOpen)}>
        Event log ({snap.events.count})
      </button>
    </header>
  );
}

/** §5.5: permanent honesty banner, boundary-check result and event-log digest. */
function Banner({ snap }: { snap: Snapshot }) {
  const ok = boundary.ok;
  return (
    <div className="banner" role="note">
      <span>Synthetic data · illustrative numerics · the engines are mocks · no Dagster, Postgres or pygeoapi runs here.</span>
      <span className={`boundary ${ok ? 'ok' : 'bad'}`} title={ok ? `${boundary.checkedFiles} module files checked` : JSON.stringify(boundary.violations)}>
        Module boundary check: {ok ? 'passed' : 'FAILED'}
      </span>
      <span className="mono">
        seed {snap.seed} · digest {snap.events.digest}
      </span>
      {snap.defects.length > 0 && <span className="boundary bad">{snap.defects.length} undeclared-edge defect(s)</span>}
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

function ScenarioPanel({ snap, act }: { snap: Snapshot; act: (a: ControlAction) => void }) {
  return (
    <section className="panel scenario" aria-label="Scenario controls">
      <span className="kind-tag scenario">Scenario</span>
      <span className="muted small who">the sea and the sensors · nobody really has these</span>
      <div className="inputs">
        {snap.inputs.map((s) => (
          <div key={s.key} className="input">
            <span className="name">{s.label}</span>
            <button className={s.shiftOn ? 'on' : ''} onClick={() => act({ type: 'shift', input: s.key, on: !s.shiftOn })} title="+5σ over 20 s">
              shift {s.shiftOn ? 'on' : 'off'}
            </button>
            <label className="small">
              noise {s.noise}σ
              <input type="range" min={NOISE_BOUNDS.min} max={NOISE_BOUNDS.max} step={0.5} value={s.noise} onChange={(e) => act({ type: 'noise', input: s.key, sigma: Number(e.target.value) })} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

function OperatorPanel({ snap, act }: { snap: Snapshot; act: (a: ControlAction) => void }) {
  const d = snap.drift;
  const b = DRIFT_BOUNDS;
  return (
    <section className="panel operator" aria-label="Operator controls">
      <span className="kind-tag operator">Operator</span>
      <span className="muted small who">the ship's operator</span>
      <label>
        threshold <b className="mono">{d.threshold}σ</b>
        <input type="range" min={b.threshold.min} max={b.threshold.max} step={b.threshold.step} value={d.threshold} onChange={(e) => act({ type: 'threshold', value: Number(e.target.value) })} />
      </label>
      <label>
        quorum <b className="mono">{d.quorum}</b>
        <input type="range" min={1} max={snap.inputs.length} step={1} value={d.quorum} onChange={(e) => act({ type: 'quorum', value: Number(e.target.value) })} />
      </label>
      <label>
        persistence <b className="mono">{d.persistence}</b>
        <input type="range" min={b.persistence.min} max={b.persistence.max} step={1} value={d.persistence} onChange={(e) => act({ type: 'persistence', value: Number(e.target.value) })} />
      </label>
    </section>
  );
}

/** UI-7: popup, newest first, with the event count. */
function EventLogPanel({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const entries = runner.sim.log.entries;
  const shown = entries.slice(-400).reverse();
  return (
    <aside className="eventlog" role="dialog" aria-label="Event log">
      <header>
        <strong>Event log</strong> <span className="muted">{entries.length} events, newest first</span>
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

import { DRIFT_BOUNDS, MAX_INPUTS, MIN_INPUTS, NOISE_BOUNDS, type ControlAction, type Snapshot } from '@argonautical/sim';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Diagram, type Motion } from './diagram/Diagram.tsx';
import boundary from './generated/boundary.json';
import { Runner, type Rate } from './runner.ts';

const params = new URLSearchParams(location.search);
const osReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionParam = params.get('motion');
// MOT-2: follow the OS by default; ?motion= forces a mode for rehearsal.
const initialMotion: Motion = motionParam === 'tokens' || motionParam === 'reduced' ? motionParam : osReduced ? 'reduced' : 'tokens';

function useRunner(): Runner {
  const ref = useRef<Runner>();
  if (!ref.current) {
    const inputs = Number(params.get('inputs') ?? 4);
    ref.current = new Runner(params.get('seed') ?? 'demo', inputs >= MIN_INPUTS && inputs <= MAX_INPUTS ? inputs : 4);
  }
  return ref.current;
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
  const [motion, setMotion] = useState<Motion>(initialMotion);
  const [logOpen, setLogOpen] = useState(false);
  const snap = runner.sim.snapshot();
  const act = (a: ControlAction) => runner.apply(a);

  return (
    <div className="app">
      <PresenterBar runner={runner} snap={snap} motion={motion} setMotion={setMotion} logOpen={logOpen} setLogOpen={setLogOpen} />
      <Banner snap={snap} />
      <main className="stage">
        <Diagram snap={snap} runner={runner} motion={motion} />
        <Legend />
      </main>
      <footer className="controls">
        <ScenarioPanel snap={snap} act={act} />
        <OperatorPanel snap={snap} act={act} />
      </footer>
      {logOpen && <EventLogPanel runner={runner} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

function PresenterBar(props: { runner: Runner; snap: Snapshot; motion: Motion; setMotion: (m: Motion) => void; logOpen: boolean; setLogOpen: (b: boolean) => void }) {
  const { runner, snap, motion, setMotion } = props;
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
        {([1, 10, 60] as Rate[]).map((r) => (
          <button key={r} className={runner.rate === r ? 'on' : ''} onClick={() => runner.setRate(r)}>
            {r}×
          </button>
        ))}
      </div>
      <span className="sep" />
      <button className={snap.failNextRun ? 'on' : ''} onClick={() => runner.apply({ type: 'failNextRun' })}>
        Fail next run
      </button>
      <button className={snap.offline.modelRunner ? 'on danger' : ''} onClick={() => runner.apply({ type: 'offline', module: 'modelRunner', offline: !snap.offline.modelRunner })}>
        Runner {snap.offline.modelRunner ? 'offline' : 'online'}
      </button>
      <button className={snap.offline.featureDetector ? 'on danger' : ''} onClick={() => runner.apply({ type: 'offline', module: 'featureDetector', offline: !snap.offline.featureDetector })}>
        Detector {snap.offline.featureDetector ? 'offline' : 'online'}
      </button>
      <button onClick={() => runner.apply({ type: 'addConsumer' })}>Add consumer</button>
      <span className="sep" />
      <button onClick={() => setMotion(motion === 'tokens' ? 'reduced' : 'tokens')} title="MOT-2">
        Motion: {motion}
      </button>
      {motion === 'reduced' && osReduced && motionParam !== 'reduced' && (
        <button className="hint" onClick={() => setMotion('tokens')}>
          OS asks for reduced motion · show tokens
        </button>
      )}
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
      <button className="primary" onClick={() => act({ type: 'requestRun' })}>
        Request a run
      </button>
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

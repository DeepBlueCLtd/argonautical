/**
 * SYS-8, SYS-9: the store inspector. A side panel that stays open and updates live; it reads stored
 * rows only and never mutates the simulation. Each store is shown in its native form.
 */
import { clockLabel, type Simulation } from '@argonautical/sim';
import { useEffect, useState } from 'react';
import type { InspectId } from './diagram/PhysicalDiagram.tsx';

const TITLES: Record<InspectId, { title: string; sub: string }> = {
  observationsDb: { title: 'Observations DB', sub: 'PostgreSQL + TimescaleDB · SensorThings schema' },
  netcdfStore: { title: 'NetCDF store', sub: 'NetCDF / Zarr files on a filesystem' },
  featuresDb: { title: 'Features DB', sub: 'PostGIS · fronts and eddies by forecast' },
  sensorBroker: { title: 'Sensor broker', sub: 'Mosquitto on the OT network · persistent queue (QoS 1)' },
  broker: { title: 'Broker', sub: 'Mosquitto in the distribution zone · retained announcements' },
  privateStore: { title: 'Dagster metadata DB', sub: 'PostgreSQL · run history, schedules, sensor cursors' },
  transferArea: { title: 'Transfer area', sub: 'Filesystem on the ops node · inbox and outbox' },
};

const iso = (tick: number) => new Date(Date.UTC(2026, 10, 13) + tick * 1000).toISOString().replace('.000Z', 'Z');
const n4 = (v: number) => (Number.isFinite(v) ? (Math.round(v * 1e4) / 1e4).toString() : String(v));

export function StoreInspector({ id, sim, onClose }: { id: InspectId; sim: Simulation; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  const t = TITLES[id];
  return (
    <aside className="inspector" role="dialog" aria-label={`${t.title} inspector`}>
      <header>
        <div>
          <strong>{t.title}</strong>
          <div className="muted small">{t.sub}</div>
        </div>
        <span className="live muted small">live · {sim.clock}</span>
        <button onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </header>
      <div className="body">
        {id === 'observationsDb' && <Observations sim={sim} />}
        {id === 'netcdfStore' && <Netcdf sim={sim} />}
        {id === 'featuresDb' && <Features sim={sim} />}
        {id === 'sensorBroker' && <SensorQueue sim={sim} />}
        {id === 'broker' && <BrokerView sim={sim} />}
        {id === 'privateStore' && <RunHistory sim={sim} />}
        {id === 'transferArea' && <Transfer sim={sim} />}
      </div>
      <footer className="muted small">Read only · counts come from the stored rows · Esc closes</footer>
    </aside>
  );
}

function Observations({ sim }: { sim: Simulation }) {
  const rows = sim.observationsDb.all;
  const shown = rows.slice(-60).reverse();
  return (
    <>
      <p className="small">
        <span className="mono">{rows.length}</span> Observation rows · one Thing (the ship), one Datastream per input {sim.observationsDb.up ? '' : <strong className="offline-label"> · STOPPED</strong>}
      </p>
      <pre className="sql">SELECT "Datastream@iot.id", phenomenonTime, result FROM observations ORDER BY phenomenonTime DESC LIMIT 60;</pre>
      <table className="grid">
        <thead>
          <tr>
            <th>Datastream</th>
            <th>phenomenonTime</th>
            <th className="num">result</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rows.length - i} className={r.tick >= sim.tick - 1 ? 'fresh' : ''}>
              <td className="mono">ship-1:{r.input}</td>
              <td className="mono">{iso(r.tick)}</td>
              <td className="mono num">{n4(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Netcdf({ sim }: { sim: Simulation }) {
  const files = [{ name: 'climatology.nc', kind: 'climatology' as const }, ...sim.netcdf.all.map((f) => ({ name: `forecast_${f.id}.nc`, kind: f.id }))];
  const [sel, setSel] = useState<string>(files[files.length - 1]!.name);
  const chosen = files.find((f) => f.name === sel) ?? files[files.length - 1]!;
  const f = chosen.kind === 'climatology' ? undefined : sim.netcdf.byId(chosen.kind);
  const values = f ? f.values : sim.netcdf.climatology;
  const keys = Object.keys(values);
  const spec = (k: string) => sim.inputs.find((s) => s.key === k)!;
  const attrs: [string, string][] = f
    ? [
        ['forecast_id', f.id],
        ['cause', f.cause],
        ['issued', iso(f.issuedAt)],
        ['valid_until', iso(f.validUntil)],
        ['horizon_hours', String(f.horizon)],
        ['digest', f.digest],
      ]
    : [
        ['title', 'Climatology at the ship'],
        ['version', String(sim.netcdf.climatologyVersion)],
        ['history', sim.netcdf.climatologyVersions.map((v) => `v${v.version} @ ${clockLabel(v.committedAt)}`).join('; ')],
      ];
  return (
    <>
      <div className="files">
        {files.map((x) => (
          <button key={x.name} className={x.name === chosen.name ? 'on' : ''} onClick={() => setSel(x.name)}>
            {x.name}
          </button>
        ))}
      </div>
      <pre className="ncdump">
        {`netcdf ${chosen.name.replace('.nc', '')} {
dimensions:
\ttime = 1 ;
\tlat = 8 ;
\tlon = 8 ;
variables:
${keys.map((k) => `\tfloat ${k}(time, lat, lon) ;\n\t\t${k}:units = "${spec(k).unit}" ;\n\t\t${k}:long_name = "${spec(k).label}" ;`).join('\n')}

// global attributes:
${attrs.map(([k, v]) => `\t\t:${k} = "${v}" ;`).join('\n')}
}`}
      </pre>
      <p className="small muted">Value at the ship (centre cell) and an illustrative 8×8 field around it, in σ from climatology:</p>
      <div className="heatmaps">
        {keys.map((k) => {
          const s = spec(k);
          const z = (values[k]! - s.base) / s.sigma;
          return (
            <figure key={k}>
              <Heatmap z={z} seed={k.length + (f ? f.digest.charCodeAt(0) : 0)} />
              <figcaption className="small">
                {k} <span className="mono">{n4(values[k]!)}</span> {s.unit}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </>
  );
}

/** An illustrative field: the ship's value at the centre, smoothly varying around it. */
function Heatmap({ z, seed }: { z: number; seed: number }) {
  const cells = [];
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) {
      const d = Math.hypot(i - 3.5, j - 3.5) / 5;
      const v = z * (1 - d) + 0.4 * Math.sin((i + seed) * 0.9) * Math.cos((j - seed) * 0.7);
      const c = Math.max(-1, Math.min(1, v / 3));
      const col = c >= 0 ? `rgba(214, 51, 108, ${0.12 + c * 0.8})` : `rgba(28, 126, 214, ${0.12 - c * 0.8})`;
      cells.push(<rect key={`${i}-${j}`} x={i * 10} y={j * 10} width={10} height={10} fill={col} />);
    }
  return (
    <svg viewBox="0 0 80 80" width={80} height={80} className="heatmap">
      {cells}
      <rect x={35} y={35} width={10} height={10} fill="none" stroke="#212529" strokeWidth={1.5} />
    </svg>
  );
}

function Features({ sim }: { sim: Simulation }) {
  const rows = sim.featuresDb.all;
  const latest = sim.featuresDb.latestForecastId;
  const map = rows.filter((r) => r.forecastId === latest);
  return (
    <>
      <p className="small">
        <span className="mono">{rows.length}</span> rows{latest ? ` · map shows ${latest}` : ''}
      </p>
      {latest && (
        <svg viewBox="0 0 200 120" className="minimap">
          <rect x={0} y={0} width={200} height={120} className="sea" />
          {map.map((f) =>
            f.kind === 'front' ? (
              <path key={f.id} d={`M${f.x * 200},10 Q${f.x * 200 + 18},60 ${f.x * 200},110`} className="front" />
            ) : (
              <circle key={f.id} cx={f.x * 200} cy={f.y * 120} r={9} className="eddy" />
            ),
          )}
          <circle cx={100} cy={60} r={3} className="ship" />
        </svg>
      )}
      <pre className="sql">SELECT id, forecast_id, kind, input, ST_AsText(geom) FROM features ORDER BY forecast_id DESC;</pre>
      <table className="grid">
        <thead>
          <tr>
            <th>id</th>
            <th>forecast_id</th>
            <th>kind</th>
            <th>input</th>
            <th>geom</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().slice(0, 60).map((f) => (
            <tr key={f.id}>
              <td className="mono">{f.id}</td>
              <td className="mono">{f.forecastId}</td>
              <td>{f.kind}</td>
              <td>{f.input ?? '—'}</td>
              <td className="mono">POINT({(-4.7 + f.x).toFixed(3)} {(49.6 + f.y).toFixed(3)})</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted small">No features yet{sim.capabilities.featureDetector ? '' : ': no feature detector is deployed'}.</p>}
    </>
  );
}

function SensorQueue({ sim }: { sim: Simulation }) {
  const q = sim.sensorBroker.pending;
  return (
    <>
      <p className="small">
        <span className="mono">{q.length}</span> unacknowledged message(s) · published {sim.sensorBroker.published} · delivered {sim.sensorBroker.delivered}
      </p>
      <p className="small muted">Ingestion acknowledges a message only after its database commit, so a stopped ingestion or database leaves messages here.</p>
      <table className="grid">
        <thead>
          <tr>
            <th>topic</th>
            <th>phenomenonTime</th>
            <th className="num">result</th>
          </tr>
        </thead>
        <tbody>
          {q.slice(0, 80).map((m, i) => (
            <tr key={i}>
              <td className="mono">v1.1/Datastreams('ship-1:{m.input}')/Observations</td>
              <td className="mono">{iso(m.tick)}</td>
              <td className="mono num">{n4(m.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.length > 80 && <p className="muted small">…and {q.length - 80} more</p>}
    </>
  );
}

function BrokerView({ sim }: { sim: Simulation }) {
  const subs = sim.broker.subscriptions;
  return (
    <>
      <h4>Retained messages</h4>
      {sim.broker.retainedMessages.length ? (
        sim.broker.retainedMessages.map((m) => (
          <pre key={m.topic} className="json">
            {`argonautical/${m.topic}\n${JSON.stringify(m.body, null, 2)}`}
          </pre>
        ))
      ) : (
        <p className="muted small">None yet.</p>
      )}
      <h4>Subscriptions</h4>
      <table className="grid">
        <thead>
          <tr>
            <th>topic</th>
            <th>subscribers</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(subs).map(([topic, who]) => (
            <tr key={topic}>
              <td className="mono">argonautical/{topic}</td>
              <td>{who.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RunHistory({ sim }: { sim: Simulation }) {
  const o = sim.orchestrator;
  return (
    <>
      <p className="small">
        <span className="mono">{o.history.length}</span> completed run(s){o.active ? ` · ${o.active.id} running (${o.active.step})` : ''}
        {o.pending ? ` · queued: ${o.pending.causes.join(' + ')}` : ''}
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>run</th>
            <th>forecast</th>
            <th>causes</th>
            <th>started</th>
            <th className="num">s</th>
            <th className="num">fails</th>
          </tr>
        </thead>
        <tbody>
          {[...o.history].reverse().map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              <td className="mono">{r.forecastId}</td>
              <td>{r.causes}</td>
              <td className="mono">{clockLabel(r.startedAt)}</td>
              <td className="mono num">{r.endedAt - r.startedAt}</td>
              <td className="mono num">{r.failures}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Sensor cursor</h4>
      <p className="small mono">drift streak {o.cursor.streak} · {o.cursor.status}</p>
    </>
  );
}

function Transfer({ sim }: { sim: Simulation }) {
  const a = sim.transferArea;
  return (
    <>
      <h4>inbox/ · from shore</h4>
      {a.inbox.length ? (
        <ul className="files-list mono small">
          {a.inbox.map((f) => (
            <li key={f.version}>climatology_v{f.version}.nc · issued {clockLabel(f.issuedAt)} · signature verified</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Empty. Climatology v{sim.netcdf.climatologyVersion} is in the NetCDF store.</p>
      )}
      <h4>outbox/ · to shore</h4>
      {a.outbox.length ? (
        <ul className="files-list mono small">
          {a.outbox.map((b) => (
            <li key={b.id}>
              {b.id}.tar · {b.observations} obs{b.forecastId ? ` · ${b.forecastId}` : ''}
              {b.featureCount !== undefined ? ` · ${b.featureCount} features` : ''} · sha256:{b.digest}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Empty.</p>
      )}
      <h4>Sent</h4>
      <p className="small mono">{a.sent.length ? a.sent.map((s) => `${s.id} @ ${clockLabel(s.at)}`).join(' · ') : 'nothing yet'}</p>
      <p className="small muted">Shore link {sim.snapshot().shore.linkUp ? 'up' : 'down'}: bundles wait here while it is down.</p>
    </>
  );
}

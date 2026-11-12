/**
 * ARC-7: candidate production deployment, declared. Used only by the
 * system-architecture view. Our modules must not import this file.
 * See docs/system-architecture.md.
 */
import type { ElementId } from './elements.ts';

export const ZONES = {
  environment: { label: 'Sea (not a network)' },
  ot: { label: 'Instrument network (OT)' },
  proc: { label: 'Processing enclave' },
  dmz: { label: 'Distribution zone' },
  mission: { label: 'Mission network' },
} as const;
export type ZoneId = keyof typeof ZONES;

export const NODES = {
  sea: { zone: 'environment', label: 'Ocean' },
  daq: { zone: 'ot', label: 'Sensors / DAQ gateways' },
  ingest: { zone: 'ot', label: 'Ingestion host' },
  orch: { zone: 'proc', label: 'Orchestration node' },
  compute: { zone: 'proc', label: 'Compute node' },
  data: { zone: 'proc', label: 'Data node' },
  dist: { zone: 'dmz', label: 'Distribution host' },
  mission: { zone: 'mission', label: 'Consumer hosts' },
} as const satisfies Record<string, { zone: ZoneId; label: string }>;
export type NodeId = keyof typeof NODES;

export interface Placement {
  readonly node: NodeId;
  readonly process: string;
}

export const PLACEMENT: Record<ElementId, Placement> = {
  ocean: { node: 'sea', process: '—' },
  sensors: { node: 'daq', process: 'instruments' },
  ingestion: { node: 'ingest', process: 'ingest-svc' },
  observationsDb: { node: 'data', process: 'postgres' },
  orchestrator: { node: 'orch', process: 'dagster-daemon' },
  privateStore: { node: 'orch', process: 'dagster-metadata-db' },
  driftSensor: { node: 'orch', process: 'dagster-daemon' },
  shimCheck: { node: 'orch', process: 'code-location' },
  driftMonitor: { node: 'orch', process: 'code-location' },
  stalenessSchedule: { node: 'orch', process: 'dagster-daemon' },
  manualRequest: { node: 'orch', process: 'dagster-webserver' },
  climatology: { node: 'orch', process: 'code-location' },
  forecast: { node: 'orch', process: 'code-location' },
  shimRun: { node: 'orch', process: 'code-location' },
  modelRunner: { node: 'compute', process: 'model-runner (Pipes)' },
  features: { node: 'orch', process: 'code-location' },
  shimDetect: { node: 'orch', process: 'code-location' },
  featureDetector: { node: 'orch', process: 'code-location' },
  announcement: { node: 'orch', process: 'code-location' },
  shimAnnounce: { node: 'orch', process: 'code-location' },
  netcdfStore: { node: 'data', process: 'coverage-store' },
  featuresDb: { node: 'data', process: 'postgis' },
  pygeoapi: { node: 'dist', process: 'pygeoapi' },
  broker: { node: 'dist', process: 'mosquitto' },
  consumer: { node: 'mission', process: 'consumer-app' },
};

/** Undirected network links between nodes. */
export const LINKS: readonly { readonly a: NodeId; readonly b: NodeId; readonly via?: string }[] = [
  { a: 'daq', b: 'ingest' },
  { a: 'ingest', b: 'data', via: 'OT → enclave firewall' },
  { a: 'orch', b: 'compute' },
  { a: 'orch', b: 'dist' },
  { a: 'compute', b: 'dist' },
  { a: 'compute', b: 'data' },
  { a: 'orch', b: 'data' },
  { a: 'data', b: 'dist' },
  { a: 'dist', b: 'mission', via: 'DMZ → mission firewall' },
];

export function linkBetween(x: NodeId, y: NodeId) {
  return LINKS.find((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));
}

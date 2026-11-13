/**
 * ARC-3: wiring is declared, not drawn. Each element declares its relations;
 * edges are derived from these declarations. Layout supplies geometry only.
 */

export type Region = 'world' | 'system' | 'boundary' | 'consumers';

/** Production build-vs-adopt decision, shown by styling (SRD §5.3). */
export type Provenance = 'world' | 'ours' | 'off-the-shelf';

export type ElementKind =
  | 'environment'
  | 'instrument'
  | 'module'
  | 'store'
  | 'orchestrator'
  | 'sensor'
  | 'schedule'
  | 'trigger'
  | 'asset'
  | 'shim'
  | 'service'
  | 'consumer';

export type RelationKind =
  | 'sends'
  | 'calls'
  | 'writes'
  | 'reads'
  | 'publishes'
  | 'subscribes'
  | 'registers'
  | 'queries'
  | 'lineage'
  | 'triggers';

export interface Relation {
  readonly kind: RelationKind;
  readonly to: ElementId;
}

export interface ElementDecl {
  readonly id: ElementId;
  readonly label: string;
  readonly kind: ElementKind;
  readonly provenance: Provenance;
  readonly region: Region;
  /** Containment (UI-3): shims and modules sit inside their asset or sensor; those sit inside the orchestrator. */
  readonly parent?: ElementId;
  readonly relations: readonly Relation[];
  /** Consumers are instantiated at run time; tokens on their edges carry an instance id. */
  readonly template?: boolean;
  readonly note?: string;
}

export const ELEMENT_IDS = [
  'ocean',
  'sensors',
  'sensorBroker',
  'ingestion',
  'observationsDb',
  'orchestrator',
  'privateStore',
  'driftSensor',
  'shimCheck',
  'driftMonitor',
  'stalenessSchedule',
  'manualRequest',
  'climatology',
  'forecast',
  'shimRun',
  'modelRunner',
  'features',
  'shimDetect',
  'featureDetector',
  'announcement',
  'shimAnnounce',
  'announcer',
  'netcdfStore',
  'featuresDb',
  'pygeoapi',
  'broker',
  'consumer',
] as const;

export type ElementId = (typeof ELEMENT_IDS)[number];

const r = (kind: RelationKind, to: ElementId): Relation => ({ kind, to });

export const ELEMENTS: readonly ElementDecl[] = [
  // World
  { id: 'ocean', label: 'Ocean', kind: 'environment', provenance: 'world', region: 'world', relations: [] },
  { id: 'sensors', label: 'Sensors', kind: 'instrument', provenance: 'world', region: 'world', relations: [r('publishes', 'sensorBroker')] },
  // Persistent queue between the DAQ gateway and ingestion: survives ingestion and database restarts.
  { id: 'sensorBroker', label: 'Sensor broker', kind: 'service', provenance: 'off-the-shelf', region: 'system', relations: [], note: 'persistent queue' },

  // System — ours, not orchestrated
  { id: 'ingestion', label: 'Ingestion', kind: 'module', provenance: 'ours', region: 'system', relations: [r('subscribes', 'sensorBroker'), r('writes', 'observationsDb')], note: 'not orchestrated' },
  {
    id: 'observationsDb',
    label: 'Observations DB',
    kind: 'store',
    provenance: 'ours',
    region: 'system',
    // UI-8: the store *is* the `observations` source asset.
    relations: [r('lineage', 'forecast')],
    note: 'source asset',
  },

  // Orchestrator (off-the-shelf, mocked)
  { id: 'orchestrator', label: 'Orchestrator', kind: 'orchestrator', provenance: 'off-the-shelf', region: 'system', relations: [] },
  { id: 'privateStore', label: 'Run history · schedule · sensor state', kind: 'store', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [] },
  { id: 'driftSensor', label: 'Drift sensor', kind: 'sensor', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [r('triggers', 'forecast')] },
  { id: 'shimCheck', label: 'check', kind: 'shim', provenance: 'ours', region: 'system', parent: 'driftSensor', relations: [r('calls', 'driftMonitor')] },
  { id: 'driftMonitor', label: 'Drift monitor', kind: 'module', provenance: 'ours', region: 'system', parent: 'driftSensor', relations: [r('queries', 'pygeoapi')] },
  { id: 'stalenessSchedule', label: 'Staleness schedule', kind: 'schedule', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [r('triggers', 'forecast')] },
  { id: 'manualRequest', label: 'Manual request', kind: 'trigger', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [r('triggers', 'forecast')] },
  { id: 'climatology', label: 'climatology', kind: 'asset', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [r('lineage', 'forecast')] },
  {
    id: 'forecast',
    label: 'forecast',
    kind: 'asset',
    provenance: 'off-the-shelf',
    region: 'system',
    parent: 'orchestrator',
    // UI-10: background is a loop on forecast.
    relations: [r('lineage', 'forecast'), r('lineage', 'features'), r('lineage', 'announcement')],
  },
  { id: 'shimRun', label: 'run', kind: 'shim', provenance: 'ours', region: 'system', parent: 'forecast', relations: [r('calls', 'modelRunner')] },
  { id: 'modelRunner', label: 'Model runner', kind: 'module', provenance: 'ours', region: 'system', parent: 'forecast', relations: [r('queries', 'pygeoapi'), r('writes', 'netcdfStore')] },
  { id: 'features', label: 'features', kind: 'asset', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [r('lineage', 'announcement')] },
  { id: 'shimDetect', label: 'detect', kind: 'shim', provenance: 'ours', region: 'system', parent: 'features', relations: [r('calls', 'featureDetector')] },
  { id: 'featureDetector', label: 'Feature detector', kind: 'module', provenance: 'ours', region: 'system', parent: 'features', relations: [r('queries', 'pygeoapi'), r('writes', 'featuresDb')] },
  { id: 'announcement', label: 'announcement', kind: 'asset', provenance: 'off-the-shelf', region: 'system', parent: 'orchestrator', relations: [] },
  { id: 'shimAnnounce', label: 'announce', kind: 'shim', provenance: 'ours', region: 'system', parent: 'announcement', relations: [r('calls', 'announcer')] },
  { id: 'announcer', label: 'Announcer', kind: 'module', provenance: 'ours', region: 'system', parent: 'announcement', relations: [r('publishes', 'broker')] },

  // Stores (ours) and read path
  { id: 'netcdfStore', label: 'NetCDF store', kind: 'store', provenance: 'ours', region: 'system', relations: [] },
  { id: 'featuresDb', label: 'Features DB', kind: 'store', provenance: 'ours', region: 'system', relations: [] },
  {
    id: 'pygeoapi',
    label: 'pygeoapi',
    kind: 'service',
    provenance: 'off-the-shelf',
    region: 'system',
    // CAT-4: its deployment hook publishes catalogue changes (pygeoapi itself does not).
    relations: [r('reads', 'observationsDb'), r('reads', 'netcdfStore'), r('reads', 'featuresDb'), r('publishes', 'broker')],
    note: 'read only',
  },
  { id: 'broker', label: 'Broker', kind: 'service', provenance: 'off-the-shelf', region: 'boundary', relations: [] },

  // Onboard consumers
  { id: 'consumer', label: 'Consumer', kind: 'consumer', provenance: 'world', region: 'consumers', template: true, relations: [r('subscribes', 'broker'), r('registers', 'broker'), r('queries', 'pygeoapi')] },
];

export type EdgeKind = 'send' | 'call' | 'write' | 'read' | 'publish' | 'deliver' | 'subscribe' | 'query' | 'lineage' | 'trigger';

export interface Edge {
  readonly id: string;
  /** Token direction: the way the interaction travels. For `read` and `deliver`, that is the way the data moves. */
  readonly from: ElementId;
  readonly to: ElementId;
  readonly kind: EdgeKind;
  /** Lineage and trigger edges are logical (orchestrator metadata), not network traffic. */
  readonly logical: boolean;
}

export const edgeId = (from: ElementId, kind: EdgeKind, to: ElementId): string => `${from}>${kind}>${to}`;

function deriveEdge(owner: ElementId, rel: Relation): Edge {
  const mk = (from: ElementId, kind: EdgeKind, to: ElementId, logical = false): Edge => ({ id: edgeId(from, kind, to), from, to, kind, logical });
  switch (rel.kind) {
    case 'sends':
      return mk(owner, 'send', rel.to);
    case 'calls':
      return mk(owner, 'call', rel.to);
    case 'writes':
      return mk(owner, 'write', rel.to);
    case 'publishes':
      return mk(owner, 'publish', rel.to);
    case 'queries':
      return mk(owner, 'query', rel.to);
    // Data moves from the store to the reader.
    case 'reads':
      return mk(rel.to, 'read', owner);
    // Messages move from the broker to the subscriber.
    case 'subscribes':
      return mk(rel.to, 'deliver', owner);
    // CAT-4: the subscriber's own SUBSCRIBE / UNSUBSCRIBE requests.
    case 'registers':
      return mk(owner, 'subscribe', rel.to);
    case 'lineage':
      return mk(owner, 'lineage', rel.to, true);
    case 'triggers':
      return mk(owner, 'trigger', rel.to, true);
  }
}

export function deriveEdges(elements: readonly ElementDecl[] = ELEMENTS): Edge[] {
  return elements.flatMap((e) => e.relations.map((rel) => deriveEdge(e.id, rel)));
}

export const EDGES: readonly Edge[] = deriveEdges();
export const EDGE_IDS: ReadonlySet<string> = new Set(EDGES.map((e) => e.id));

export function element(id: ElementId): ElementDecl {
  const e = ELEMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`unknown element ${id}`);
  return e;
}

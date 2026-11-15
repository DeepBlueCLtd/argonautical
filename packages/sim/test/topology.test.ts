import { describe, expect, it } from 'vitest';
import { EventLog } from '../src/events.ts';
import { runScript } from '../src/scenario.ts';
import { TokenRecorder } from '../src/tokens.ts';
import { LINKS, NODES, PLACEMENT, linkBetween } from '../src/topology/deployment.ts';
import { EDGES, EDGE_IDS, ELEMENTS, ELEMENT_IDS, deriveEdges, edgeId } from '../src/topology/elements.ts';
import { loadScenarios } from './helpers.ts';

describe('declared wiring (ARC-3)', () => {
  it('every element id is declared exactly once', () => {
    expect(ELEMENTS.map((e) => e.id).sort()).toEqual([...ELEMENT_IDS].sort());
  });

  it('edges are derived from declarations, with no duplicates', () => {
    expect(new Set(EDGES.map((e) => e.id)).size).toBe(EDGES.length);
    expect(deriveEdges()).toEqual(EDGES);
  });

  it('reads and deliveries point the way the data moves', () => {
    expect(EDGE_IDS.has(edgeId('observationsDb', 'read', 'pygeoapi'))).toBe(true);
    expect(EDGE_IDS.has(edgeId('broker', 'deliver', 'consumer'))).toBe(true);
  });

  it('UI-10: background is a lineage loop on forecast; UI-8: the Observations DB feeds forecast directly', () => {
    expect(EDGE_IDS.has(edgeId('forecast', 'lineage', 'forecast'))).toBe(true);
    expect(EDGE_IDS.has(edgeId('observationsDb', 'lineage', 'forecast'))).toBe(true);
  });

  it('UI-3: each of our modules and each shim sits inside an asset or sensor', () => {
    for (const id of ['driftMonitor', 'modelRunner', 'featureDetector', 'announcer', 'climatologyImporter', 'shoreExporter', 'shimCheck', 'shimRun', 'shimDetect', 'shimAnnounce', 'shimImport', 'shimExport'] as const) {
      const parent = ELEMENTS.find((e) => e.id === id)!.parent;
      const kind = ELEMENTS.find((e) => e.id === parent)?.kind;
      expect(['asset', 'sensor']).toContain(kind);
    }
  });

  it('ORC-6: the only edges into our orchestrated modules are calls from their shims', () => {
    for (const m of ['driftMonitor', 'modelRunner', 'featureDetector', 'announcer', 'climatologyImporter', 'shoreExporter']) {
      // Data arriving from a store (the importer reads its inbox) is not a call; every call is from a shim.
      const into = EDGES.filter((e) => e.to === m && e.kind !== 'read');
      expect(into.every((e) => e.kind === 'call' && e.from.startsWith('shim'))).toBe(true);
    }
  });
});

describe('tokens (SIM-6)', () => {
  it('records a defect for a token on an undeclared edge', () => {
    const log = new EventLog();
    const rec = new TokenRecorder(log, () => 7);
    rec.emit('ocean>call>broker');
    expect(rec.defects).toEqual(['token on undeclared edge ocean>call>broker']);
    expect(log.entries[0]).toMatchObject({ tick: 7, kind: 'defect' });
  });

  it('no scenario emits a token on an undeclared edge', () => {
    for (const s of loadScenarios()) expect(runScript(s).tokens.defects, s.name).toEqual([]);
  });

  it('every declared edge is exercised by the scenarios (no dead wiring)', () => {
    const used = new Set<string>();
    for (const s of loadScenarios()) for (const k of runScript(s).tokens.edgeStats.keys()) used.add(k);
    expect(EDGES.map((e) => e.id).filter((id) => !used.has(id))).toEqual([]);
  });
});

describe('deployment (ARC-7)', () => {
  it('every element is placed on a declared node', () => {
    for (const id of ELEMENT_IDS) expect(NODES[PLACEMENT[id].node], id).toBeDefined();
  });

  it('every network edge between nodes maps to a declared link', () => {
    const missing = EDGES.filter((e) => !e.logical)
      .filter((e) => PLACEMENT[e.from].node !== PLACEMENT[e.to].node)
      .filter((e) => !linkBetween(PLACEMENT[e.from].node, PLACEMENT[e.to].node))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it('every declared link is used by at least one edge', () => {
    const used = LINKS.filter((l) => EDGES.some((e) => !e.logical && linkBetween(PLACEMENT[e.from].node, PLACEMENT[e.to].node) === l));
    expect(used).toHaveLength(LINKS.length);
  });

  it('SYS-4: the model runner has its own process on the compute node; other modules share the code location', () => {
    expect(PLACEMENT.modelRunner.node).toBe('compute');
    for (const id of ['shimCheck', 'driftMonitor', 'featureDetector', 'shimRun'] as const) expect(PLACEMENT[id]).toEqual({ node: 'orch', process: 'code-location' });
  });
});

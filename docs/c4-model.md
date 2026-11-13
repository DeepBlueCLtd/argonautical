# C4 Model — Production Candidate (Physical View)

Companion to `srd.md` (v2) and `docs/system-architecture.md`. Status: **draft for review (Nov 13, 2026)**.

This is an alternative to `docs/system-architecture.md` §1.2–1.3, kept as a separate document so the two can be compared. It describes the **eventual production system**, not the demonstrator. Like the rest of the architecture material, it is a candidate design, not a commitment.

Diagrams use Mermaid's C4 syntax, so they render on GitHub with no tooling. Mermaid still marks its C4 support as experimental, and layout control is limited (see §8).

| Level | Diagram | Section |
|---|---|---|
| 1 | System Context | §2 |
| 2 | Containers | §3 |
| 3 | Components: code location | §4 |
| — | Dynamic: drift → forecast → announce; ingest outage recovery; late-joiner consumer | §5 |
| — | Deployment: ship, shore, test rig | §6 |

Notation, consistent with SRD §5.3 and `system-architecture.md` §5.4:

- **Ours (build):** element names without a product. For example, "Ingestion service".
- **Adopted (off the shelf):** the candidate product and licence are given in the technology field. For example, "Mosquitto, EPL-2.0".
- Stores are adopted products that hold **our data and schemas** (§5.3 of the architecture doc).

---

## 1. Scope and assumptions

Carries forward assumptions A1–A4 (`system-architecture.md` §1.1), and adds the following, decided in the interview of Nov 13, 2026:

| # | Decision |
|---|---|
| C1 | Model the production system only. The demonstrator already projects it (SYS-1–6). |
| C2 | Levels: Context, Container, Component (code location only), Dynamic (three flows), Deployment. No Code level. |
| C3 | Three deployment environments: **ship** (production), **shore**, and a **shore test rig**. |
| C4 | Onboard hosts are **logical deployment nodes, unsized**. They may share hardware. Sizing is an open question (§7). |
| C5 | The shore link carries **climatology updates** (shore → ship) and **data back to shore** (ship → shore). It does not carry software or remote monitoring. |
| C6 | Software reaches the ship on **physical media in port**: signed images and an SBOM, loaded into an onboard registry. |
| C7 | The test rig is an **integration mirror**: the same container set and zones on smaller hardware, with a sensor replayer in place of real instruments. Release images are validated here before they are written to port media. |
| C8 | Actors: **watchkeeper/forecaster**, **onboard maintainer**, **shore analyst**. |

---

## 2. Level 1 — System Context

Two software systems are in scope. One is the **onboard forecast pipeline**. The other is **shore support**, which is new in this document: it distributes climatology, receives returned data, and builds releases.

```mermaid
C4Context
  title System Context — onboard forecast pipeline

  Enterprise_Boundary(ship, "Ship") {
    Person(watch, "Watchkeeper / forecaster", "Requests forecast runs; watches run status.")
    Person(maint, "Onboard maintainer", "Monitors health; installs releases from port media; restarts services.")
    System_Ext(instr, "Onboard instruments", "Sensors and DAQ hardware on the OT network.")
    System(pipe, "Onboard forecast pipeline", "Ingests observations, runs assimilation forecasts, detects features, announces results.")
    System_Ext(cons, "Onboard consumer systems", "Mission systems that use forecasts and features.")
  }

  Enterprise_Boundary(shore, "Shore") {
    System(shoresup, "Shore support", "Stages climatology, archives returned data, builds and validates releases.")
    System_Ext(clim, "Climatology provider", "Source of reference ocean climatology.")
    Person_Ext(analyst, "Shore analyst", "Studies returned observations, forecasts and features.")
  }

  Rel(instr, pipe, "Observations", "SensorThings over MQTT")
  Rel(pipe, cons, "Announcements; forecast and feature queries", "MQTT, OGC APIs")
  Rel(watch, pipe, "Requests runs, views status", "HTTPS")
  Rel(maint, pipe, "Monitors, installs, restarts", "HTTPS, console")
  BiRel(pipe, shoresup, "Climatology in; data out", "Intermittent shore link")
  Rel(clim, shoresup, "Climatology products")
  Rel(analyst, shoresup, "Queries archive")
  Rel(shoresup, maint, "Release media, carried in port", "Physical media")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## 3. Level 2 — Containers

### 3.1 Onboard forecast pipeline

```mermaid
C4Container
  title Containers — onboard forecast pipeline

  System_Ext(instr, "Onboard instruments", "Serial, NMEA, Modbus")
  Person(watch, "Watchkeeper")
  Person(maint, "Onboard maintainer")
  System_Ext(cons, "Onboard consumer systems")
  System_Ext(shoresup, "Shore support")

  System_Boundary(pipe, "Onboard forecast pipeline") {
    Container(gw, "DAQ gateway", "Vendor DAQ + our SensorThings adapter", "Translates instrument output into SensorThings Observation messages.")
    ContainerQueue(sbrk, "Sensor broker", "Mosquitto, EPL-2.0", "Persistent queue (QoS 1, disk persistence).")
    Container(ing, "Ingestion service", "Python, ioos_qc", "Validates observations; only writer to the Observations DB. Acks after commit.")
    Container(dweb, "Dagster webserver", "Dagster, Apache-2.0", "Run status UI; manual run requests.")
    Container(dd, "Dagster daemon", "Dagster, Apache-2.0", "Evaluates sensors and schedules; owns the run queue.")
    Container(cl, "Code location", "Python", "Asset/sensor definitions, run glue, shims and our in-process modules (see §4).")
    ContainerDb(dmeta, "Dagster metadata DB", "PostgreSQL", "Run history, schedules, sensor cursors.")
    Container(mr, "Model runner", "Container via Dagster Pipes", "Assimilation; stages then atomically commits forecasts.")
    ContainerDb(obs, "Observations DB", "PostgreSQL + TimescaleDB (Apache ed.)", "SensorThings schema.")
    ContainerDb(cov, "Coverage store", "NetCDF / Zarr on filesystem", "Climatology and forecasts; atomic manifest swap.")
    ContainerDb(fdb, "Features DB", "PostGIS, GPL-2.0", "Fronts and eddies, tagged by forecast id.")
    Container(pga, "pygeoapi", "pygeoapi, MIT", "Read-only SensorThings, EDR and Features APIs.")
    ContainerQueue(brk, "Announcement broker", "Mosquitto, EPL-2.0", "Retained announcements for late joiners.")
    Container(sync, "Shore sync agent", "Ours (thin) on adopted transfer tool", "Imports climatology; returns data when the link is up.")
    Container(reg, "Onboard registry", "OCI registry (e.g. CNCF Distribution, Apache-2.0)", "Holds signed images loaded from port media.")
    Container(mon, "Observability", "Prometheus, Grafana, Loki", "Metrics, logs and alerts, onboard only.")
  }

  Rel(instr, gw, "Raw readings")
  Rel(gw, sbrk, "Publishes Observations", "MQTT")
  Rel(sbrk, ing, "Delivers in order", "MQTT, persistent session")
  Rel(ing, obs, "Writes Observations", "SQL")
  Rel(watch, dweb, "Requests runs", "HTTPS")
  Rel(dweb, dmeta, "Reads/writes")
  Rel(dd, dmeta, "Reads/writes")
  Rel(dd, cl, "Evaluates sensors, launches runs", "gRPC")
  Rel(cl, mr, "Launches", "Dagster Pipes")
  Rel(cl, pga, "Reads", "HTTP")
  Rel(mr, pga, "Reads observations, background", "HTTP")
  Rel(mr, cov, "Commits forecast")
  Rel(cl, fdb, "Writes features", "SQL")
  Rel(cl, brk, "Publishes announcement", "MQTT")
  Rel(pga, obs, "Reads", "SQL, read-only role")
  Rel(pga, cov, "Reads")
  Rel(pga, fdb, "Reads", "SQL, read-only role")
  Rel(brk, cons, "Announcements", "MQTT")
  Rel(cons, pga, "Queries", "OGC APIs")
  BiRel(sync, shoresup, "Climatology in; data out", "Shore link")
  Rel(sync, cov, "Commits climatology")
  Rel(maint, mon, "Monitors", "HTTPS")
  Rel(maint, reg, "Loads release media")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

Only the main data relations are drawn. Every service also pulls its image from the onboard registry and exports metrics and logs to observability. Those relations are omitted for legibility.

### 3.2 Shore support

```mermaid
C4Container
  title Containers — shore support

  System_Ext(clim, "Climatology provider")
  System_Ext(pipe, "Onboard forecast pipeline")
  Person_Ext(analyst, "Shore analyst")
  Person(maint, "Onboard maintainer")

  System_Boundary(ss, "Shore support") {
    Container(cstage, "Climatology staging", "Ours (thin)", "Regrids/validates provider climatology into the onboard format; versions it.")
    Container(ssync, "Shore sync endpoint", "Same transfer tool as onboard", "Counterpart of the onboard shore sync agent.")
    ContainerDb(arch, "Shore archive", "PostgreSQL/PostGIS + object store", "Returned observations, forecasts and features.")
    Container(rel, "Release pipeline", "CI, signing, SBOM", "Builds, scans and signs images; writes port media.")
    Container(rig, "Test rig", "Integration mirror (§6.3)", "Validates each release before it goes on media.")
  }

  Rel(clim, cstage, "Climatology products")
  Rel(cstage, ssync, "Versioned climatology")
  BiRel(ssync, pipe, "Climatology out; data in", "Shore link, intermittent")
  Rel(ssync, arch, "Stores returned data")
  Rel(analyst, arch, "Queries")
  Rel(rel, rig, "Deploys candidate release")
  Rel(rel, maint, "Port media", "Physical")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## 4. Level 3 — Components of the code location

This diagram is where the import boundary meets the process boundary (`system-architecture.md` §1.4 point 1). Everything below runs in **one process**. The model runner is the only module of ours that is isolated in its own process.

```mermaid
C4Component
  title Components — code location process

  Container(dd, "Dagster daemon")
  Container(mr, "Model runner", "Pipes container")
  Container(pga, "pygeoapi")
  ContainerDb(fdb, "Features DB")
  ContainerQueue(brk, "Announcement broker")

  Container_Boundary(cl, "Code location (one process)") {
    Component(defs, "Definitions", "Dagster @asset, @sensor, @schedule", "Assets: climatology, forecast, features, announcement. Drift sensor; staleness schedule.")
    Component(glue, "Run glue", "Orchestrator glue (ours)", "Coalesces queued requests and their causes (ORC-2); capped retry + alert.")
    Component(shims, "Shims", "check, run, detect, announce", "One per crossing; pass-through only (ARC-2).")
    Component(drift, "Drift monitor", "Our module", "Residuals in sigma; quorum and persistence (DRF-1–5).")
    Component(det, "Feature detector", "Our module", "Fronts and eddies from the forecast.")
    Component(ann, "Announcer", "Our module", "Builds the announcement; owns the message contract (ORC-5).")
    Component(pipes, "Pipes client", "dagster-pipes", "Launches the model runner and relays its logs and results.")
    Component(rd, "Read client", "HTTP, ours", "The only read path, via pygeoapi.")
  }

  Rel(dd, defs, "Evaluates / launches")
  Rel(defs, glue, "Run requests")
  Rel(defs, shims, "Calls")
  Rel(shims, drift, "check")
  Rel(shims, pipes, "run")
  Rel(shims, det, "detect")
  Rel(shims, ann, "announce")
  Rel(pipes, mr, "Launches", "Dagster Pipes")
  Rel(drift, rd, "Reads observations, forecast")
  Rel(det, rd, "Reads forecast")
  Rel(rd, pga, "HTTP")
  Rel(det, fdb, "Writes features", "SQL")
  Rel(ann, brk, "Publishes", "MQTT")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

Boundary rules (ARC-1, ARC-7): the drift monitor, feature detector and announcer import neither Dagster nor the shims nor the deployment model. The run glue and the Pipes client are **orchestrator glue**. They are custom code, but they are neither our special sauce nor off the shelf, and they need an owner (`system-architecture.md` §5.3).

---

## 5. Dynamic diagrams

Steps are numbered in the labels. Mermaid's `C4Dynamic` draws relations in the order they are declared.

### 5.1 Drift → forecast → announce

```mermaid
C4Dynamic
  title Dynamic — drift triggers a forecast and announcement

  Container(dd, "Dagster daemon")
  Container(cl, "Code location")
  Container(mr, "Model runner")
  Container(pga, "pygeoapi")
  ContainerDb(cov, "Coverage store")
  ContainerDb(fdb, "Features DB")
  ContainerQueue(brk, "Announcement broker")
  System_Ext(cons, "Consumer")

  Rel(dd, cl, "1. Evaluate drift sensor (every >=30 s)")
  Rel(cl, pga, "2. Read latest observations and current forecast")
  Rel(cl, dd, "3. Drift declared: run request (merged if one is queued)")
  Rel(dd, cl, "4. Launch run")
  Rel(cl, mr, "5. Launch model runner (Pipes)")
  Rel(mr, pga, "6. Read observations, background, climatology")
  Rel(mr, cov, "7. Stage, then commit forecast Fn atomically with digest")
  Rel(cl, pga, "8. Detect: read Fn")
  Rel(cl, fdb, "9. Write features tagged Fn")
  Rel(cl, brk, "10. Publish retained announcement")
  Rel(brk, cons, "11. Deliver announcement")
  Rel(cons, pga, "12. Query Fn and features; verify digest and count")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

A step that fails (5–9) is retried with backoff, up to a cap. After that an alert is raised, and the staleness schedule becomes the recovery path (`system-architecture.md` §1.4 point 4).

### 5.2 Ingest outage recovery

```mermaid
C4Dynamic
  title Dynamic — Observations DB outage and recovery

  Container(gw, "DAQ gateway")
  ContainerQueue(sbrk, "Sensor broker")
  Container(ing, "Ingestion service")
  ContainerDb(obs, "Observations DB")
  Container(cl, "Code location")
  Container(mon, "Observability")

  Rel(gw, sbrk, "1. Publish Observations (continues throughout)")
  Rel(sbrk, ing, "2. Deliver next message")
  Rel(ing, obs, "3. Commit fails: DB down; message not acked")
  Rel(ing, mon, "4. Alert: ingestion blocked, backlog growing")
  Rel(cl, obs, "5. Model reads fail via pygeoapi; runs retry with backoff")
  Rel(ing, obs, "6. DB back: commit succeeds")
  Rel(ing, sbrk, "7. Ack; next message. Backlog drains in order, nothing lost")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

Step 5 is shown as a direct relation for brevity. The real path goes through pygeoapi. The sensor broker's disk must hold the longest DB outage you expect (`system-architecture.md` §1.3).

### 5.3 Late-joiner consumer

```mermaid
C4Dynamic
  title Dynamic — a consumer joins mid-run

  System_Ext(cons, "New consumer")
  ContainerQueue(brk, "Announcement broker")
  Container(pga, "pygeoapi")
  ContainerDb(cov, "Coverage store")
  ContainerDb(fdb, "Features DB")

  Rel(cons, brk, "1. Subscribe")
  Rel(brk, cons, "2. Deliver retained latest announcement")
  Rel(cons, pga, "3. Query forecast Fn (EDR) and features")
  Rel(pga, cov, "4. Read committed Fn")
  Rel(pga, fdb, "5. Read features tagged Fn")
  Rel(cons, cons, "6. Verify digest and feature count")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## 6. Deployment diagrams (the physical view)

### 6.1 Ship — production

The deployment nodes are **logical** (C4). Nodes in the processing enclave may share physical hosts, so the diagram does not size or count servers. Container runtime: Docker Compose or k3s on hardened hosts (A4).

```mermaid
C4Deployment
  title Deployment — ship (production)

  Deployment_Node(ot, "Instrument network (OT)", "Isolated segment; no inbound from mission") {
    Deployment_Node(daq, "DAQ gateways", "Vendor hardware") {
      Container(gw, "DAQ gateway", "SensorThings adapter")
    }
    Deployment_Node(ingh, "Ingestion host", "Linux, container runtime") {
      ContainerQueue(sbrk, "Sensor broker", "Mosquitto")
      Container(ing, "Ingestion service")
    }
  }

  Deployment_Node(enc, "Processing enclave", "Segment behind OT and DMZ firewalls") {
    Deployment_Node(orch, "Orchestration node", "Logical") {
      Container(dweb, "Dagster webserver")
      Container(dd, "Dagster daemon")
      Container(cl, "Code location")
      ContainerDb(dmeta, "Dagster metadata DB")
    }
    Deployment_Node(comp, "Compute node", "Logical") {
      Container(mr, "Model runner", "Pipes")
    }
    Deployment_Node(datan, "Data node", "Logical") {
      ContainerDb(obs, "Observations DB")
      ContainerDb(cov, "Coverage store")
      ContainerDb(fdb, "Features DB")
    }
    Deployment_Node(ops, "Ops node", "Logical") {
      Container(mon, "Observability")
      Container(reg, "Onboard registry")
      Container(sync, "Shore sync agent")
    }
  }

  Deployment_Node(dmz, "Distribution zone", "DMZ") {
    Deployment_Node(dist, "Distribution host", "Linux, reverse proxy") {
      Container(pga, "pygeoapi")
      ContainerQueue(brk, "Announcement broker", "Mosquitto")
    }
  }

  Deployment_Node(mis, "Mission network", "Separate segment") {
    Container_Ext(cons, "Onboard consumer systems")
  }

  Deployment_Node(link, "Shore link gateway", "Satcom, intermittent") {
    Container_Ext(sat, "Link terminal", "Ship-owned satcom")
  }

  Rel(gw, sbrk, "MQTT")
  Rel(ing, obs, "SQL via OT-to-enclave firewall")
  Rel(cl, mr, "Pipes")
  Rel(mr, cov, "Commit")
  Rel(cl, brk, "MQTT, enclave to DMZ")
  Rel(pga, obs, "SQL, DMZ to enclave, read-only")
  Rel(brk, cons, "MQTT via DMZ-to-mission firewall")
  Rel(cons, pga, "HTTPS")
  Rel(sync, sat, "Outbound only")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="2")
```

Firewall rules implied by the diagram. Each one should become a test on the test rig (§6.3):

| From → to | Allowed | Purpose |
|---|---|---|
| OT → enclave | Ingestion → Observations DB (SQL) only | Single writer |
| Enclave → OT | None | OT accepts no inbound (A2) |
| Enclave ↔ DMZ | Code location/model runner → pygeoapi; code location → broker; pygeoapi → stores (read-only) | Single read path |
| DMZ → mission | Broker → consumers; consumers → pygeoapi (inbound to DMZ) | Distribution |
| Mission → enclave | **Open question:** watchkeeper → Dagster webserver | See §7 |
| Enclave → shore link | Shore sync agent only, outbound | Data out, climatology in |

### 6.2 Shore

```mermaid
C4Deployment
  title Deployment — shore

  Deployment_Node(sdc, "Shore data centre", "Organisation-managed") {
    Deployment_Node(sapp, "Shore app host", "Linux, container runtime") {
      Container(cstage, "Climatology staging")
      Container(ssync, "Shore sync endpoint")
    }
    Deployment_Node(sdata, "Shore data host", "Linux") {
      ContainerDb(arch, "Shore archive")
    }
    Deployment_Node(ci, "Build infrastructure", "CI runners, signing key in HSM") {
      Container(rel, "Release pipeline")
    }
  }

  Deployment_Node(media, "Port media", "Encrypted removable drive, carried aboard") {
    Container(img, "Release bundle", "Artefact bundle", "Signed images, SBOM, climatology baseline")
  }

  Deployment_Node(sgw, "Shore link gateway", "Satcom ground segment") {
    Container_Ext(gs, "Ground station", "Satcom provider")
  }

  System_Ext(clim, "Climatology provider")

  Rel(clim, cstage, "Download")
  Rel(cstage, ssync, "Versioned climatology")
  BiRel(ssync, gs, "Sync sessions")
  Rel(ssync, arch, "Returned data")
  Rel(rel, img, "Writes bundle after rig pass")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="2")
```

### 6.3 Shore test rig — integration mirror

The test rig has the same zones and the same container set as the ship, on smaller hardware. Two things differ:

- A **sensor replayer** replaces the instruments and DAQ gateways. It publishes recorded or synthetic SensorThings messages to the sensor broker.
- A **consumer simulator** replaces the mission systems. It subscribes, queries and verifies (CON-1–3).

```mermaid
C4Deployment
  title Deployment — shore test rig (integration mirror)

  Deployment_Node(rot, "Rig OT segment", "VLAN") {
    Deployment_Node(rpl, "Replayer host", "Linux") {
      Container(rep, "Sensor replayer", "Ours (test)", "Recorded and synthetic SensorThings messages.")
      ContainerQueue(sbrk, "Sensor broker")
      Container(ing, "Ingestion service")
    }
  }

  Deployment_Node(renc, "Rig enclave segment", "VLAN") {
    Deployment_Node(rsrv, "Rig server", "Single host; all enclave nodes") {
      Container(orchs, "Dagster webserver, daemon, code location, metadata DB")
      Container(mr, "Model runner")
      ContainerDb(stores, "Observations DB, coverage store, Features DB")
      Container(sync, "Shore sync agent")
    }
  }

  Deployment_Node(rdmz, "Rig DMZ segment", "VLAN") {
    Deployment_Node(rdist, "Rig distribution host", "Linux") {
      Container(pga, "pygeoapi")
      ContainerQueue(brk, "Announcement broker")
    }
  }

  Deployment_Node(rmis, "Rig mission segment", "VLAN") {
    Container(csim, "Consumer simulator", "Ours (test)", "Subscribes, queries, verifies.")
  }

  Container_Ext(rel, "Release pipeline", "Shore CI")

  Rel(rep, sbrk, "MQTT")
  Rel(ing, stores, "SQL via rig firewall")
  Rel(brk, csim, "MQTT")
  Rel(csim, pga, "HTTPS")
  Rel(rel, orchs, "Deploys candidate release to all rig hosts")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="2")
```

What the rig proves: the release images start; the firewall rules in §6.1 hold (including negative tests); the dynamic flows in §5 work end to end, including DB and ingestion restarts; and shore sync works against a link simulator that can be switched on and off.

What it does not prove: real instrument protocols and the DAQ adapter, production-scale performance, or hardware failover.

---

## 7. Open questions raised by this model

| # | Question | Why it matters |
|---|---|---|
| Q1 | **How does the watchkeeper reach the Dagster webserver?** It sits in the processing enclave, and watchkeepers sit on the mission network. | The options are: open mission → enclave HTTPS for one host (this weakens the zone model); a console inside the enclave; or a small run-request API in the DMZ. |
| Q2 | **Where does shore sync read from?** | Through pygeoapi (consistent with the read-path decision, but slow for bulk transfer), or by direct read-only replication of the stores (efficient, but a second read path). |
| Q3 | **Climatology commit.** The shore sync agent becomes a second writer to the coverage store. | It must use the same staging + manifest-swap commit as the model runner, and must not swap climatology during a run. Who owns that convention? |
| Q4 | **Onboard host sizing and count** (C4). | The model runner and the databases are the likely contention. Decide before buying hardware; the rig can measure it. |
| Q5 | **Port media cadence.** | Security fixes wait for the next port call. Is an emergency path over the link ever acceptable? |
| Q6 | **Rollback onboard.** | The onboard registry should keep the previous release; the maintainer needs a documented rollback. |
| Q7 | **Time sync (PTP/NTP) and backup** are not drawn. | Observation timestamps drive freshness (`system-architecture.md` §1.4 point 6), so time is a correctness dependency, not just operations. |

---

## 8. Critical analysis

- **The physical view is still mostly logical.** Unsized deployment nodes (C4) make the diagrams honest, but they defer the decision a physical view usually exists to make: how many boxes, and what shares a host. Q4 should close before the ship deployment is treated as stable.
- **New containers expand scope.** The shore sync agent, onboard registry, shore support system and test rig are not in the SRD. Each needs an owner, and two of them (sync agent, registry) open new paths across zone boundaries. The sync agent is the first container in the enclave that talks to the outside world. It is the one most likely to be challenged in a security review.
- **Read-path tension.** "pygeoapi is the only read path" was decided for our modules. Data back to shore (Q2) and climatology import (Q3) test that rule from both directions. Either extend the rule explicitly or record the exceptions.
- **Mission access to the orchestrator UI (Q1) conflicts with zone separation.** A watchkeeper actor implies a path that the zone model does not provide today. This is the most important design gap the Context diagram exposes.
- **Mermaid C4 is a compromise.** It renders on GitHub, but its layout is crude. Deployment diagrams with more than about 15 elements get cramped, and the step order in Dynamic diagrams is only conventional. There is also no single model: the eight diagrams are maintained by hand and can drift from each other, from `system-architecture.md` §1.2 and from `deployment.ts`. If this document is chosen over §1.2, consider Structurizr DSL, or a test that checks container names against `deployment.ts` placements.
- **Naming differs from `deployment.ts`.** "Ops node" and "Shore link gateway" do not exist in the demonstrator, and the demonstrator's "Sea" zone has no production meaning. That is acceptable while the documents are compared, but must be reconciled afterwards.
- **The test rig's blind spot is the edge that fails most.** The replayer bypasses the DAQ adapter and instrument protocols, which are often the least reliable parts at sea. A small bench of real instruments, or vendor simulators, would close that gap.
- **The "ours" vs "adopted" line is clearer here than in the SRD.** The technology field names the product and licence for every adopted container, so licence traps (TimescaleDB edition, PostGIS GPL, avoiding MinIO's AGPL) are visible on the diagrams themselves.

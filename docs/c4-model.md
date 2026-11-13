# C4 Model — Production Candidate (Physical View)

Companion to `srd.md` (v2) and `docs/system-architecture.md`. Status: **draft for review (Nov 13, 2026)**.

This is an alternative to `docs/system-architecture.md` §1.2–1.3, kept as a separate document so the two can be compared. It describes the **eventual production system**, not the demonstrator. Like the rest of the architecture material, it is a candidate design, not a commitment.

Diagrams are Mermaid flowcharts styled with C4 conventions, and Mermaid sequence diagrams for the Dynamic views. Both render on GitHub with no tooling. Mermaid's dedicated C4 syntax was tried first and dropped because its layout was unreadable (§8).

| Level | Diagram | Section |
|---|---|---|
| 1 | System Context | §2 |
| 2 | Containers | §3 |
| 3 | Components: code location | §4 |
| — | Dynamic: drift → forecast → announce; ingest outage recovery; late-joiner consumer | §5 |
| — | Deployment: ship, shore, test rig | §6 |

Notation, consistent with SRD §5.3 and `system-architecture.md` §5.4:

- **Dark blue, solid border:** ours (build). **Light blue, dashed border:** adopted (off the shelf). **Grey:** external system. **Navy rounded:** person. **Cylinder:** data store. **Dashed grey frame:** system boundary or network zone. **Thick arrow:** crosses a zone boundary.

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
flowchart LR
  subgraph SHIP["Ship"]
    direction LR
    instr["<b>Onboard instruments</b><br/><i>[External system]</i>"]:::ext
    watch(["<b>Watchkeeper / forecaster</b><br/><i>[Person]</i>"]):::person
    maint(["<b>Onboard maintainer</b><br/><i>[Person]</i>"]):::person
    pipe["<b>Onboard forecast pipeline</b><br/><i>[Software system]</i><br/>Ingests, forecasts,<br/>detects features, announces"]:::ours
    cons["<b>Onboard consumer systems</b><br/><i>[External system]</i>"]:::ext
  end
  subgraph SHORE["Shore"]
    direction TB
    clim["<b>Climatology provider</b><br/><i>[External system]</i>"]:::ext
    shoresup["<b>Shore support</b><br/><i>[Software system]</i><br/>Climatology, archive, releases"]:::ours
    analyst(["<b>Shore analyst</b><br/><i>[Person]</i>"]):::person
  end
  instr -->|"Observations<br/><i>SensorThings/MQTT</i>"| pipe
  watch -->|"Requests runs,<br/>views status"| pipe
  maint -->|"Monitors, installs,<br/>restarts"| pipe
  pipe -->|"Announcements;<br/>OGC API queries"| cons
  pipe <-.->|"Climatology in, data out<br/><i>intermittent shore link</i>"| shoresup
  clim --> shoresup
  analyst -->|"Queries archive"| shoresup
  shoresup -.->|"Release media<br/><i>carried in port</i>"| maint
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class SHIP,SHORE zone
```

---

## 3. Level 2 — Containers

### 3.1 Onboard forecast pipeline

```mermaid
flowchart LR
  instr["<b>Onboard instruments</b>"]:::ext
  watch(["<b>Watchkeeper</b>"]):::person
  maint(["<b>Onboard maintainer</b>"]):::person
  shore["<b>Shore support</b>"]:::ext
  cons["<b>Onboard consumer systems</b>"]:::ext

  subgraph PIPE["Onboard forecast pipeline"]
    subgraph INGEST["Ingest"]
      gw["<b>DAQ gateway</b><br/><i>vendor DAQ + our adapter</i>"]:::ours
      sbrk["<b>Sensor broker</b><br/><i>Mosquitto</i>"]:::adopted
      ing["<b>Ingestion service</b><br/><i>Python, ioos_qc</i>"]:::ours
    end
    subgraph ORCH["Orchestrate and compute"]
      dweb["<b>Dagster webserver</b>"]:::adopted
      dd["<b>Dagster daemon</b><br/><i>+ metadata DB, Postgres</i>"]:::adopted
      cl["<b>Code location</b><br/><i>glue, shims, our modules</i>"]:::ours
      mr["<b>Model runner</b><br/><i>Pipes container</i>"]:::ours
    end
    subgraph OPS["Operate"]
      sync["<b>Shore sync agent</b>"]:::ours
      reg["<b>Onboard registry</b><br/><i>OCI registry</i>"]:::adopted
      mon["<b>Observability</b><br/><i>Prometheus, Grafana, Loki</i>"]:::adopted
    end
    subgraph STORE["Stores (our data)"]
      fdb[("<b>Features DB</b><br/><i>PostGIS</i>")]:::adopted
      cov[("<b>Coverage store</b><br/><i>NetCDF / Zarr</i>")]:::adopted
      obs[("<b>Observations DB</b><br/><i>Postgres + Timescale</i>")]:::adopted
    end
    subgraph DIST["Distribute"]
      pga["<b>pygeoapi</b><br/><i>read-only OGC APIs</i>"]:::adopted
      brk["<b>Announcement broker</b><br/><i>Mosquitto, retained</i>"]:::adopted
    end
  end

  instr --> gw --> sbrk --> ing -->|"writes"| obs
  watch --> dweb --> dd
  dd -->|"sensors, runs"| cl
  cl -->|"Pipes"| mr
  mr -->|"commits forecast"| cov
  cl -->|"writes features"| fdb
  cl -->|"publishes"| brk
  sync <-.->|"shore link"| shore
  sync -->|"commits climatology"| cov
  maint -->|"monitors, installs"| OPS
  STORE <-.->|"read-only"| pga
  brk -->|"announcements"| cons
  pga <-->|"OGC API queries"| cons
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class PIPE zone
  class INGEST,ORCH,OPS,STORE,DIST host
```

Only the main data relations are drawn. Every service also pulls its image from the onboard registry and exports metrics and logs to observability. Those relations are omitted for legibility.

### 3.2 Shore support

```mermaid
flowchart LR
  clim["<b>Climatology provider</b>"]:::ext
  pipe["<b>Onboard forecast pipeline</b>"]:::ext
  analyst(["<b>Shore analyst</b>"]):::person
  maint(["<b>Onboard maintainer</b>"]):::person
  subgraph SS["Shore support"]
    direction LR
    cstage["<b>Climatology staging</b><br/><i>ours, thin</i>"]:::ours
    ssync["<b>Shore sync endpoint</b><br/><i>same tool as onboard</i>"]:::adopted
    arch[("<b>Shore archive</b><br/><i>PostGIS + object store</i>")]:::adopted
    rel["<b>Release pipeline</b><br/><i>CI, signing, SBOM</i>"]:::ours
    rig["<b>Test rig</b><br/><i>integration mirror</i>"]:::ours
  end
  clim --> cstage --> ssync
  ssync <-.->|"shore link"| pipe
  ssync --> arch
  analyst --> arch
  rel -->|"deploys candidate"| rig
  rel -.->|"port media"| maint
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class SS zone
```

---

## 4. Level 3 — Components of the code location

This diagram is where the import boundary meets the process boundary (`system-architecture.md` §1.4 point 1). Everything below runs in **one process**. The model runner is the only module of ours that is isolated in its own process.

```mermaid
flowchart LR
  dd["<b>Dagster daemon</b>"]:::adopted
  subgraph CL["Code location (one process)"]
    direction LR
    defs["<b>Definitions</b><br/><i>@asset, @sensor, @schedule</i>"]:::adopted
    glue["<b>Run glue</b><br/><i>coalesce, capped retry</i>"]:::ours
    subgraph SH["Shims"]
      direction TB
      sc["check"]:::ours
      sr["run"]:::ours
      sd["detect"]:::ours
      sa["announce"]:::ours
    end
    subgraph MOD["Our modules"]
      direction TB
      drift["<b>Drift monitor</b>"]:::ours
      det["<b>Feature detector</b>"]:::ours
      ann["<b>Announcer</b>"]:::ours
    end
    pipes["<b>Pipes client</b><br/><i>dagster-pipes</i>"]:::adopted
    rd["<b>Read client</b><br/><i>only read path</i>"]:::ours
  end
  mr["<b>Model runner</b><br/><i>separate process</i>"]:::ours
  pga["<b>pygeoapi</b>"]:::adopted
  fdb[("<b>Features DB</b>")]:::adopted
  brk["<b>Announcement broker</b>"]:::adopted

  dd --> defs
  defs --> glue
  defs --> SH
  sc --> drift
  sr --> pipes
  sd --> det
  sa --> ann
  pipes -->|"Dagster Pipes"| mr
  drift & det --> rd
  rd --> pga
  det --> fdb
  ann --> brk
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class CL zone
  class SH,MOD host
```

Boundary rules (ARC-1, ARC-7): the drift monitor, feature detector and announcer import neither Dagster nor the shims nor the deployment model. The run glue and the Pipes client are **orchestrator glue**. They are custom code, but they are neither our special sauce nor off the shelf, and they need an owner (`system-architecture.md` §5.3).

---

## 5. Dynamic diagrams

Drawn as sequence diagrams, with numbered steps. A sequence diagram shows order better than C4's numbered-arrow form.

### 5.1 Drift → forecast → announce

```mermaid
sequenceDiagram
  autonumber
  participant DD as Dagster daemon
  participant CL as Code location
  participant MR as Model runner
  participant PGA as pygeoapi
  participant ST as Coverage store / Features DB
  participant BRK as Announcement broker
  participant CON as Consumer
  DD->>CL: Evaluate drift sensor (every ≥30 s)
  CL->>PGA: Read latest observations, current forecast
  CL-->>DD: Drift declared: run request (merged if one is queued)
  DD->>CL: Launch run
  CL->>MR: Launch model runner (Pipes)
  MR->>PGA: Read observations, background, climatology
  MR->>ST: Stage, then commit forecast Fn with digest
  CL->>PGA: Detect: read Fn
  CL->>ST: Write features tagged Fn
  CL->>BRK: Publish retained announcement
  BRK->>CON: Deliver announcement
  CON->>PGA: Query Fn and features
  CON->>CON: Verify digest and feature count
```

A step that fails (5–9) is retried with backoff, up to a cap. After that an alert is raised, and the staleness schedule becomes the recovery path (`system-architecture.md` §1.4 point 4).

### 5.2 Ingest outage recovery

```mermaid
sequenceDiagram
  autonumber
  participant GW as DAQ gateway
  participant SB as Sensor broker
  participant ING as Ingestion service
  participant OBS as Observations DB
  participant MON as Observability
  participant CL as Code location
  GW->>SB: Publish Observations (continues throughout)
  SB->>ING: Deliver next message
  ING-xOBS: Commit fails: DB down
  Note over SB,ING: Message not acked — backlog grows on disk
  ING->>MON: Alert: ingestion blocked
  CL-xOBS: Reads fail (via pygeoapi) — runs retry with backoff
  Note over OBS: DB restarts
  ING->>OBS: Commit succeeds
  ING->>SB: Ack — take next message
  Note over SB,OBS: Backlog drains in order — nothing lost
```

Step 5 is drawn as a direct call for brevity. The real path goes through pygeoapi. The sensor broker's disk must hold the longest DB outage you expect (`system-architecture.md` §1.3).

### 5.3 Late-joiner consumer

```mermaid
sequenceDiagram
  autonumber
  participant CON as New consumer
  participant BRK as Announcement broker
  participant PGA as pygeoapi
  participant ST as Coverage store / Features DB
  CON->>BRK: Subscribe
  BRK->>CON: Retained latest announcement (Fn)
  CON->>PGA: Query forecast Fn (EDR) and features
  PGA->>ST: Read committed Fn and features tagged Fn
  PGA->>CON: Results
  CON->>CON: Verify digest and feature count
```

---

## 6. Deployment diagrams (the physical view)

### 6.1 Ship — production

The deployment nodes are **logical** (C4). Nodes in the processing enclave may share physical hosts, so the diagram does not size or count servers. Container runtime: Docker Compose or k3s on hardened hosts (A4).

```mermaid
flowchart LR
  subgraph OT["Instrument network (OT)"]
    subgraph DAQ["DAQ gateways · vendor hw"]
      gw["DAQ gateway"]:::ours
    end
    subgraph INGH["Ingestion host"]
      sbrk["Sensor broker"]:::adopted
      ing["Ingestion service"]:::ours
    end
  end
  subgraph ENC["Processing enclave"]
    subgraph ORN["Orchestration node"]
      dagster["Dagster webserver,<br/>daemon, metadata DB"]:::adopted
      cl["Code location"]:::ours
    end
    subgraph CMP["Compute node"]
      mr["Model runner"]:::ours
    end
    subgraph DAT["Data node"]
      obs[("Observations DB")]:::adopted
      cov[("Coverage store")]:::adopted
      fdb[("Features DB")]:::adopted
    end
    subgraph OPN["Ops node"]
      sync["Shore sync agent"]:::ours
      reg["Onboard registry"]:::adopted
      mon["Observability"]:::adopted
    end
  end
  subgraph DMZ["Distribution zone"]
    subgraph DH["Distribution host"]
      pga["pygeoapi"]:::adopted
      brk["Announcement broker"]:::adopted
    end
  end
  subgraph MIS["Mission network"]
    cons["Consumer systems"]:::ext
  end
  sat["Shore link terminal<br/><i>satcom, intermittent</i>"]:::ext

  gw --> sbrk --> ing
  ing ==>|"SQL · OT→enclave FW"| obs
  dagster --> cl -->|"Pipes"| mr --> cov
  cl ==>|"MQTT · enclave→DMZ"| brk
  DAT <==>|"read-only SQL / files"| pga
  brk ==>|"MQTT · DMZ→mission FW"| cons
  pga <==>|"HTTPS queries"| cons
  sync ==>|"outbound only"| sat
  class OT,ENC,DMZ,MIS zone
  class DAQ,INGH,ORN,CMP,DAT,OPN,DH host
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
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
flowchart LR
  clim["Climatology provider"]:::ext
  subgraph SDC["Shore data centre"]
    direction TB
    subgraph SAPP["Shore app host"]
      cstage["Climatology staging"]:::ours
      ssync["Shore sync endpoint"]:::adopted
    end
    subgraph SDATA["Shore data host"]
      arch[("Shore archive")]:::adopted
    end
    subgraph CI["Build infrastructure · HSM signing"]
      rel["Release pipeline"]:::ours
    end
  end
  gs["Ground station<br/><i>satcom provider</i>"]:::ext
  media["Release bundle<br/><i>encrypted port media:<br/>signed images, SBOM,<br/>climatology baseline</i>"]:::ours
  clim --> cstage --> ssync
  ssync <-.->|"sync sessions"| gs
  ssync --> arch
  rel -->|"after rig pass"| media
  class SDC zone
  class SAPP,SDATA,CI host
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
```

### 6.3 Shore test rig — integration mirror

The test rig has the same zones and the same container set as the ship, on smaller hardware. Two things differ:

- A **sensor replayer** replaces the instruments and DAQ gateways. It publishes recorded or synthetic SensorThings messages to the sensor broker.
- A **consumer simulator** replaces the mission systems. It subscribes, queries and verifies (CON-1–3).

```mermaid
flowchart LR
  rel["Release pipeline"]:::ext
  subgraph ROT["Rig OT VLAN"]
    subgraph RPL["Replayer host"]
      rep["Sensor replayer<br/><i>test tool</i>"]:::ours
      sbrk["Sensor broker"]:::adopted
      ing["Ingestion service"]:::ours
    end
  end
  subgraph RENC["Rig enclave VLAN"]
    subgraph RSRV["Rig server · all enclave nodes on one host"]
      orchs["Dagster + code location"]:::adopted
      mr["Model runner"]:::ours
      stores[("Observations DB,<br/>coverage store,<br/>Features DB")]:::adopted
      sync["Shore sync agent"]:::ours
    end
  end
  subgraph RDMZ["Rig DMZ VLAN"]
    subgraph RDH["Rig distribution host"]
      pga["pygeoapi"]:::adopted
      brk["Announcement broker"]:::adopted
    end
  end
  subgraph RMIS["Rig mission VLAN"]
    csim["Consumer simulator<br/><i>test tool</i>"]:::ours
  end
  linksim["Link simulator<br/><i>on/off</i>"]:::ext

  rel -.->|"deploys candidate"| orchs
  rep --> sbrk --> ing
  ing ==>|"via rig FW"| stores
  orchs --> mr --> stores
  orchs ==> brk
  stores <==> pga
  brk ==> csim
  pga <==> csim
  sync ==> linksim
  class ROT,RENC,RDMZ,RMIS zone
  class RPL,RSRV,RDH host
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
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
- **Mermaid flowcharts are a compromise.** They render on GitHub and lay out far better than Mermaid's C4 mode, but the C4 semantics live only in styling conventions, not in the notation. Some relations are omitted, or drawn to a whole group, to keep the diagrams legible. There is also no single model: the eight diagrams are maintained by hand and can drift from each other, from `system-architecture.md` §1.2 and from `deployment.ts`. If this document is chosen over §1.2, consider Structurizr DSL, or a test that checks container names against `deployment.ts` placements.
- **Naming differs from `deployment.ts`.** "Ops node" and "Shore link gateway" do not exist in the demonstrator, and the demonstrator's "Sea" zone has no production meaning. That is acceptable while the documents are compared, but must be reconciled afterwards.
- **The test rig's blind spot is the edge that fails most.** The replayer bypasses the DAQ adapter and instrument protocols, which are often the least reliable parts at sea. A small bench of real instruments, or vendor simulators, would close that gap.
- **The "ours" vs "adopted" line is clearer here than in the SRD.** The technology field names the product and licence for every adopted container, so licence traps (TimescaleDB edition, PostGIS GPL, avoiding MinIO's AGPL) are visible on the diagrams themselves.

# C4 Model — Production Candidate (Physical View)

Companion to `srd.md` (v2) and `docs/system-architecture.md`. Status: **draft for review (Nov 14, 2026)**. Open questions Q1–Q7 were decided on Nov 14 (§7).

This is an alternative to `docs/system-architecture.md` §1.2–1.3, kept as a separate document so the two can be compared. It describes the **eventual production system**, not the demonstrator. Like the rest of the architecture material, it is a candidate design, not a commitment.

Diagrams are Mermaid flowcharts styled with C4 conventions, and Mermaid sequence diagrams for the Dynamic views. Both render on GitHub with no tooling. Mermaid's dedicated C4 syntax was tried first and dropped because its layout was unreadable (§8).

| Level | Diagram | Section |
|---|---|---|
| 1 | System Context | §2 |
| 2 | Containers: pipeline; operations and shore transfer; shore support | §3 |
| 3 | Components: code location (forecast pipeline; shore transfer) | §4 |
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
| C4 | Onboard hosts are **logical deployment nodes, unsized**. They may share hardware. Sizing is decided by measurement on the test rig (D4). |
| C5 | The shore link carries **climatology updates** (shore → ship) and **data back to shore** (ship → shore). It does not carry software or remote monitoring. |
| C6 | Software reaches the ship on **physical media in port only**: signed images and an SBOM, loaded into an onboard registry. There is no over-the-link path, even for urgent fixes (D5). |
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
    subgraph STORE["Stores (our data)"]
      fdb[("<b>Features DB</b><br/><i>PostGIS</i>")]:::adopted
      cov[("<b>Coverage store</b><br/><i>NetCDF / Zarr</i>")]:::adopted
      obs[("<b>Observations DB</b><br/><i>Postgres + Timescale</i>")]:::adopted
    end
    subgraph DIST["Distribute"]
      pga["<b>pygeoapi</b><br/><i>read-only OGC APIs</i>"]:::adopted
      brk["<b>Announcement broker</b><br/><i>Mosquitto, retained</i>"]:::adopted
      rapi["<b>Run-request API</b><br/><i>ours, thin</i>"]:::ours
    end
  end

  instr --> gw --> sbrk --> ing -->|"writes"| obs
  watch -->|"requests runs,<br/>views status"| rapi
  cl -->|"polls requests,<br/>posts status"| rapi
  dweb --> dd
  dd -->|"sensors, runs"| cl
  cl -->|"Pipes"| mr
  mr -->|"commits forecast"| cov
  cl -->|"writes features"| fdb
  cl -->|"publishes"| brk
  cl -->|"commits climatology"| cov
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
  class INGEST,ORCH,STORE,DIST host
```

Only the main data relations are drawn. Every service also pulls its image from the onboard registry and exports metrics and logs to observability. Those relations are omitted for legibility.

The operations and shore-transfer containers are in §3.2. Two consequences of the Q1–Q3 decisions show across both diagrams:

- **The watchkeeper never reaches the enclave.** They use the run-request API in the distribution zone. The code location polls it (D1). The Dagster webserver remains, for the maintainer, on an enclave console.
- **The shore sync agent writes no store.** It only moves files between the shore link and the transfer area. The orchestrator owns both directions: the `climatology` asset imports from the inbox, and a `shore_export` asset writes bundles to the outbox (D2, D3).

### 3.2 Onboard pipeline — operations and shore transfer

The same system, showing only the containers that operate it and move data to and from shore.

```mermaid
flowchart LR
  maint(["<b>Onboard maintainer</b>"]):::person
  shore["<b>Shore support</b>"]:::ext
  subgraph PIPE["Onboard forecast pipeline"]
    subgraph OPS["Operate"]
      reg["<b>Onboard registry</b><br/><i>OCI registry, keeps N and N-1</i>"]:::adopted
      mon["<b>Observability</b><br/><i>Prometheus, Grafana, Loki</i>"]:::adopted
      dweb["<b>Dagster webserver</b><br/><i>enclave console only</i>"]:::adopted
      bkp["<b>Backup</b><br/><i>e.g. pgBackRest, restic</i>"]:::adopted
    end
    subgraph XFER["Shore transfer"]
      sync["<b>Shore sync agent</b><br/><i>moves files only</i>"]:::ours
      xfer[("<b>Transfer area</b><br/><i>inbox / outbox</i>")]:::adopted
    end
    cl["<b>Code location</b><br/><i>climatology + shore_export assets</i>"]:::ours
    subgraph STORE["Stores (our data)"]
      obs[("<b>Observations DB</b>")]:::adopted
      cov[("<b>Coverage store</b>")]:::adopted
      fdb[("<b>Features DB</b>")]:::adopted
    end
  end
  maint -->|"installs, rolls back"| reg
  maint -->|"monitors"| mon
  maint -->|"inspects runs"| dweb
  shore <-.->|"shore link"| sync
  sync <-->|"verified files"| xfer
  xfer -->|"climatology inbox"| cl
  cl -->|"export bundles to outbox"| xfer
  cl -->|"commits climatology"| cov
  bkp -.->|"nightly"| STORE
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class PIPE zone
  class OPS,XFER,STORE host
```

### 3.3 Shore support

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

### 4.1 Forecast pipeline components

This diagram is where the import boundary meets the process boundary (`system-architecture.md` §1.4 point 1). Everything below runs in **one process**. The model runner is the only module of ours that is isolated in its own process.

```mermaid
flowchart LR
  dd["<b>Dagster daemon</b>"]:::adopted
  subgraph CL["Code location"]
    direction LR
    defs["<b>Definitions</b><br/><i>@asset, @sensor, @schedule</i>"]:::adopted
    glue["<b>Run glue</b><br/><i>coalesce, capped retry,<br/>run-request poller</i>"]:::ours
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
  rapi["<b>Run-request API</b>"]:::ours

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
  glue -->|"polls, posts status"| rapi
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class CL zone
  class SH,MOD host
```

### 4.2 Shore transfer components

The same process, showing the two components added by D2 and D3. Each has its own shim, following ARC-2.

```mermaid
flowchart LR
  subgraph CL["Code location"]
    defs["<b>Definitions</b><br/><i>climatology, shore_export assets</i>"]:::adopted
    subgraph SH["Shims"]
      si["import"]:::ours
      sx["export"]:::ours
    end
    subgraph MOD["Our modules"]
      imp["<b>Climatology importer</b>"]:::ours
      exp["<b>Shore exporter</b>"]:::ours
    end
    rd["<b>Read client</b>"]:::ours
  end
  xin[("<b>Transfer area</b><br/><i>inbox</i>")]:::adopted
  cov[("<b>Coverage store</b>")]:::adopted
  pga["<b>pygeoapi</b>"]:::adopted
  xout[("<b>Transfer area</b><br/><i>outbox</i>")]:::adopted
  defs --> si & sx
  si --> imp
  sx --> exp
  xin -->|"verified climatology"| imp
  imp -->|"stage + manifest swap"| cov
  exp --> rd --> pga
  exp -->|"signed bundles"| xout
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef ours fill:#1168bd,stroke:#0b4884,color:#fff
  classDef adopted fill:#5a9bd8,stroke:#2e6295,color:#fff,stroke-dasharray:6 3
  classDef ext fill:#8a8a8a,stroke:#666,color:#fff
  classDef zone fill:#fafafa,stroke:#999,stroke-dasharray:6 4,color:#333
  classDef host fill:#fff,stroke:#bbb,color:#333
  class CL zone
  class SH,MOD host
```

Boundary rules (ARC-1, ARC-7): the drift monitor, feature detector, announcer, shore exporter and climatology importer import neither Dagster nor the shims nor the deployment model. The run glue and the Pipes client are **orchestrator glue**. They are custom code, but they are neither our special sauce nor off the shelf, and they need an owner (`system-architecture.md` §5.3).

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
      xfer[("Transfer area")]:::adopted
      reg["Onboard registry"]:::adopted
      mon["Observability"]:::adopted
      bkp["Backup"]:::adopted
    end
  end
  subgraph DMZ["Distribution zone"]
    subgraph DH["Distribution host"]
      pga["pygeoapi"]:::adopted
      brk["Announcement broker"]:::adopted
      rapi["Run-request API"]:::ours
    end
  end
  subgraph MIS["Mission network"]
    cons["Consumer systems"]:::ext
    wk["Watchkeeper workstation"]:::ext
  end
  sat["Shore link terminal<br/><i>satcom, intermittent</i>"]:::ext
  gnss["Ship time source<br/><i>GNSS-disciplined</i>"]:::ext

  gw --> sbrk --> ing
  ing ==>|"SQL · OT→enclave FW"| obs
  dagster --> cl -->|"Pipes"| mr --> cov
  cl ==>|"MQTT · enclave→DMZ"| brk
  DAT <==>|"read-only SQL / files"| pga
  brk ==>|"MQTT · DMZ→mission FW"| cons
  pga <==>|"HTTPS queries"| cons
  sync ==>|"outbound only"| sat
  sync --> xfer
  bkp -.->|"nightly"| DAT
  cl ==>|"HTTPS poll · enclave→DMZ"| rapi
  wk ==>|"HTTPS · mission→DMZ"| rapi
  gnss -.->|"NTP/PTP per zone"| OT & ENC & DMZ
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
| Enclave ↔ DMZ | Code location/model runner → pygeoapi; code location → broker; code location → run-request API (poll); pygeoapi → stores (read-only) | Single read path; enclave-initiated requests |
| DMZ → mission | Broker → consumers; consumers → pygeoapi (inbound to DMZ) | Distribution |
| Mission → DMZ | Watchkeeper → run-request API (HTTPS, authenticated) | Run requests and status (D1) |
| Mission → enclave | **None** | Zone model holds (D1) |
| Enclave → shore link | Shore sync agent only, outbound | Data out, climatology in |
| Time | Each zone's NTP/PTP server ← ship time source | Timestamps are a correctness dependency (D7) |

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

What the rig proves: the release images start; a sizing benchmark sets the onboard host count (D4); rollback from N to N-1 works with the release's schema migrations (D6); the firewall rules in §6.1 hold (including negative tests); the dynamic flows in §5 work end to end, including DB and ingestion restarts; and shore sync works against a link simulator that can be switched on and off.

What it does not prove: real instrument protocols and the DAQ adapter, production-scale performance, or hardware failover.

---

## 7. Decisions on the open questions (Nov 14, 2026)

| # | Question | Decision |
|---|---|---|
| D1 | **Q1 — Watchkeeper access.** The watchkeeper is on the mission network; the Dagster webserver is in the enclave. | A thin **run-request API** of ours in the distribution zone. The watchkeeper requests runs and sees status there. **The enclave pulls:** a Dagster sensor polls the API for pending requests and posts run status back. No mission → enclave or DMZ → enclave rule is added. Manual requests wait up to one sensor interval (≥30 s), and they merge with drift and staleness requests through the existing coalescing logic (ORC-2). The Dagster webserver stays enclave-only, for the maintainer. |
| D2 | **Q2 — Data back to shore.** | **Export bundles** produced by a new `shore_export` Dagster asset on a schedule, downstream of forecast and features. It reads through pygeoapi (the single read path holds) via a new `export` shim and writes signed, time-sliced bundles to the outbox. The shore sync agent only ships what is in the outbox. |
| D3 | **Q3 — Climatology commit.** | **Inbox + asset.** The sync agent verifies incoming climatology and drops it in the inbox. The existing `climatology` asset materialises from the inbox via a new `import` shim, using the same stage + manifest-swap commit as forecasts. One run at a time means it never swaps mid-run. The sync agent writes no store. |
| D4 | **Q4 — Host sizing.** | **Measure, then decide.** Nodes stay logical. A rig benchmark (realistic grid size, 6 inputs, backlog drain after an outage, export catch-up after a long link outage) sets the host count, at a gate before hardware procurement. |
| D5 | **Q5 — Urgent fixes.** | **Port media only, no exceptions.** Risk accepted: a critical fix can wait until the next port call. Mitigation is pre-release hardening on the rig and the rollback in D6. |
| D6 | **Q6 — Rollback.** | The onboard registry keeps **N and N-1**. A release is one manifest that pins every image. Rollback is **one documented command** that redeploys N-1. Schema migrations must stay backward-compatible for one release; the rig tests N → N-1 on every release. |
| D7 | **Q7 — Time and backup.** | **Both drawn** (§6.1). Time: the ship's GNSS-disciplined source feeds an NTP/PTP server in each zone. DAQ gateways timestamp at source; ingestion rejects observations with implausible clock skew. Backup: nightly local backup of the databases and coverage store to the ops node; the shore export bundles (D2) are the off-ship copy. |

New items these decisions add: the run-request API, the transfer area, the backup service, the `export` and `import` shims, and the shore exporter and climatology importer modules. None is in the SRD; the demonstrator does not need them.

---

## 8. Critical analysis

- **The physical view is still mostly logical.** Unsized deployment nodes (C4) make the diagrams honest, but they defer the decision a physical view usually exists to make: how many boxes, and what shares a host. D4 turns that into a measured gate, but until the rig benchmark runs, the ship deployment is not stable.
- **New containers expand scope.** The shore sync agent, transfer area, run-request API, backup, onboard registry, shore support system and test rig are not in the SRD. Each needs an owner. The sync agent is still the only container in the enclave that talks to the outside world, but D2/D3 shrink it to a file mover with no store access, which is the strongest position for a security review.
- **Read-path tension resolved, at a cost.** D2 and D3 route both shore flows through the orchestrator, so pygeoapi stays the only read path and the model runner and climatology importer are the only coverage-store writers. The cost: two more assets and shims, and export catch-up after a long link outage loads pygeoapi. The rig benchmark (D4) should measure that.
- **The run-request API is a new attack surface on the DMZ.** D1 keeps mission traffic out of the enclave, but the API accepts input from the mission network and its requests start runs. It needs authentication, rate limiting and a strict request schema. Polling adds up to one sensor interval of latency to manual requests; it may surprise watchkeepers used to an immediate response.
- **Mermaid flowcharts are a compromise.** They render on GitHub and lay out far better than Mermaid's C4 mode, but the C4 semantics live only in styling conventions, not in the notation. Some relations are omitted, or drawn to a whole group, to keep the diagrams legible. There is also no single model: the eight diagrams are maintained by hand and can drift from each other, from `system-architecture.md` §1.2 and from `deployment.ts`. If this document is chosen over §1.2, consider Structurizr DSL, or a test that checks container names against `deployment.ts` placements.
- **Naming differs from `deployment.ts`.** "Ops node" and "Shore link gateway" do not exist in the demonstrator, and the demonstrator's "Sea" zone has no production meaning. That is acceptable while the documents are compared, but must be reconciled afterwards.
- **Port media only (D5) puts weight on the rig and on rollback.** With no emergency path, a defect found at sea is lived with or rolled back. D6's N-1 rollback is the only remedy, so its rig test must not be skipped.
- **The test rig's blind spot is the edge that fails most.** The replayer bypasses the DAQ adapter and instrument protocols, which are often the least reliable parts at sea. A small bench of real instruments, or vendor simulators, would close that gap.
- **The "ours" vs "adopted" line is clearer here than in the SRD.** The technology field names the product and licence for every adopted container, so licence traps (TimescaleDB edition, PostGIS GPL, avoiding MinIO's AGPL) are visible on the diagrams themselves.

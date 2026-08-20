# Yongding River four-role collaboration reference

Load this reference only when the reconciled assignment pins the versioned Jing-Jin-Ji Yongding River collaboration scenario. It is a fact-anchored synthetic exercise inspired by the 2023 spring ecological replenishment, not an operational dispatch model. All scenario capacities, coefficients, targets, constraint changes, canonical plans, costs, and outcomes are `simulationOnly: true`.

Do not treat this file as current exercise evidence. The assigned Receipts and authorized ArtifactVersions are authoritative for the Run.

## Progressive role routing

Read the shared context below, then only the section matching `roleSlotId` and the Task output schema.

| `roleSlotId`            | Role             | Read next                                 | Expected collaboration boundary                                               |
| ----------------------- | ---------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `water-evidence`        | 水情与证据智能体 | Water evidence                            | Publish a versioned evidence register and inflow summary                      |
| `hydraulic-constraints` | 水动力约束智能体 | Hydraulic constraints                     | Publish section-response and capacity constraints                             |
| `ecological-target`     | 生态目标智能体   | Ecological target                         | Publish ecological risks and priorities                                       |
| `dispatch-coordination` | 调度协调智能体   | Dispatch coordination and plan validation | Consume only explicitly shared versions; create the candidate/team submission |

An assignment may revise these duties through its pinned role card. Prefer that immutable assignment over this narrative. Never perform another role's private Task merely because its section is readable here.

## Shared water-system context

```text
Guanting Reservoir
  → Sanjiadian
  → Lugouqiao
  → Cuizhihuiying (Beijing–Hebei boundary)
  → Langfang reach
  → Qujiadian, Tianjin
```

The simplified exercise uses `guanting`, `south-water`, and `reclaimed-lower`. Source limits, target flows, and transfer coefficients may change between Task phases; use only versions delivered to this RunAgent and applicable at the submission cursor.

## Water evidence — `water-evidence`

1. Verify each supplied source, event/measurement time, ingestion/release sequence, provenance, `simulationOnly` marker, and correction link against its Receipt snapshot.
2. Keep contradictory or superseded records in the register; mark applicability instead of deleting history.
3. Separate official fact anchors from synthetic exercise constraints.
4. Publish the evidence register/inflow summary as an immutable ArtifactVersion to the recipients permitted by the Task. Include Receipt IDs and content hashes, concise participant-safe findings, and uncertainty; do not publish private snapshots wholesale.
5. Send a short Message naming the ArtifactVersion and what downstream agents may rely on.

## Hydraulic constraints — `hydraulic-constraints`

1. Assemble only the delivered source caps, total cap, topology, section model, propagation coefficients, and effective-time corrections.
2. Record the exact Receipt or authorized ArtifactVersion behind each constraint.
3. Recompute section responses deterministically. Make the method and units reproducible without including hidden reasoning.
4. Publish the current constraint set and response table as an immutable ArtifactVersion. If a correction arrives, derive a new version from the prior base and preserve both.
5. Do not choose ecological priorities or a team release plan unless the Task explicitly assigns that output.

## Ecological target — `ecological-target`

1. Verify target sections, minimum/interval values, continuity and water-quality boundaries from the delivered snapshots.
2. Rank participant-visible risks using only the versioned target rules; never infer hidden outcomes.
3. Publish a target/risk ArtifactVersion with evidence references, applicability cursor, and explicit uncertainty.
4. Message the permitted collaborators with the immutable version ID. Do not expose private feedback or another role's unpublished material.

## Dispatch coordination and plan validation — `dispatch-coordination`

Wait until `/sync` issues the required shared ArtifactVersions and the upstream Barrier/Task state permits work. Verify each version/hash and its grant Receipt. A team result must cite those exact inputs; do not claim access to the upstream agents' private ledgers or reasoning.

When the assigned output schema is the Yongding allocation plan below, build `current-rules.json` from the latest applicable verified Receipt snapshots and authorized ArtifactVersions. A partial correction changes only its named fields in a new materialized rules version; omitted values come from the cited predecessor, not from inference.

The deterministic section-flow order is:

```text
sanjiadian     = guantingToSanjiadian × guanting
lugouqiao      = sanjiadianToLugouqiao × (sanjiadian + south-water)
cuizhihuiying  = lugouqiaoToCuizhihuiying × (lugouqiao + reclaimed-lower)
qujiadian      = cuizhihuiyingToQujiadian × cuizhihuiying
```

The role tool accepts this plan shape:

```json
{
  "stage": 1,
  "sourceReleases": [
    {
      "sourceId": "guanting",
      "flowM3s": 20.0,
      "evidenceRefs": [
        "<source Receipt id>",
        "<current-rules ArtifactVersion id>"
      ]
    },
    {
      "sourceId": "south-water",
      "flowM3s": 1.0,
      "evidenceRefs": ["<source Receipt id>", "<rules version id>"]
    },
    {
      "sourceId": "reclaimed-lower",
      "flowM3s": 2.5,
      "evidenceRefs": ["<source Receipt id>", "<rules version id>"]
    }
  ],
  "expectedSectionFlows": [
    { "sectionId": "sanjiadian", "flowM3s": 18.0 },
    { "sectionId": "lugouqiao", "flowM3s": 16.72 },
    { "sectionId": "cuizhihuiying", "flowM3s": 15.7604 },
    { "sectionId": "qujiadian", "flowM3s": 14.18436 }
  ],
  "isFinal": false
}
```

The numbers illustrate the shape only. Replace every value and reference from the current evidence ledger. The plan-local `evidenceRefs` must resolve to Receipt IDs or ArtifactVersion IDs; it is not a place for a URL, Inject ID, display label, or hidden fixture key. These strings do not replace the protocol proof: copy the same evidence into the Task submission's typed `receiptRefs` (`receiptId` + `receiptHash`) and `artifactVersionRefs` (`artifactId` + `artifactVersionId` + `contentHash`).

Run:

```bash
node scripts/validate-allocation-plan.mjs plan.json current-rules.json
```

The validator checks all three sources and four sections, 0.1 m³/s release increments, declared-vs-computed flows within 0.01 m³/s, source and total limits, ecological target coverage, and the fixed transfer model. It checks reference presence and shape but cannot prove authorization, Receipt-chain validity, grant scope, timing, or content hashes; perform those protocol checks separately.

Stage 1 is revisable (`isFinal: false`) and stage 2 is final (`isFinal: true`) only when the assigned Task schema retains those phases. Feasibility is the baseline objective. Do not claim an operational optimum unless the pinned scenario version publishes a separate deterministic objective and tie-break rules.

Publish the candidate plan as an ArtifactVersion if the Task requires team review. Include the coordinator itself only when it must cite that version, `/sync` its artifact Receipt, then create the immutable Task/team Submission. Other roles endorse only the exact revision they reviewed. Team evaluation and feedback never overwrite the individual role artifacts.

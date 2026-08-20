# Yongding River coordinated allocation exercise

The default case is a fact-anchored synthetic exercise based on the 2023 spring ecological replenishment of the Yongding River across the Beijing–Tianjin–Hebei water system. It is not an operational model.

## Topology and sources

```text
Guanting Reservoir
  → Sanjiadian
  → Lugouqiao
  → Cuizhihuiying (Beijing–Hebei boundary)
  → Langfang reach
  → Qujiadian, Tianjin
```

The simplified exercise uses three source IDs:

- `guanting`: Guanting Reservoir release.
- `south-water`: Middle Route South-to-North Water Diversion water.
- `reclaimed-lower`: a synthetic lower-reach reclaimed-water input.

All capacities, transfer coefficients, ecological targets, constraint changes, canonical plans, costs, and outcomes are synthetic and carry `simulationOnly: true`. Official flow anchors are released as separately sourced Observations.

The current synthetic rule Observation has this payload shape:

```json
{
  "sources": [
    { "sourceId": "guanting", "maximumFlowM3s": 24 },
    { "sourceId": "south-water", "maximumFlowM3s": 10 },
    { "sourceId": "reclaimed-lower", "maximumFlowM3s": 6 }
  ],
  "sectionTargets": [
    { "sectionId": "sanjiadian", "minimumFlowM3s": 10 },
    { "sectionId": "lugouqiao", "minimumFlowM3s": 16 },
    { "sectionId": "cuizhihuiying", "minimumFlowM3s": 15 },
    { "sectionId": "qujiadian", "minimumFlowM3s": 12 }
  ],
  "transferModel": {
    "guantingToSanjiadian": 0.9,
    "sanjiadianToLugouqiao": 0.88,
    "lugouqiaoToCuizhihuiying": 0.82,
    "cuizhihuiyingToQujiadian": 0.9
  },
  "totalReleaseLimitM3s": 30,
  "simulationOnly": true
}
```

Use the full arrays from the current Observation. Do not copy the example limits when the Observation differs.

## Allocation payload

```json
{
  "stage": 1,
  "sourceReleases": [
    {
      "sourceId": "guanting",
      "flowM3s": 20.0,
      "evidenceRefs": [
        "official-flow-20230322-guanting",
        "simulated-rules-20230322-stage-1"
      ]
    },
    {
      "sourceId": "south-water",
      "flowM3s": 1.0,
      "evidenceRefs": [
        "simulated-source-limit-20230322-south-water",
        "simulated-rules-20230322-stage-1"
      ]
    },
    {
      "sourceId": "reclaimed-lower",
      "flowM3s": 2.5,
      "evidenceRefs": [
        "simulated-source-limit-20230322-reclaimed-lower",
        "simulated-rules-20230322-stage-1"
      ]
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

Use only constraints present in current Observations. A later `SIMULATED_CONSTRAINT_UPDATE` replaces the named synthetic constraint from its release time onward; it does not rewrite earlier submissions.

`evidenceRefs` contains the Observation's stable `informationId`, not its delivery-record `id`, source URL, or Inject ID. Write `current-rules.json` from the `payload` of the latest eligible Observation that contains the complete `sources`, `sectionTargets`, `transferModel`, and `totalReleaseLimitM3s` shape. If an update is partial, materialize a full current rule object by applying only its named fields to the previously observed rule version; do not infer omitted values.

The deterministic evaluator recomputes section flows, checks source and total limits, enforces 0.1 m³/s source increments, compares declared and computed section flows within 0.01 m³/s, measures ecological target coverage, and validates evidence timing. Do not invent an alternative transfer model.

Compute the four expected flows from the current coefficients in this fixed order:

```text
sanjiadian     = guantingToSanjiadian × guanting
lugouqiao      = sanjiadianToLugouqiao × (sanjiadian + south-water)
cuizhihuiying  = lugouqiaoToCuizhihuiying × (lugouqiao + reclaimed-lower)
qujiadian      = cuizhihuiyingToQujiadian × cuizhihuiying
```

Evidence attaches to each source release. Expected section flows are deterministic derivations of those releases and the cited current rule Observation; they do not carry a second citation field. Stage 1 is revisable (`isFinal: false`); stage 2 is final (`isFinal: true`).

The baseline objective is feasibility: meet every published source, total-release, model, ecological-target, and evidence constraint. Any feasible plan may pass; the deterministic score does not claim or enforce a real operational optimum. If the task later requests optimization, it must publish a separate versioned objective and tie-break rules before the agent optimizes.

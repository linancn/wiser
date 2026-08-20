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

## Allocation payload

```json
{
  "stage": 1,
  "sourceReleases": [
    {
      "sourceId": "guanting",
      "flowM3s": 20.0,
      "evidenceRefs": ["<observed-information-id>"]
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

The deterministic evaluator recomputes section flows, checks source and total limits, enforces 0.1 m³/s source increments, compares declared and computed section flows within 0.01 m³/s, measures ecological target coverage, and validates evidence timing. Do not invent an alternative transfer model.

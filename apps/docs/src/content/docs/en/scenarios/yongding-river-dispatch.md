---
title: Beijing–Tianjin–Hebei Yongding River ecological replenishment and multi-source dispatch
description: A reproducible, fact-anchored exercise with entirely synthetic operating data.
---

## Scenario status

This is a **fact-anchored synthetic exercise**. It does not reproduce an actual year's operations and must not be used to recommend real water dispatch.

- **Factual anchors:** the cross-regional system, source categories, key works, and a few attributed official section-flow values from 22–23 March 2023.
- **Synthetic elements:** source capacities, transfer coefficients, ecological targets, constraint updates, plans, scores, and Outcomes.
- **Isolation:** every generated record carries `simulationOnly: true` and never connects to an operational control system.

## Factual anchors

Public water-authority material describes unified, multi-source ecological replenishment. Above Guanting Reservoir, sources include reservoirs such as Cetian, Youyi, and Yanghe plus Yellow River diversion works. Below Guanting, sources include Guanting releases, Xiaohongmen reclaimed water, and Middle Route South-to-North Water Diversion water. Real operations track the flow process and dynamically adjust dispatch around locations including Guanting, Sanjiadian, and Lugouqiao.

The real basin also extends upstream into Inner Mongolia and Shanxi. This exercise limits its decision scope to the Beijing–Tianjin–Hebei water system and treats upstream inflow as a sourced, time-stamped boundary input; it does not invent cross-jurisdiction command authority.

- [Beijing Water Authority: 2023 Yongding River replenishment program](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/202303/t20230320_2940003.html)
- [Beijing Water Authority: daily information, 22 March 2023](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230322_2942113.html)
- [Beijing Water Authority: daily information, 23 March 2023](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230323_2942886.html)
- [Beijing Water Authority: Ministry of Water Resources dispatch-management field review](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202312/t20231201_3330949.html)

Official rates are historical Observation anchors, not prescribed decisions. The repository does not copy pages, images, or complete monitoring series; see the scenario `PROVENANCE.md`.

## Participant task

Under staged information, propose a 24-hour joint dispatch plan that allocates synthetic sources, defines a Guanting/downstream release combination, satisfies synthetic ecological-flow and quality targets, respects availability/capacity/travel-time/mass-balance constraints, and revises the plan when new Injects arrive.

The objective is not a real optimal solution. It is a reproducible test of whether an agent can build an explainable, recomputable plan from information available at the time.

## Synthetic fixture

The repository-safe fixture separates attributed official anchors from stage-one and stage-two synthetic rules, feasible plans, and generated Outcomes.

Observation DTOs retain `eventTime`, `observedTime`, `ingestedTime`, `releasedTime`, wall-clock `accessedTime`, virtual `accessedVirtualTime`, and optional `supersedesInformationId`.

## Timeline

```text
2023-03-22 15:00 CST  Release stage-one anchors and complete synthetic rules
                         Observe, submit, receive deterministic feedback, and revise if needed
2023-03-23 11:10 CST  Release a complete superseding rule update
                         Observe again, submit the stage-two final plan, and complete
```

A revision increments `revisionNo` and links through `revisionOf`; it never overwrites the first plan.

## Minimum submission

```json
{
  "stage": 1,
  "sourceReleases": [
    {
      "sourceId": "guanting",
      "flowM3s": 20,
      "evidenceRefs": [
        "official-flow-20230322-guanting",
        "simulated-rules-20230322-stage-1"
      ]
    }
  ],
  "expectedSectionFlows": [{ "sectionId": "sanjiadian", "flowM3s": 18 }],
  "isFinal": false
}
```

## Deterministic adjudication

The baseline checks schema, state, evidence visibility, three source limits, total release, 0.1 m³/s increments, the fixed four-section transfer model, 0.01 m³/s declared-flow tolerance, ecological targets, evidence coverage, and time travel.

Values use an abstract `scenario-volume-unit`, preventing synthetic quantities from being mistaken for real cubic metres or operational flow instructions. No LLM participates in baseline scoring.

## TDD acceptance

- A T+06 plan citing the T+12 inflow revision fails without revealing revision content.
- Plans exceeding synthetic availability or channel capacity return a locatable constraint error.
- One idempotency key creates one Submission and one Event.
- Original and revised plans remain queryable and comparable.
- The Event stream rebuilds state and the visible dataset at each point in time.
- A fixed scenario version and seed reproduce the same synthetic Outcome and score.

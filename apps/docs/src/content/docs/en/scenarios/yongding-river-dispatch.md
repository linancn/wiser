---
title: Beijing–Tianjin–Hebei Yongding River ecological replenishment and multi-source dispatch
description: A reproducible, fact-anchored exercise with entirely synthetic operating data.
---

## Scenario status

This is a **fact-anchored synthetic exercise**. It does not reproduce an actual year's operations and must not be used to recommend real water dispatch.

- **Factual anchors:** the cross-regional Yongding River system, real source categories, and key works/control locations.
- **Synthetic elements:** availability, daily flow, conveyance loss, thresholds, observations, costs, and Outcomes.
- **Isolation:** every generated record carries `simulationOnly: true` and never connects to an operational control system.

## Factual anchors

Public water-authority material describes unified, multi-source ecological replenishment. Above Guanting Reservoir, sources include reservoirs such as Cetian, Youyi, and Yanghe plus Yellow River diversion works. Below Guanting, sources include Guanting releases, Xiaohongmen reclaimed water, and Middle Route South-to-North Water Diversion water. Real operations track the flow process and dynamically adjust dispatch around locations including Guanting, Sanjiadian, and Lugouqiao.

The real basin also extends upstream into Inner Mongolia and Shanxi. This exercise limits its decision scope to the Beijing–Tianjin–Hebei water system and treats upstream inflow as a sourced, time-stamped boundary input; it does not invent cross-jurisdiction command authority.

- [Beijing Water Authority: launch of the 2022 Yongding River ecological replenishment program](https://swj.beijing.gov.cn/swdt/swyw/202201/t20220113_2590791.html)
- [Beijing Water Authority: Ministry of Water Resources dispatch-management field review](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202312/t20231201_3330949.html)
- [Beijing Water Authority: Yongding River ecological restoration overview](https://swj.beijing.gov.cn/swdt/swyw/202007/t20200720_1953413.html)

These sources establish topology and source categories only. The exercise does not reuse published annual volumes, rates, or performance figures.

## Participant task

Under staged information, propose a 24-hour joint dispatch plan that allocates synthetic sources, defines a Guanting/downstream release combination, satisfies synthetic ecological-flow and quality targets, respects availability/capacity/travel-time/mass-balance constraints, and revises the plan when new Injects arrive.

The objective is not a real optimal solution. It is a reproducible test of whether an agent can build an explainable, recomputable plan from information available at the time.

## Synthetic fixture

The small, repository-safe fixture contains source-availability snapshots, a conveyance graph with synthetic capacity/loss/travel time, control targets, discrete synthetic water-quality classes, staged observations, and a generated arrival Outcome.

Dynamic records retain `event_time`, `observed_time`, `ingested_time`, and `released_time`. A participant may use a record only after release and authorization.

## Timeline

```text
T+00  Pin the version; release initial availability, topology, and targets
T+06  Submit the first 24-hour joint dispatch plan
T+06  Check mass balance, capacity, travel time, and evidence visibility
T+06  Return L2 feedback with scores and constraint issue types
T+12  Release a synthetic upstream-inflow revision and control observation
T+14  Submit an immutable revised plan
T+24  Attach the synthetic Outcome and adjudicate arrival/target performance
```

A revision creates a new Submission linked through `supersedes`; it never overwrites the first plan.

## Minimum submission

```json
{
  "type": "dispatch_plan",
  "horizonHours": 24,
  "allocations": [
    {
      "sourceId": "synthetic-guanting-release",
      "period": "T+06/T+12",
      "volume": 18.5,
      "unit": "scenario-volume-unit",
      "evidenceRefs": ["observation:source-snapshot:t00"]
    }
  ],
  "assumptions": ["All values are simulation-only."],
  "final": false
}
```

## Deterministic adjudication

The baseline checks schema and units, Episode state, evidence visibility, period mass balance, source availability, capacity, travel time, synthetic loss, control targets, synthetic mixing rules, and arrival error against the generated Outcome.

Values use an abstract `scenario-volume-unit`, preventing synthetic quantities from being mistaken for real cubic metres or operational flow instructions. No LLM participates in baseline scoring.

## TDD acceptance

- A T+06 plan citing the T+12 inflow revision fails without revealing revision content.
- Plans exceeding synthetic availability or channel capacity return a locatable constraint error.
- One idempotency key creates one Submission and one Event.
- Original and revised plans remain queryable and comparable.
- The Event stream rebuilds state and the visible dataset at each point in time.
- A fixed scenario version and seed reproduce the same synthetic Outcome and score.

---
title: Beijing–Tianjin–Hebei Yongding River ecological replenishment and multi-source dispatch
description: A reproducible multi-agent exercise anchored in real system relationships and isolated synthetic operating data.
docType: scenario-guide
scope: jjj-yongding-replenishment-2023
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when using or changing the Yongding multi-source dispatch scenario
whenToUpdate:
  - when scenario facts, synthetic fixtures, evaluation rules, or sources change
checkPaths:
  - packages/excon-scenarios/scenarios/jjj-yongding-replenishment-2023/**
  - skills/agent-excon/references/yongding-allocation.md
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

## Scenario status

This is a **fact-anchored synthetic exercise**. It does not reproduce an actual year's operations and cannot be used to recommend real water dispatch.

- **Factual anchors:** the cross-regional system, source categories, key works, and a few attributed official section-flow values from 22–23 March 2023.
- **Synthetic elements:** source capacities, transfer coefficients, ecological targets, constraint updates, plans, scores, and Outcomes.
- **Isolation:** every synthetic record carries `simulationOnly: true` and never connects to a real business database or operational control system.

## Factual anchors

Public water-authority material describes unified, multi-source ecological replenishment. Above Guanting Reservoir, sources include Cetian, Youyi, and Yanghe reservoirs plus Yellow River diversion works. Below Guanting, sources include Guanting releases, Xiaohongmen reclaimed water, and Middle Route South-to-North Water Diversion water. Real operations track flows and adjust dispatch around locations including Guanting, Sanjiadian, and Lugouqiao.

The real basin extends upstream into Inner Mongolia and Shanxi. This exercise limits its decision scope to the Beijing–Tianjin–Hebei water system and treats upstream inflow as a sourced, time-stamped boundary input; it invents no cross-jurisdiction command authority.

- [Beijing Water Authority: 2023 Yongding River replenishment program](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/202303/t20230320_2940003.html)
- [Beijing Water Authority: daily information, 22 March 2023](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230322_2942113.html)
- [Beijing Water Authority: daily information, 23 March 2023](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230323_2942886.html)
- [Beijing Water Authority: Ministry of Water Resources dispatch-management field review](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202312/t20231201_3330949.html)

Official rates are attributed historical anchors, not prescribed team decisions. The repository copies no pages, images, or complete monitoring series; see the scenario `PROVENANCE.md` for source and license boundaries.

## Team decision task

Several RunAgents jointly propose a 24-hour plan under staged, differentiated information:

1. allocate each synthetic source over time;
2. define a Guanting/downstream release combination;
3. satisfy synthetic ecological-flow and quality constraints;
4. respect availability, capacity, travel-time, and mass-balance limits;
5. revise the plan as new inflow, monitoring, or constraint Injects arrive;
6. cite only information issued through `/sync` into the RunAgent's own `AgentViewReceipt`, or an explicitly authorized ArtifactVersion.

The objective is not a real optimum. It tests whether a team can build an explainable, recomputable plan through explicit collaboration within each member's visibility and constraints.

## Multi-agent roles

| Role                        | Responsibility                                                | Explicit deliverable                  |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| Evidence and inflow agent   | Verify provenance, time, supersession, and inflow data        | Evidence register and inflow summary  |
| Hydraulic constraints agent | Calculate transfer loss, section response, and capacity       | Section-constraint artifact           |
| Ecological target agent     | Analyze target bands, continuity, and risk                    | Ecological priority and risk artifact |
| Dispatch coordinator        | Integrate shared artifacts into candidate plans and revisions | Team Submission                       |

The first three roles work in parallel and converge at an `analysis-ready` Barrier. The team Submission cites contributor ArtifactVersions and Receipts already issued to the coordinating RunAgent. The coordinator never reads another RunAgent's unshared context.

## Synthetic fixture

The runtime package separates source anchors, stage rules, and test fixtures:

- `facts/official-anchors.json`: a small set of official facts and source IDs;
- `fixture/stage-1.json`: three synthetic source limits, four section targets, the transfer model, and a feasible plan;
- `fixture/stage-2.json`: the later constraint update and final plan;
- `v2/case-pack.json`: the versioned multi-role runtime blueprint;
- `provenance/sources.yaml` and `PROVENANCE.md`: source, mixed-license, and isolation records.

v2 `/sync` freezes the information actually issued to each RunAgent and its Receipt chain. Evidence eligibility depends on the Receipt, RunAgent, virtual issuance time, and supersession relationship.

## Timeline

```text
2023-03-22 15:00 CST  Pin the version and issue differentiated stage-one receipts
                         Run parallel Tasks, publish Artifacts, and converge at a Barrier
                         Submit a team plan; deliver individual and team Feedback
2023-03-23 11:10 CST  Issue a rule update carrying supersedesInformationId
                         Revise in parallel and submit the stage-two team plan
```

A revision never overwrites the first submission. It increments `revisionNo` and links through `revisionOf`, preserving the change after feedback.

## v1 compatibility submission

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

This envelope belongs only to explicit single-agent v1 compatibility, and the example shows one item; the actual v1 contract requires three sources and four sections. v1 Observation DTOs retain `eventTime`, `observedTime`, `ingestedTime`, `releasedTime`, `accessedTime`, `accessedVirtualTime`, and optional `supersedesInformationId`. Do not treat those v1 fields as the v2 Receipt protocol.

A v2 team Submission additionally references the Task, contributing RunAgents, ArtifactVersions, Receipts, and endorsements. `flowM3s` values use a synthetic m³/s model under the `simulationOnly` boundary and are not operational instructions.

## Deterministic adjudication

The evaluator checks schemas, Task/role/team permissions, Receipt/ArtifactVersion evidence eligibility, three synthetic source limits, total release, 0.1 m³/s increments, the fixed four-section transfer model, 0.01 m³/s declared-flow tolerance, ecological targets, evidence coverage, and time travel.

No LLM participates in deterministic scoring. Optional model explanation cannot override a deterministic constraint failure, authorization failure, or final verdict even after passing its schema.

## TDD acceptance

- A T+06 plan citing an inflow revision issued at T+12 returns a stable error without revealing revision content.
- Plans exceeding synthetic availability or channel capacity return a locatable constraint error.
- One idempotency key creates one Submission and one Event.
- Original and revised plans remain queryable, and post-feedback improvement is computable.
- RunEvents and AgentViewReceipts rebuild the Run and each RunAgent's historical view.
- Three parallel analysis Tasks continue while another Task is evaluated.
- Evaluation links contributing traces through Span Links; domain replay remains complete after traces are removed.
- A fixed scenario version and seed reproduce the same synthetic Outcome and score.

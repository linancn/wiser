# Provenance and data boundary / 来源与数据边界

本案例是“事实锚定的合成演练”，不是现实调度模型，也不得用于给出现实补水或供水指令。

The scenario is a fact-anchored synthetic exercise. It is not an operational model and must not be used to recommend real water releases or allocations.

## Official factual anchors

The repository stores a small number of factual measurements and event facts with source URLs, publication timestamps, and access dates in [`facts/official-anchors.json`](./facts/official-anchors.json). These values establish the historical context and release-time boundary only.

The Beijing Water Authority pages do not declare an open-data license. The project therefore:

- does not copy articles, HTML, PDFs, images, maps, or complete monitoring series;
- does not relicense official facts as MIT or CC0;
- attributes every factual anchor to its official page;
- keeps all capacities, transfer coefficients, targets, costs, constraint updates, plans, and outcomes independently synthetic.

## Synthetic fixture

Files under `fixture/` are original simulation fixtures dedicated to the public domain under `CC0-1.0`. They use real place and source-category names only to make the exercise legible. Numerical constraints and computed outcomes are fictional.

`simulationOnly: true` and `notForOperationalUse: true` are normative safety fields. Removing or overriding them produces a different, unsupported scenario.

## Code license

Software outside the official fact anchors is licensed under the repository MIT License. MIT does not extend to third-party webpages or official material.

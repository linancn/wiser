# Evidence rules

An evidence reference is eligible only when all of these are true:

1. The API returned it as an Observation for the current Episode and participant.
2. Its `releasedTime` is not later than the Episode virtual time.
3. Its `accessedVirtualTime` is not later than the submission virtual time. `accessedTime` is wall-clock audit data and is not compared with a historical virtual timestamp.
4. It supports the specific source release, constraint, or expected-flow statement that cites it.
5. A later correction does not silently replace it; when present, `supersedesInformationId` identifies the earlier information version.

An Inject is planned environment state, not evidence. A source URL in repository documentation is not an Observation. Hidden Outcome data and evaluator rules are never participant evidence, even when an open-source checkout makes a fixture technically readable.

When evidence is missing, observe again if the current state permits it. Otherwise submit a narrower claim or stop; do not fabricate an ID.

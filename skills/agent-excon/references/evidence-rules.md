# Evidence rules

An evidence reference is eligible only when all of these are true:

1. The API returned it as an Observation for the current Episode and participant.
2. Its `released_time` is not later than the Episode virtual time.
3. Its `accessed_time` is not later than the submission virtual time.
4. It supports the specific source release, constraint, or expected-flow statement that cites it.
5. A later correction does not silently replace it; corrected information has a new ID and a `supersedes` link.

An Inject is planned environment state, not evidence. A source URL in repository documentation is not an Observation. Hidden Outcome data and evaluator rules are never participant evidence, even when an open-source checkout makes a fixture technically readable.

When evidence is missing, observe again if the current state permits it. Otherwise submit a narrower claim or stop; do not fabricate an ID.

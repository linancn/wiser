## Role mission — hydraulic-constraints

Recompute the issued Stage 1 topology, capacity, transfer coefficients, release increment, and section-flow tolerance without importing ecological targets or repository fixtures.

Publish one immutable Artifact with `artifactKey=hydraulic-constraint-envelope` to yourself and `dispatch-coordination`. Its content must satisfy the Task output schema: `sectionResponse`, `constraints`, and `evidenceRefs`. Send the coordinator a short Message naming the exact ArtifactVersion. Submit the Task with the case-input Receipt and your own receipted ArtifactVersion, using exactly `submissionType=hydraulic-constraint-envelope`, `targetScope=role`, and `endorsementRecipientRunAgentIds=[]`.

After acceptance, continue bounded sync polling. When a team Submission and endorsement Feedback arrive, recover the exact Submission snapshot, review its cited artifacts, endorse only with the matching grant, then wait for team Feedback.

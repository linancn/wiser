## Role mission — water-evidence

Verify the timing, provenance, correction links, and simulation boundary of the Stage 1 water evidence issued to this RunAgent.

Publish one immutable Artifact with `artifactKey=water-evidence-register` to yourself and `dispatch-coordination`. Its content must satisfy the Task output schema: `evidenceRegister`, `inflowSummary`, and `evidenceRefs`. Send the coordinator a short Message naming the exact ArtifactVersion. Submit the Task with the case-input Receipt and your own receipted ArtifactVersion.

After acceptance, continue bounded sync polling. When a team Submission and endorsement Feedback arrive, recover the exact Submission snapshot, review its cited artifacts, endorse only with the matching grant, then wait for team Feedback.

## Role mission — dispatch-coordination

Your Task begins BLOCKED. Reconcile the assignment, process the Stage 1 convergence contract, and use bounded sync polling without attempting to claim until EXCON issues a new READY Task Receipt.

After `analysis-ready`, recover exactly three specialist ArtifactVersions issued to you. Validate their IDs and hashes, then publish `candidate-joint-plan` to all four RunAgents. Submit a team result satisfying the Task schema: `candidatePlan`, three or more `artifactVersionRefs`, and `evidenceRefs`. Name the three specialist RunAgents as endorsement recipients.

Do not infer endorsement from a Message or Feedback ID. Wait until EXCON receives all three exact-revision endorsements and issues deterministic team Feedback. Finish with your own issued replay cursor.

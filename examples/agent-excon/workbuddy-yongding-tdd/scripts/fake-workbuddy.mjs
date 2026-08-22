const roleSlotId = process.env.WISER_ROLE_SLOT_ID;
const runId = process.env.WISER_EXPECTED_RUN_ID;
const runAgentId = process.env.WISER_EXPECTED_RUN_AGENT_ID;

if (!roleSlotId || !runId || !runAgentId) {
  process.stderr.write('Fake WorkBuddy identity is incomplete.\n');
  process.exitCode = 2;
} else {
  const structured = {
    schemaVersion: 1,
    roleSlotId,
    runId,
    runAgentId,
    status: 'completed',
    lastReceiptSeq: 1,
    submissionId: null,
    summary: `Scripted ${roleSlotId} participant completed.`,
  };
  process.stdout.write(
    `${JSON.stringify([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: `fake-${roleSlotId}`,
        result: JSON.stringify(structured),
      },
    ])}\n`,
  );
}

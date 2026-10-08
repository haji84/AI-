export function goalFailureCode(value: unknown): string {
  const detail = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (/spec_sync_|canonical.requirement/i.test(detail)) return "SPEC_SYNC_REQUIRED";
  if (/changed surface needs reconciliation|traceability|requirement.audit/i.test(detail)) return "TRACEABILITY_STALE";
  if (/human.required|approval.required|human.gate/i.test(detail)) return "HUMAN_REQUIRED";
  if (/timed out after \d+ms|coding.engine.timeout/i.test(detail)) return "CODING_ENGINE_TIMEOUT";
  if (/no.capability|builder.unavailable|builder_unreachable|no.*builder/i.test(detail)) return "NO_CAPABILITY";
  if (/builder.*(?:error|failed|failure)|builder_contract_incomplete/i.test(detail)) return "BUILDER_EXECUTION_FAILED";
  if (/verification|verifier|repository.check|test.failed|test failure|test at /i.test(detail)) return "VERIFICATION_FAILED";
  if (/retry.exhausted|recovery.budget/i.test(detail)) return "RECOVERY_EXHAUSTED";
  return "UNCLASSIFIED_BLOCKER";
}

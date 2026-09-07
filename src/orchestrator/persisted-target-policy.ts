export function shouldValidatePersistedTarget(effectiveExplicitJson: string): boolean {
  return effectiveExplicitJson.trim() === "";
}

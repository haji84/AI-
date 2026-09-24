/** Host-defined operation identity for learning; never a filesystem or execution grant. */
const operations = [
  "material:v1:inspect:text",
  "material:v1:inspect:workbook-json",
  "material:v1:inspect:document-json",
  "material:v1:copy:text",
  "material:v1:create:xlsx",
  "material:v1:create:docx",
] as const;

export type CognitiveOperation = typeof operations[number];

export function validateCognitiveOperation(value: unknown): CognitiveOperation {
  if (typeof value !== "string" || !operations.includes(value as CognitiveOperation)) throw Error("Invalid cognitive learning operation");
  return value as CognitiveOperation;
}

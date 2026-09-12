export function normalizeModelFinalOutput(value: unknown): string {
  let text = String(value ?? "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^```(?:json|javascript|typescript|js|ts|text)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const labeled = [...text.matchAll(/(?:^|\n)\s*(?:final(?: answer)?|answer)\s*:\s*(.+?)\s*$/gim)];
  if (labeled.length) return labeled.at(-1)?.[1]?.trim() ?? text;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && /^(?:therefore|thus|so)\b/i.test(lines.at(-1) ?? "")) {
    return (lines.at(-1) ?? "").replace(/^(?:therefore|thus|so)\s*[:,]?\s*/i, "").trim();
  }
  return text;
}

export function extractBalancedJsonObject(value: unknown): string {
  const text = normalizeModelFinalOutput(value);
  const start = text.indexOf("{");
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text;
}

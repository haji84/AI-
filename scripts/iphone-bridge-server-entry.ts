export {};

const originalToISOString = Date.prototype.toISOString;

Date.prototype.toISOString = function toISOStringWithoutFractionalSeconds(): string {
  return originalToISOString.call(this).replace(/\.\d{3}Z$/, "Z");
};

await import("./iphone-bridge-server.ts");

const healthUrl = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/api/health";
const deadline = Date.now() + 30_000;
let lastError;

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl);
    const body = await response.json();

    if (response.status !== 200 || body.status !== "ok") {
      throw new Error(`Unexpected health response: ${response.status} ${JSON.stringify(body)}`);
    }

    console.log(`Health check passed: ${healthUrl}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

console.error(`Health check failed: ${healthUrl}`);
throw lastError;

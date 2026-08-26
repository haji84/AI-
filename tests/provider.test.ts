import assert from "node:assert/strict";
import test from "node:test";

import type {
  Provider,
  ProviderContext,
  ProviderResult,
} from "../src/providers/provider.ts";

interface TestInput {
  readonly prompt: string;
}

interface TestOutput {
  readonly value: string;
}

const context: ProviderContext = {
  jobId: "job-1",
  projectId: "project-1",
};

test("provider contract supports a provider-independent successful result", async () => {
  const provider: Provider<TestInput, TestOutput> = {
    async execute(providerContext, input) {
      return {
        ok: true,
        value: {
          value: `${providerContext.projectId}:${input.prompt}`,
        },
      };
    },
  };

  const result = await provider.execute(context, { prompt: "hello" });

  assert.deepEqual(result, {
    ok: true,
    value: { value: "project-1:hello" },
  });
});

test("provider contract exposes failures without provider-specific error types", async () => {
  const provider: Provider<TestInput, TestOutput> = {
    async execute() {
      return {
        ok: false,
        error: {
          code: "PROVIDER_FAILURE",
          message: "Provider execution failed.",
        },
      };
    },
  };

  const result: ProviderResult<TestOutput> = await provider.execute(context, {
    prompt: "hello",
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Provider execution failed.",
    },
  });
});

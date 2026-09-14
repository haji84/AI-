import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["scripts/jarvis-direct-commander.ts"],
    rules: {
      "no-useless-escape": "off",
    },
  },
  {
    files: ["scripts/gai-tool-use-benchmark.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);

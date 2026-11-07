import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import vm from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { safeOwnerReturnPath } from "../src/app/owner-login-redirect.ts";

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

async function component(relativePath, trusted) {
  const filename = fileURLToPath(new URL("../" + relativePath, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);

  // Keep the full production JSX and handlers. Only hooks and external browser
  // boundaries are fixtures; credential operations fail closed in this test.
  const state = [], effects = [], seenEffects = new Set();
  let stateCursor = 0, effectCursor = 0;
  const hooks = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
    useEffect(effect) {
      const index = effectCursor++;
      if (!seenEffects.has(index)) {
        seenEffects.add(index);
        effects.push(effect);
      }
    },
  };
  const forbidden = () => assert.fail("PIN rendering must not authenticate, enroll, revoke, or navigate");
  const client = {
    hasTrustedDevice: async () => trusted,
    trustedDeviceInfo: async () => ({ id: "public-fixture-device", label: "Public fixture browser" }),
    signInWithTrustedPin: forbidden,
    enrollTrustedDevice: forbidden,
    changeTrustedDevicePin: forbidden,
    removeTrustedDevice: forbidden,
  };
  const module = { exports: {} };
  const require = id => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "next/navigation") return { useRouter: () => ({ replace: forbidden, refresh: forbidden }) };
    if (id === "../owner-login-redirect.ts") return { safeOwnerReturnPath };
    if (id === "./trusted-device-client" || id === "../trusted-device-client") return client;
    assert.fail("Unexpected full-component dependency: " + id);
  };
  const context = vm.createContext({
    module, exports: module.exports, require,
    navigator: { platform: "Public fixture browser" },
    fetch: async (url, options) => {
      assert.equal(url, "/api/owner-login/trusted/devices");
      assert.equal(options.cache, "no-store");
      assert.equal(options.method, undefined, "Only the initial device-list read is permitted");
      return { ok: true, status: 200, json: async () => ({ devices: [] }) };
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(compiled.outputText, { filename }).runInContext(context, { timeout: 1000 });
  const Component = module.exports.default;
  const render = () => {
    stateCursor = 0; effectCursor = 0;
    return Component({});
  };
  render();
  for (const effect of effects.splice(0)) effect();
  await setImmediate();
  return render;
}

const cases = [
  { name: "trusted-device login", path: "src/app/jarvis/OwnerLogin.tsx", trusted: true, count: 1, index: 0 },
  { name: "trusted-device enrollment", path: "src/app/jarvis/settings/TrustedDeviceSettings.tsx", trusted: false, count: 1, index: 0 },
  { name: "current PIN change", path: "src/app/jarvis/settings/TrustedDeviceSettings.tsx", trusted: true, count: 2, index: 0 },
  { name: "replacement PIN change", path: "src/app/jarvis/settings/TrustedDeviceSettings.tsx", trusted: true, count: 2, index: 1 },
];

for (const scenario of cases) {
  // Removing password semantics from this production field must fail this case;
  // the literal input/output pairs also catch numeric coercion losing a zero.
  test(scenario.name + " masks its PIN while retaining four-digit input behavior", async () => {
    const render = await component(scenario.path, scenario.trusted);
    const pinInputs = () => {
      const inputs = nodes(render()).filter(node => node.type === "input" && node.props.inputMode === "numeric");
      assert.equal(inputs.length, scenario.count, "The actual UI branch must expose the expected PIN fields");
      return inputs;
    };
    if (scenario.count === 2) {
      pinInputs()[1 - scenario.index].props.onChange({ target: { value: "7510" } });
    }

    for (const [typed, expected, disabled] of [["", "", true], ["0a4", "04", true], ["0a4-27 9", "0427", false]]) {
      pinInputs()[scenario.index].props.onChange({ target: { value: typed } });
      const input = pinInputs()[scenario.index];
      assert.equal(input.props.value, expected, "The real handler filters digits, retains leading zero, and caps length");
      assert.equal(input.props.pattern, "[0-9]{4}");
      assert.equal(input.props.maxLength, 4);
      assert.equal(input.props.required, true);
      assert.equal(input.props.disabled, false);
      const submit = nodes(render()).find(node => node.type === "button" && node.props.type === "submit");
      assert.equal(submit.props.disabled, disabled, "Submission requires all four digits in each PIN");
    }

    const html = renderToStaticMarkup(render());
    const renderedInputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
    const renderedPin = renderedInputs.filter(input => input.includes('inputMode="numeric"'))[scenario.index];
    assert.ok(renderedPin, "Real React SSR must render the selected PIN field");
    assert.match(renderedPin, /value="0427"/);
    assert.match(renderedPin, /type="password"/, scenario.name + " must hide the entered PIN by default");
    if (scenario.path.endsWith("OwnerLogin.tsx")) {
      assert.match(renderedInputs.find(input => input.includes('id="jarvis-owner-code"')), /type="password"/);
    }
  });
}

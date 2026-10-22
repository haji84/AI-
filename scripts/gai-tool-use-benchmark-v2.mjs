const nativeFetch = globalThis.fetch;
const endpointFragment = '/api/generate';

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes(endpointFragment) || !init?.body) return nativeFetch(input, init);

  try {
    const body = JSON.parse(String(init.body));
    if (typeof body.prompt === 'string') {
      body.prompt = body.prompt.replace(/^\/no_think\s*/i, '');
    }
    body.options = {
      ...(body.options ?? {}),
      temperature: 0,
      num_predict: Math.max(Number(body.options?.num_predict ?? 0), 256),
    };
    delete body.think;
    return nativeFetch(input, { ...init, body: JSON.stringify(body) });
  } catch {
    return nativeFetch(input, init);
  }
};

await import('./gai-tool-use-benchmark.ts');

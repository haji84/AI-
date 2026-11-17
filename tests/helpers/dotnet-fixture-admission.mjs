import process from 'node:process';

// Test-only .NET compilers share the bounded runner with concurrent Node tests.
// Keep their internal worker admission to one CPU unless explicitly configured.
process.env.DOTNET_PROCESSOR_COUNT ??= '1';

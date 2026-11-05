import { defineConfig } from "vitest/config";

// `npm run synth` and `npm run cost` compile tests into dist/; run only the TypeScript sources.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });

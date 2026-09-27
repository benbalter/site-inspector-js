import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // web/ has its own test runner (node:test); keep the library's tests separate.
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**"],
    },
  },
});

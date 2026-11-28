import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      enabled: false,
      include: [
        "src/worker/domain/**/*.ts",
        "src/frontend/alarm.ts",
        "src/frontend/clock.ts",
        "src/frontend/format.ts",
        "src/frontend/limits.ts",
      ],
      exclude: ["src/worker/domain/types.ts"],
      reporter: ["text", "html"],
    },
  },
});

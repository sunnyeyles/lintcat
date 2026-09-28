import { config } from "@pr-review/eslint-config/base";

export default [
  ...config,
  // Its planted problems are lint errors, on purpose.
  { ignores: ["fixtures/clean-lint-only/**"] },
];

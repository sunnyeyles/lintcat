import { nextJsConfig } from "@pr-review/eslint-config/next-js";

// public/explainer holds the minified drawings `pnpm explainer` bundles from docs/explainer.
export default [...nextJsConfig, { ignores: ["public/explainer/**"] }];

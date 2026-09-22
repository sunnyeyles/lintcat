import js from "@eslint/js";
import tseslint from "typescript-eslint";
import turboConfig from "eslint-config-turbo/flat";

export const config = tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  turboConfig,
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/coverage/**"],
  },
  {
    rules: {
      // Matches this repo's convention for intentionally-unused destructured bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // tsc already flags undefined identifiers; no-undef false-positives on TS globals/ambient types.
      "no-undef": "off",
      // This repo uses `catch {}` deliberately to swallow expected, non-actionable errors.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);

import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import { config as baseConfig } from "./base.js";

export const reactInternalConfig = [
  ...baseConfig,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  {
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
  { settings: { react: { version: "detect" } } },
];

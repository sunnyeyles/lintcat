import next from "@next/eslint-plugin-next";

import { config as baseConfig } from "./base.js";

export const nextJsConfig = [...baseConfig, next.configs["core-web-vitals"]];

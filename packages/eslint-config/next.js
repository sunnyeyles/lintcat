import next from "@next/eslint-plugin-next";
import shadcn from "eslint-plugin-shadcn";

import { config as baseConfig } from "./base.js";

export const nextJsConfig = [
  ...baseConfig,
  next.configs["core-web-vitals"],
  shadcn.configs["radix-recommended"],
];

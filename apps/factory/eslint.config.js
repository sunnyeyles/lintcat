import { config } from "@pr-review/eslint-config/base";

export default [...config, { ignores: ["benchmarks/fixtures/**"] }];

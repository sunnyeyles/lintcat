export const MAX_MESSAGES = 12;
export const MAX_USER_CHARS = 1000;
export const MAX_ASSISTANT_CHARS = 6000;
export const MAX_BODY_BYTES = 64_000;
export const MAX_OUTPUT_TOKENS = 1024;

// The global cap bounds worst-case spend however many addresses ask.
export const IP_RULE = { limit: 20, windowMs: 3_600_000 };
export const GLOBAL_RULE = { limit: 1000, windowMs: 86_400_000 };

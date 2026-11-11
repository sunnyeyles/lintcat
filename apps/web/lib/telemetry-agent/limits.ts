export const MAX_MESSAGES = 20;
export const MAX_USER_CHARS = 2000;
export const MAX_ASSISTANT_CHARS = 8000;
export const MAX_SYSTEM_PROMPT_CHARS = 4000;
export const MAX_BODY_BYTES = 200_000;
export const MAX_OUTPUT_TOKENS = 2048;
export const MAX_STEPS = 8;
export const MAX_TOOL_RESULT_CHARS = 24_000;

// Per member per organization: the organization's own key pays, so this only stops a runaway tab.
export const MEMBER_RULE = { limit: 60, windowMs: 3_600_000 };

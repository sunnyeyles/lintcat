/** Workflow profiles: validated YAML definitions, one engine. */
import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { assetPath } from "#src/assets";
import { budgetsSchema, PROFILE_NAMES, type ProfileName } from "#src/contract";

const STAGES = ["prepare", "locate", "reproduce", "baseline", "implement", "verify", "review", "deliver"] as const;
export type Stage = (typeof STAGES)[number];

const profileSchema = z.object({
  name: z.enum(PROFILE_NAMES),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  description: z.string(),
  /** Lower is lighter; an override may only move to an equal or heavier profile unless the task is low risk. */
  weight: z.number().int().min(0),
  stages: z.array(z.enum(STAGES)).min(1),
  independentReview: z.boolean(),
  budgets: budgetsSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const workflowVersion = (profile: Profile) => `${profile.name}@${profile.version}`;

const cache = new Map<ProfileName, Profile>();

export function loadProfile(name: ProfileName): Profile {
  const hit = cache.get(name);
  if (hit) return hit;
  const profile = profileSchema.parse(parse(readFileSync(assetPath("workflows", `${name}.yaml`), "utf8")));
  if (profile.name !== name) throw new Error(`workflows/${name}.yaml declares ${profile.name}`);
  cache.set(name, profile);
  return profile;
}

export const loadProfiles = (): Profile[] => PROFILE_NAMES.map(loadProfile);

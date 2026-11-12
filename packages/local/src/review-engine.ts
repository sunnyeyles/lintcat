import { toolLoopEngine, type ReviewEngine } from "@pr-review/ai";

import { resolveModel, type LocalEnvironment } from "#src/environment";

export interface SelectedEngine {
  engine: ReviewEngine;
  /** One sampling request replaced the tool-calling agent; the result must say so. */
  singleShot: boolean;
}

/** The key-backed engine: the tool-calling agent over the run's model. */
export function modelReviewEngine(environment: LocalEnvironment): SelectedEngine {
  return {
    engine: toolLoopEngine({ model: resolveModel(environment).model }),
    singleShot: false,
  };
}

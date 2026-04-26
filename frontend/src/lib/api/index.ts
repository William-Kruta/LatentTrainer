export * from "./datasets";
export * from "./generate";
export * from "./media";
export * from "./training";

import { datasetsApi } from "./datasets";
import { generateApi } from "./generate";
import { mediaApi } from "./media";
import { trainingApi } from "./training";

export const api = {
  ...generateApi,
  ...trainingApi,
  ...datasetsApi,
  ...mediaApi,
};

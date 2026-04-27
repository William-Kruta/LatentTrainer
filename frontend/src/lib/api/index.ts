export * from "./datasets";
export * from "./generate";
export * from "./media";
export * from "./training";
export * from "./chat";
export * from "./system";

import { datasetsApi } from "./datasets";
import { generateApi } from "./generate";
import { mediaApi } from "./media";
import { trainingApi } from "./training";
import { chatApi } from "./chat";
import { systemApi } from "./system";

export const api = {
  ...generateApi,
  ...trainingApi,
  ...datasetsApi,
  ...mediaApi,
  ...chatApi,
  ...systemApi,
};

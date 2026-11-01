// `@pumi-dev/agents`, for a sub-plugin's code: the sub-plugin API (`api.ts`), as `import … from
// "@pumi-dev/agents"` resolves in the plugin's worker and in each GUI tab's host, as `pumi` does
// for a plugin. A sub-plugin the plugin ships imports `api.ts` itself; the module is the same.
// No `import … from "pumi"` here.
import * as api from "./api.ts";

/** The name a sub-plugin imports the API by. */
export const API_MODULE = "@pumi-dev/agents";

let provided = false;

/** Makes `@pumi-dev/agents` resolve, once, in this process or worker. */
export function provideApi(): void {
  if (provided) return;
  provided = true;
  Bun.plugin({
    name: API_MODULE,
    setup(build) {
      build.module(API_MODULE, () => ({ exports: { ...api }, loader: "object" }));
    },
  });
}

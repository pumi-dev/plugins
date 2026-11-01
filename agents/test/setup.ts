// Before every test: the agents are the sub-plugins the plugin ships (`agents/`), loaded as the
// worker loads them, code and all (`subplugins.ts`).
import { join } from "node:path";

import { setRegistry } from "../src/registry.ts";
import { readBundled, registryOf } from "../src/subplugins.ts";

const { registry, errors } = await registryOf(readBundled(join(import.meta.dir, "..")), true);
if (errors.length) throw new Error(`the bundled sub-plugins: ${errors.join("; ")}`);
setRegistry(registry);

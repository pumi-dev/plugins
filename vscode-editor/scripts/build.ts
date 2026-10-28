#!/usr/bin/env bun
// Builds the editor's page into `web/` now, as the plugin does the first time it runs.
import { ensurePage, WEB } from "../src/page.ts";

const started = performance.now();
await ensurePage();
console.log(`${WEB}: ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);

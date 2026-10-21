// The package's entry. `script-panel` registers nothing of its own — no view, no command, no
// option — so pumi never starts it: the packages that import it (`npm-scripts`, `shell-scripts`)
// declare the view and where it goes. Its code is `src/index.ts`.
export * from "./index.ts";

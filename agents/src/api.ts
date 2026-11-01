// What a sub-plugin of the agents plugin builds with: the conversation it turns an agent's files
// and protocol into, the helpers its parsers and engines share, and the types of what it gives
// (`registry.ts`). A sub-plugin the plugin ships imports this file; any other imports it as
// `@pumi-dev/agents`, which the plugin's worker and each GUI tab's host resolve to it. It is the
// sub-plugin API at level `SUB_API`: a sub-plugin's manifest names that level (`parentApi`).
// No `import … from "pumi"` here, nor in what it brings in: a host is not a plugin's worker.
//
// A sub-plugin's manifest (`package.json`'s `pumi`, beside `name`, `parent` and `parentApi`):
//
//   agents   [AgentDef]                 the agents it gives: the `+` menu, Settings, hooks, the chat
//   formats  ["claude"]                 the session-file formats its `main` module reads
//   engines  {id: {module, run, …}}     the engines a GUI tab's host runs an agent with (`EngineDef`)
//
// Its `main` module exports `formats`, a `FormatDef` by id; an engine's module exports
// `createDriver(spec, write, events)`, a `Driver`.
export * from "./conversation/change.ts";
export * from "./conversation/model.ts";
export * from "./parse/common.ts";
export * from "./session/prompt.ts";
export * from "./session/rpc.ts";
export { agentPath, agentPathReady, findProgram, searchPath } from "./session/launch.ts";
export { canonical, isFile, list, type Where } from "./locate.ts";
export { builtins, fromFile, markdown, projectDirs, skills, T, type Builtin } from "./commands.ts";
export type { Driver, SessionEvents } from "./session/engines.ts";
export type { HostSpec, HostState } from "./session/wire.ts";
export type { AgentSpec } from "./agents.ts";
export { SUB_API, type AgentDef, type ChatDef, type EngineDef, type FormatDef, type FormatWhere, type HookDef, type Shape } from "./registry.ts";

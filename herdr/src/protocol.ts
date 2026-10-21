// herdr's JSON API vocabulary, as herdr 0.9.x speaks it on its socket: the version and protocol
// number `ping` reports, the envelope of a successful result, and the error codes.
//
// PROVENANCE: herdr `src/api/schema/*.rs`, `src/workspace.rs` (public ids) and `src/api/server.rs`
// (framing) @ v0.9.3 (Apache-2.0). The shapes are herdr's; the tables are pumi's way of listing
// them (methods.ts, events.ts).

import type { Json } from "./types.ts";

/** The herdr version whose API pumi implements, and what `ping` reports. */
export const HERDR_VERSION = "0.9.4";

/** herdr's API protocol number (`ping` reports it; herdr's CLI refuses a mismatch). */
export const HERDR_PROTOCOL = 22;

/** The envelope of a successful result: `{"type": kind, …fields}`. */
export function result(kind: string, fields: Record<string, Json> = {}): Record<string, Json> {
  return { ...fields, type: kind };
}

/** herdr's error codes, by what went wrong. */
export const codes = {
  INVALID_REQUEST: "invalid_request",
  INVALID_PARAMS: "invalid_params",
  UNKNOWN_METHOD: "unknown_method",
  NOT_FOUND: "not_found",
  WORKSPACE_NOT_FOUND: "workspace_not_found",
  TAB_NOT_FOUND: "tab_not_found",
  PANE_NOT_FOUND: "pane_not_found",
  AGENT_NOT_FOUND: "agent_not_found",
  UNSUPPORTED: "unsupported",
  TIMEOUT: "timeout",
  INTERNAL: "internal_error",
  INVALID_KEY: "invalid_key",
} as const;

export type Code = (typeof codes)[keyof typeof codes];

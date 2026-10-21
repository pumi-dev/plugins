// The errors a caller sees: `pumi call` answers them as `{kind, message}`, and a pane shows the
// message. The kinds are the Rust package's, so an agent's code that read them still can.
export type ErrorKind = "invalid_params" | "not_found" | "render" | "io";

/** An error with its `kind`, as the API's errors have. */
export function fail(kind: ErrorKind, message: string): Error & { kind: ErrorKind } {
  return Object.assign(new Error(message), { kind });
}

/** An error's message, whatever was thrown. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

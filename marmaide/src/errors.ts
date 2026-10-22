// The errors a caller sees: `pumi call` answers them as `{kind, message}`, and a pane shows the
// message. The kinds are the API's own, so an agent's code that reads one sees a name it knows.
import { ApiError } from "pumi";

export type ErrorKind = "invalid_params" | "not_found" | "render" | "io";

/** An error with its `kind`, as the API's own errors carry one. */
export function fail(kind: ErrorKind, message: string): ApiError {
  return new ApiError(kind, message);
}

/** An error's message, whatever was thrown. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

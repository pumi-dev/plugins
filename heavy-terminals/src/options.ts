// The package's options, read where they are used: a check reads them again every round, so a change
// takes effect without a new timer.
import { option } from "pumi";

/** The number the option `name` holds, or `fallback` when it holds something else. */
export async function number(name: string, fallback: number): Promise<number> {
  const value = await option.get(name);
  return typeof value === "number" ? value : fallback;
}

/** Whether the option `name` is on, or `fallback` when it is not a boolean. */
export async function flag(name: string, fallback: boolean): Promise<boolean> {
  const value = await option.get(name);
  return typeof value === "boolean" ? value : fallback;
}

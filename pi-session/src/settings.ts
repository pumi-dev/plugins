// Its options, read under their keys in the manifest (`package.json`'s `pumi.contributes.options`),
// with what each means when the user has not set it.
import { option } from "pumi";

/** Its option `key` as trimmed text, or `fallback` when it is unset or empty. */
export async function setting(key: string, fallback: string): Promise<string> {
  const value = await option.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/** Whether the buttons are on the focused pi pane alone (`focused_only`). */
export async function focusedOnly(): Promise<boolean> {
  return (await option.get("focused_only")) === true;
}

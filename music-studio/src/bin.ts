// Where a tool is: the app may be started with a PATH that has none of Homebrew's.
import { existsSync } from "node:fs"
import { join } from "node:path"

const DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
const found = new Map<string, string>()

export function bin(name: string): string {
  const had = found.get(name)
  if (had) return had
  const dirs = [...(process.env.PATH ?? "").split(":").filter(Boolean), ...DIRS]
  const path = dirs.map((d) => join(d, name)).find((p) => existsSync(p))
  if (!path) throw new Error(`${name} is not installed (brew install ${name === "sox" ? "sox" : "ffmpeg"})`)
  found.set(name, path)
  return path
}

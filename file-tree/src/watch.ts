// The project as it changes: a watch on the tree, called at most once a burst. What the burst says is offered to the
// panel, which ignores the paths it could not show anyway (a build inside an ignored folder).
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";

/** How long after the first change of a burst the panel looks again. */
export const DEBOUNCE = 300;

/**
 * Calls `onChange` with the paths a burst touched, after it settles. Gives back what stops it.
 *
 * The whole tree is watched where the platform can (macOS); where it cannot (Linux has no
 * recursive watch), the root and the repository's own directory are watched instead and a timer
 * looks again every so often.
 */
export function watch(root: string, onChange: (paths: string[]) => void, ms: number = DEBOUNCE): () => void {
  const watchers: FSWatcher[] = [];
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fallback: ReturnType<typeof setInterval> | null = null;
  const now = () => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    onChange(paths);
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(now, ms);
  };
  const heard = (_event: string, filename: string | null) => {
    pending.add(filename === null ? root : join(root, String(filename)));
    schedule();
  };
  const listen = (dir: string, recursive: boolean): boolean => {
    try {
      watchers.push(fsWatch(dir, { recursive }, heard));
      return true;
    } catch {
      return false;
    }
  };
  if (!listen(root, true)) {
    listen(root, false);
    listen(join(root, ".git"), false);
    fallback = setInterval(() => onChange([root]), 1_500);
  }
  return () => {
    if (timer !== null) clearTimeout(timer);
    if (fallback !== null) clearInterval(fallback);
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  };
}

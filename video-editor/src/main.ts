// The plugin's worker: it serves each project's editor page (src/serve.ts) and opens the tabs that
// show one. The window half is src/ui.tsx, a webview on the page, built from `page/` by src/page.ts
// the first time a project opens.
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fn, self, workspace } from "pumi"
import { ensurePage } from "./page.ts"
import { close, page } from "./serve.ts"

/** The tab option naming its project file: what `tab.open`'s args set (`pumi_dev.video_editor.project`). */
export const PROJECT = self.plugin.prefixed("project")
const BLOCK = self.plugin.prefixed("editor")

/** The editor page for `path`: where the tab's webview points. */
export async function url(path: string): Promise<string> {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`no project at ${abs}`)
  await ensurePage()
  return page(abs)
}

fn.set(
  "open",
  {
    desc: "Open a project (a Clipkit CKP/1.0 JSON file) in the film editor, in a tab beside this one.",
    paramsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  async (args: { path: string; place?: Parameters<typeof workspace.openTab>[2] }) => {
    const path = resolve(self.caller?.tab ? (workspace.getTab(self.caller.tab)?.cwd ?? ".") : ".", args.path)
    const tab = await workspace.openTab(BLOCK, { [PROJECT]: path }, args.place ?? { kind: "tiled", split: "right" })
    return tab.id
  },
)

process.on("exit", () => close())

// What the window draws: the editor's page in a webview. The page is Clipkit's editor, and it
// saves to the project file itself; nothing here reimplements it.
import { useEffect, useState } from "react"
import { call, usePlugin, useTab, useTheme, WebView, type RendererProps } from "pumi"
import { url } from "./main.ts"

/** The editor on the project its tab names (the plugin's `project` option, set when it opens). */
export function Editor({ tab, focused }: RendererProps) {
  const plugin = usePlugin() ?? "pumi_dev/video-editor"
  const key = `${plugin.replace("/", ".")}.project`
  const path = String(useTab(tab.id)?.options?.[key] ?? "")
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    setSrc(undefined)
    setError(undefined)
    if (!path) return void setError("This tab names no project file.")
    url(path).then(
      (u) => {
        if (!live) return
        setSrc(u)
        // The tab's title is the project's, as a file tab's is the file's.
        const title = path.split("/").pop()!.replace(/\.json$/i, "")
        void call("tab.update", tab.id, { title }).catch(() => {})
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [path, tab.id])

  if (error) return <Notice title="The project did not open" detail={error} />
  if (!src) return <Notice title="Opening the project…" detail={path} />
  // Space and the arrows are the editor's (play, step a frame), not the window's.
  return <WebView handle={`video-editor-${tab.id}`} src={src} autoFocus={focused} keepKeys={["space", "left", "right", "cmd+z", "cmd+shift+z"]} />
}

function Notice({ title, detail }: { title: string; detail: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 }}>
      <text style={{ color: t.text, fontSize: 13 }}>{title}</text>
      <text style={{ color: t.muted, fontSize: 11 }}>{detail}</text>
    </div>
  )
}

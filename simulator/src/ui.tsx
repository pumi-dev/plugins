// What the window draws: serve-sim's own preview page, in a webview. It brings the device's chrome,
// its toolbar and its input (taps, drags, keys go back over the helper's websocket), so the tab is
// the page and nothing here reimplements the protocol.
import { useEffect, useRef, useState } from "react"
import { usePlugin, useTab, useTheme, WebView, call, type RendererProps } from "pumi"
import { release, stream } from "./main.ts"

/** The device in a tab; no `udid` means the booted one (the plugin's `udid` option). */
export function Device({ tab, focused }: RendererProps) {
  const plugin = usePlugin() ?? "pumi_dev/simulator"
  const key = `${plugin.replace("/", ".")}.udid`
  const wanted = String(useTab(tab.id)?.options?.[key] ?? "")
  const [attempt, setAttempt] = useState(0)
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const held = useRef<string>(undefined)

  useEffect(() => {
    let live = true
    setUrl(undefined)
    setError(undefined)
    stream(wanted || undefined)
      .then((started) => {
        if (!live) return void release(started.udid)
        held.current = started.udid
        setUrl(started.url)
        // The tab's title in its bar, and in `pumi tab list`.
        void call("tab.call", tab.id, "report", { title: started.name }).catch(() => {})
      })
      .catch((failed: unknown) => {
        if (live) setError(failed instanceof Error ? failed.message : String(failed))
      })
    return () => {
      live = false
      const udid = held.current
      held.current = undefined
      if (udid) void release(udid)
    }
  }, [wanted, attempt])

  if (error) return <Notice title="The simulator did not start" detail={error} retry={() => setAttempt((n) => n + 1)} />
  if (!url) return <Notice title="Starting the simulator…" detail="The first device takes a moment: serve-sim installs itself once." />
  return <WebView handle={`simulator-${tab.id}`} src={url} autoFocus={focused} />
}

function Notice({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 }}>
      <text style={{ color: t.text, fontSize: 13 }}>{title}</text>
      <text style={{ color: t.muted, fontSize: 11 }}>{detail}</text>
      {retry ? (
        <div
          onClick={retry}
          style={{
            marginTop: 4,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 6,
            cursor: "pointer",
            hover: { backgroundColor: t.hover },
          }}
        >
          <text style={{ color: t.text, fontSize: 11 }}>Try again</text>
        </div>
      ) : null}
    </div>
  )
}

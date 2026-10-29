// The page: Clipkit's editor over the project the server serves beside it (`./_project`). Every
// edit is saved, a little after the last one; a change on disk that the page didn't make (an
// agent wrote the file) opens the new version in place of the old.
import "@clipkit/editor/styles.css"
import { Editor } from "@clipkit/editor"
import type { Source } from "@clipkit/protocol"
import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

const PROJECT = "./_project"
/** How long after the last edit the file is written. */
const SAVE_AFTER = 300

async function load(): Promise<Source> {
  const r = await fetch(PROJECT, { cache: "no-store" })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as Source
}

function EditorPage() {
  const [source, setSource] = useState<Source>()
  const [error, setError] = useState<string>()
  // Bumped when the file changes under the editor: a new key mounts it on the new source.
  const [version, setVersion] = useState(0)
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    load().then(setSource, (e: unknown) => setError(String(e)))
    const events = new EventSource("./_events")
    events.onmessage = () => {
      clearTimeout(pending.current)
      load().then((s) => {
        setSource(s)
        setVersion((v) => v + 1)
      }, (e: unknown) => setError(String(e)))
    }
    return () => events.close()
  }, [])

  const save = (s: Source) => {
    clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      void fetch(PROJECT, { method: "PUT", body: JSON.stringify(s, null, 2) + "\n" }).catch((e: unknown) => setError(String(e)))
    }, SAVE_AFTER)
  }

  if (error) return <div id="notice">{`The project did not open.\n${error}`}</div>
  if (!source) return <div id="notice">Opening…</div>
  return <Editor key={version} initialSource={source} onSourceChange={save} theme="dark" />
}

createRoot(document.getElementById("editor")!).render(<EditorPage />)

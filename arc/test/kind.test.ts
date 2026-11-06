// What the sidebar and the address pill make of a tab: a page's site, a terminal's word, a tile's
// letter and colour, and the rows a view's tabs make. No window, no server: the parts ask these.
import { describe, expect, test } from "bun:test"
import { addressOf, groupsOf, kindWord, mix, monogram, prefixOf, prunePinned, rowName, siteOf, TINTS, tintFor, togglePinned, webOf } from "../themes/arc/kind.ts"

const page = (url: string, block = "pumi_dev.browser.page") => ({ block, options: { "pumi_dev.browser.url": url } })

describe("webOf", () => {
  test("a page's address is its block's url option", () => {
    expect(webOf(page("https://howtogeek.com/x"))).toEqual({ prefix: "pumi_dev.browser.", url: "https://howtogeek.com/x" })
  })

  test("a block named page is a page before its option is written", () => {
    expect(webOf({ block: "pumi_dev.browser.page" })).toEqual({ prefix: "pumi_dev.browser.", url: "" })
  })

  test("anything else holds no page", () => {
    expect(webOf({ block: "pumi_dev.terminal.shell" })).toBeUndefined()
    expect(webOf({ block: "pumi_dev.terminal.shell", options: { url: "nope" } })).toBeUndefined()
  })

  test("another plugin's page block, by its own option", () => {
    const tab = { block: "someone.editor.page", options: { "someone.editor.url": "https://a.dev" } }
    expect(webOf(tab)).toEqual({ prefix: "someone.editor.", url: "https://a.dev" })
  })
})

describe("siteOf", () => {
  test("a site, without its scheme, www., path, query or hash", () => {
    expect(siteOf("https://www.howtogeek.com/823976/bing-chat/?a=1#top")).toBe("howtogeek.com")
    expect(siteOf("http://localhost:3000/app")).toBe("localhost:3000")
    expect(siteOf("HTTPS://Example.COM")).toBe("Example.COM")
  })

  test("nothing where there is no site", () => {
    expect(siteOf("")).toBe("")
    expect(siteOf("about:blank")).toBe("")
    expect(siteOf("file:///Users/amr/notes.md")).toBe("")
    expect(siteOf("tidbits.com")).toBe("")
  })
})

describe("kindWord", () => {
  test("the kind of what a tab holds, in one word", () => {
    expect(kindWord("pumi_dev.terminal.shell")).toBe("Terminal")
    expect(kindWord("pumi_dev.agents.chat")).toBe("Agent")
    expect(kindWord("pumi_dev.browser.page")).toBe("Page")
    expect(kindWord("pumi_dev.git.panel")).toBe("Git")
    expect(kindWord("pumi_dev.file_tree.tree")).toBe("Editor")
  })

  test("a block no rule knows says its own last word", () => {
    expect(kindWord("pumi_dev.csv_viewer.sheet")).toBe("Editor")
    expect(kindWord("someone.music_studio.mixer")).toBe("Mixer")
    expect(kindWord("blocks")).toBe("Blocks")
  })
})

describe("addressOf", () => {
  test("a page's site", () => {
    expect(addressOf(page("https://tidbits.com/2023/07/27/arc"))).toBe("tidbits.com")
  })

  test("a page that has not gone anywhere yet", () => {
    expect(addressOf({ block: "pumi_dev.browser.page" })).toBe("New Tab")
    expect(addressOf(page("about:blank"))).toBe("New Tab")
  })

  test("what a tab that is not a page holds", () => {
    expect(addressOf({ block: "pumi_dev.terminal.shell", cwd: "/Users/amr/src/app" })).toBe("Terminal")
  })
})

describe("monogram", () => {
  test("the site's first letter, or its name's", () => {
    expect(monogram("howtogeek.com")).toBe("H")
    expect(monogram("www.tidbits.com")).toBe("T")
    expect(monogram("https://arc.net")).toBe("A")
    expect(monogram("127.0.0.1:3000")).toBe("1")
  })

  test("something for nothing", () => {
    expect(monogram("")).toBe("•")
    expect(monogram("—")).toBe("•")
  })
})

describe("tintFor", () => {
  test("a site keeps its colour", () => {
    for (const name of ["howtogeek.com", "tidbits.com", "docs.google.com", "localhost:3000"]) {
      expect(tintFor(name)).toBe(tintFor(name))
      expect(TINTS).toContain(tintFor(name) as (typeof TINTS)[number])
    }
  })

  test("different names can be different colours", () => {
    expect(tintFor("arc.net")).not.toBe(tintFor("tidbits.com"))
  })
})

describe("pinned", () => {
  test("pinning and unpinning", () => {
    expect(togglePinned([], "%3")).toEqual(["%3"])
    expect(togglePinned(["%3", "%4"], "%3")).toEqual(["%4"])
  })

  test("a tile for a closed tab is dropped", () => {
    expect(prunePinned(["%3", "%9", "%4"], new Set(["%3", "%4"]))).toEqual(["%3", "%4"])
  })

  test("nothing to prune is the same list", () => {
    const pinned = ["%3"]
    expect(prunePinned(pinned, new Set(["%3"]))).toEqual(pinned)
  })
})

describe("groupsOf", () => {
  const a = { pane: ":1", tabs: ["%1"], active: "%1" }
  const b = { pane: ":2", tabs: ["%2", "%3"], active: "%3" }
  const empty = { pane: ":3", tabs: [] }

  test("a row per pane, in the layout's order, a pane's tabs together", () => {
    expect(groupsOf([a, b])).toEqual([
      { pane: ":1", tabs: ["%1"], active: "%1" },
      { pane: ":2", tabs: ["%2", "%3"], active: "%3" },
    ])
  })

  test("a pane with no tab is no row", () => {
    expect(groupsOf([a, empty])).toHaveLength(1)
  })

  test("a pane with no tab in front shows its first", () => {
    expect(groupsOf([{ pane: ":1", tabs: ["%1", "%2"] }])[0]!.active).toBe("%1")
  })

  test("the tabs no pane holds come last, in a row of their own", () => {
    const rows = groupsOf([a], ["%7", "%1", "%8"])
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ pane: "", tabs: ["%7", "%8"], active: "%7" })
  })
})

describe("rowName", () => {
  test("its own name first, then the title, then its folder, then its kind", () => {
    expect(rowName({ block: "pumi_dev.terminal.shell", label: "build" })).toBe("build")
    expect(rowName({ block: "pumi_dev.browser.page", terminal_title: "How-To Geek" })).toBe("How-To Geek")
    expect(rowName({ block: "pumi_dev.terminal.shell", cwd: "/Users/amr/src/app" })).toBe("app")
    expect(rowName({ block: "pumi_dev.terminal.shell" })).toBe("Terminal")
  })
})

describe("prefixOf", () => {
  test("a block's option prefix", () => {
    expect(prefixOf("pumi_dev.browser.page")).toBe("pumi_dev.browser.")
    expect(prefixOf("blocks")).toBe("")
  })
})

describe("mix", () => {
  test("halfway between two colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(mix("#123456", "#ffffff", 0)).toBe("#123456")
    expect(mix("#123456", "#123456", 1)).toBe("#123456")
  })

  test("a short colour reads as its long one", () => {
    expect(mix("#fff", "#000000", 0)).toBe("#ffffff")
  })

  test("a site's colour, paled into its tile", () => {
    expect(mix(tintFor("howtogeek.com"), "#ffffff", 0.86)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

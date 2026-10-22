// All Tabs: every session's tabs in the header, one group a session, a hairline between them and
// no names. Only the session in front gives its selected tab the `active` look; a tab of another
// session looks like a tab of that session, and clicking it goes there. Everything else in the
// window is the app's default: this theme draws the tab bar, and nothing else.
//
// From this package's `theme.lua`, which extended the default theme: the header's grouping was a
// copy of the default header row there, and is a `TabBar` now that a theme can replace one part.
import { defineTheme } from "pumi"
import { TabBar } from "./tabbar.tsx"

export default defineTheme({
  name: "All Tabs",
  description: "pumi's own, with every session's tabs in the header: one group a session, no names.",
  components: { TabBar },
})

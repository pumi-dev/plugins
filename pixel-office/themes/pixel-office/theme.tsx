// Pixel Office: pumi as a pixel office you walk around: wood floors,
// carpeted rooms with their names on signs, dark name tags, framed game boxes and a pixel font. A
// desk for every view of every session (or every tab), each with its live screen; sit at one and
// its real views open on the monitor. Its Mode setting draws it by day or at night: the same room,
// its own colours for each (`palette.ts`).
import { defineTheme } from "pumi"
import { LIGHT, TERMINAL } from "./palette.ts"
import { PARTS } from "./parts.tsx"
import { Office, Starting } from "./window.tsx"

export default defineTheme({
  name: "Pixel Office",
  description: "A pixel-art office you walk around: a desk for every view (or tab), its agent at it and its screen live.",
  // Day or night is the theme's own setting (`contributes.options.appearance`): the room takes its
  // own colours from it (`useOfficeTheme` in `kit.tsx`), this is the day set it is drawn with by default.
  colors: LIGHT,
  terminal: TERMINAL.light,
  // The pixel font, brought along so it draws whether or not it is installed.
  fonts: [`${import.meta.dir}/fonts/PixelifySans.ttf`],
  metrics: { fontSize: 13, radius: 3, radiusSmall: 2 },
  components: { ...PARTS, Window: Office, Starting },
  tooltip: (tokens) => ({
    backgroundColor: tokens.tag,
    color: tokens.tagText,
    borderRadius: 6,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
    fontFamily: "Pixelify Sans",
  }),
})

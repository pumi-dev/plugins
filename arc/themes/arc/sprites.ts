// The two glyphs Arc has that the app's icon set does not: a pin, and a bin. Each is a `data:` URI
// of an SVG, which is what an `<svg>`'s `src` takes, drawn in the colour the style gives it.

const uri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`

/** A pin, head up: the tab pinned to the top of the sidebar. */
export const PIN = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">
<path d="M8 8.2v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<rect x="5.7" y="1.6" width="4.6" height="3" rx="1.1" fill="currentColor"/>
<path d="M3.7 5.1h8.6l-1 2.8H4.7z" fill="currentColor"/>
</svg>`)

/** A bin: the close of a tab's row, as Arc's foot has it. */
export const TRASH = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
<path d="M2.8 4.3h10.4M6.2 4.3V2.8h3.6v1.5M4.2 4.3l.6 8.2a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.2"/>
<path d="M6.7 7v4M9.3 7v4"/>
</svg>`)

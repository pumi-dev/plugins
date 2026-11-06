// The night's art, as SVG sources: a pumpkin and a ghost for the tabs' icons, a bat in two
// wing beats, a spider, and a cobweb drawn from its spokes and sagging threads. Each is a `data:`
// URI, which is what an `<svg>`'s `src` takes.

const uri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`

/** A jack-o'-lantern, lit from inside: a working agent. */
export const PUMPKIN = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<path d="M16 8c-.4-2.6.8-4.6 3.2-5.4" stroke="#6fae2e" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<ellipse cx="10.5" cy="19" rx="8" ry="10" fill="#d4560b"/>
<ellipse cx="21.5" cy="19" rx="8" ry="10" fill="#d4560b"/>
<ellipse cx="16" cy="19" rx="7.5" ry="11" fill="#ff7a1a"/>
<path d="M8.5 17l3.2-4.2 3.2 4.2zM17.1 17l3.2-4.2 3.2 4.2z" fill="#ffd84a"/>
<path d="M8 21.5q8 6.5 16 0l-2.2 4-2.4-1.8-1.7 2.4-1.7-2.4-1.7 2.4-1.7-2.4-2.4 1.8z" fill="#ffd84a"/>
</svg>`)

/** A sheet ghost: a blocked agent, waiting for you. */
export const GHOST = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<path d="M6 30V14a10 10 0 0 1 20 0v16l-3.4-3-3.3 3-3.3-3-3.3 3-3.3-3z" fill="#f3eeff"/>
<ellipse cx="12.4" cy="14.5" rx="2.1" ry="2.9" fill="#1a1024"/>
<ellipse cx="19.6" cy="14.5" rx="2.1" ry="2.9" fill="#1a1024"/>
<ellipse cx="16" cy="21.5" rx="2.1" ry="2.6" fill="#1a1024"/>
</svg>`)

/** A bat, its wings up and down: the two frames of its flap, stretched to the box it is drawn in. */
export const BAT_UP = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" preserveAspectRatio="none">
<path fill="currentColor" d="M32 13c-1.6 0-2.6 1-3.1 2.2L27.6 12l-.9 3.6C22.2 9 14 3.5 2 2c5 4 7.5 9 6.6 15 3.2-2.4 7.4-2.4 10.4.8 1.2-3 4.2-4.6 7-3.6.9 3 3 5.8 6 8.2 3-2.4 5.1-5.2 6-8.2 2.8-1 5.8.6 7 3.6 3-3.2 7.2-3.2 10.4-.8C54.5 11 57 6 62 2 50 3.5 41.8 9 37.3 15.6l-.9-3.6-1.3 3.2C34.6 14 33.6 13 32 13z"/>
</svg>`)
export const BAT_DOWN = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" preserveAspectRatio="none">
<path fill="currentColor" d="M32 9c-1.6 0-2.6 1-3.1 2.2L27.6 8l-.9 3.6C22 12 14 15 4 26c6-1.4 10-.6 12.6 2 1.4-3 4.6-5 8-4.8.9 2.6 3.4 5 7.4 6.8 4-1.8 6.5-4.2 7.4-6.8 3.4-.2 6.6 1.8 8 4.8C50 25.4 54 24.6 60 26 50 15 42 12 37.3 11.6l-.9-3.6-1.3 3.2C34.6 10 33.6 9 32 9z"/>
</svg>`)

/** A spider on its thread's end. */
export const SPIDER = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round">
<path d="M12 15l-6-4-3 2M12 17l-7 0-3 3M12 19l-6 3-2 4M13 21l-4 5-1 4"/>
<path d="M20 15l6-4 3 2M20 17l7 0 3 3M20 19l6 3 2 4M19 21l4 5 1 4"/>
</g>
<ellipse cx="16" cy="12" rx="3.4" ry="3" fill="currentColor"/>
<ellipse cx="16" cy="19" rx="5" ry="5.6" fill="currentColor"/>
<circle cx="14.6" cy="11.4" r=".9" fill="#ff3b3b"/><circle cx="17.4" cy="11.4" r=".9" fill="#ff3b3b"/>
</svg>`)

/**
 * A cobweb in a corner of `size` px, its hub at the top right: spokes out to the far edges, and
 * between each two a thread that sags toward the hub, at each of `rings` distances.
 */
export function cobweb(size: number, rings = 5, spokes = 7, turn = 0): string {
  const hub = { x: size, y: 0 }
  const ends = Array.from({ length: spokes }, (_, i) => {
    const a = Math.PI / 2 + (i / (spokes - 1)) * (Math.PI / 2)
    return { x: hub.x + Math.cos(a) * size * 1.05, y: hub.y + Math.sin(a) * size * 1.05 }
  })
  const at = (p: { x: number; y: number }, k: number) => ({ x: hub.x + (p.x - hub.x) * k, y: hub.y + (p.y - hub.y) * k })
  const f = (n: number) => n.toFixed(1)
  let d = ends.map((e) => `M${f(hub.x)} ${f(hub.y)}L${f(e.x)} ${f(e.y)}`).join("")
  for (let r = 1; r <= rings; r++) {
    const k = r / (rings + 0.4)
    for (let i = 0; i < spokes - 1; i++) {
      const a = at(ends[i]!, k)
      const b = at(ends[i + 1]!, k)
      const mid = at({ x: (ends[i]!.x + ends[i + 1]!.x) / 2, y: (ends[i]!.y + ends[i + 1]!.y) / 2 }, k * 0.86)
      d += `M${f(a.x)} ${f(a.y)}Q${f(mid.x)} ${f(mid.y)} ${f(b.x)} ${f(b.y)}`
    }
  }
  // `turn` (degrees) moves the hub to another corner: 180 is the bottom left.
  const g = turn ? ` transform="rotate(${turn} ${size / 2} ${size / 2})"` : ""
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path${g} d="${d}" stroke="currentColor" stroke-width="1" fill="none"/></svg>`)
}

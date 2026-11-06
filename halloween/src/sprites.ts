// The night's art, as SVG sources: a pumpkin, a ghost, a skull and a sweet for the tabs' icons,
// a bat in two wing beats, a spider, a cobweb drawn from its spokes and sagging threads, the
// moon, a lightning bolt, fog, and the grass a gravestone stands in. Each is a `data:` URI, which
// is what an `<svg>`'s `src` takes.

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

/** A skull: an agent that failed. */
export const SKULL = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<path d="M16 3C9.4 3 5 7.6 5 13.6c0 3.6 1.6 6.2 4 7.8V26a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.6c2.4-1.6 4-4.2 4-7.8C27 7.6 22.6 3 16 3z" fill="#efe6d6"/>
<ellipse cx="11.4" cy="14.6" rx="3" ry="3.4" fill="#2a0d10"/>
<ellipse cx="20.6" cy="14.6" rx="3" ry="3.4" fill="#2a0d10"/>
<path d="M16 18.4l-1.8 3h3.6z" fill="#2a0d10"/>
<path d="M12.6 24v4M16 24v4M19.4 24v4" stroke="#2a0d10" stroke-width="1.4"/>
<circle cx="11.4" cy="14.6" r="1" fill="#ff4d4d"/><circle cx="20.6" cy="14.6" r="1" fill="#ff4d4d"/>
</svg>`)

/** A wrapped sweet: an agent that is done, its treat. */
export const CANDY = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<path d="M9.6 16L2.4 10.4v11.2zM22.4 16l7.2-5.6v11.2z" fill="#5fbf2c"/>
<circle cx="16" cy="16" r="7.4" fill="#8be04e"/>
<path d="M10.4 12.6c2.6 2 8.6 4.8 11.2 6.8M9.2 16.6c2.8 1.6 6.8 3.6 9 4.4M12.6 9.6c2.4 1.8 6.6 3.8 9.6 4.8" stroke="#f7ffe8" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</svg>`)

/** The moon, a little past full, with its craters. */
export const MOON = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="32" cy="32" r="26" fill="#fff3c4"/>
<path d="M44 10.6A26 26 0 0 1 32 58a26 26 0 0 0 12-47.4z" fill="#f1d98a"/>
<circle cx="22" cy="24" r="5" fill="#efdc9a"/><circle cx="36" cy="40" r="7" fill="#efdc9a"/><circle cx="38" cy="20" r="3" fill="#efdc9a"/><circle cx="20" cy="42" r="2.6" fill="#efdc9a"/>
</svg>`)

/** A bolt of lightning, top to bottom. */
export const LIGHTNING = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 200" preserveAspectRatio="none">
<path d="M34 0L14 84h18L8 200l46-124H34L48 0z" fill="#f4ecff"/>
<path d="M38 0L22 78h16L18 168l30-96H36L44 0z" fill="#ffffff"/>
</svg>`)

/** A bank of fog, its puffs blurred into each other, stretched to the box it is drawn in. */
export const FOG = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80" preserveAspectRatio="none">
<filter id="f" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
<g fill="#d9ccff" filter="url(#f)">
<ellipse cx="20" cy="66" rx="70" ry="20"/><ellipse cx="110" cy="58" rx="80" ry="22"/><ellipse cx="200" cy="68" rx="70" ry="18"/>
<ellipse cx="280" cy="56" rx="90" ry="24"/><ellipse cx="380" cy="66" rx="70" ry="20"/>
<rect x="-20" y="72" width="440" height="20"/>
</g>
</svg>`)

/** What a gravestone stands in: a mound of earth, tufts of grass, and a small pumpkin at its foot. */
export const GRAVE_FOOT = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 28" preserveAspectRatio="none">
<path d="M0 28C20 10 60 6 100 6s80 4 100 22z" fill="#1f1409"/>
<path d="M6 24l4-10 2 9 3-12 2 12 4-9 1 10M40 14l3-8 1 8 3-10 2 10 3-7M150 14l3-9 2 8 3-11 2 11 3-8 1 8M182 24l3-9 2 9 3-11 2 11" stroke="#3f6b1f" stroke-width="2" fill="none" stroke-linecap="round"/>
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
<g stroke="#3b2a52" stroke-width="1.6" fill="none" stroke-linecap="round">
<path d="M12 15l-6-4-3 2M12 17l-7 0-3 3M12 19l-6 3-2 4M13 21l-4 5-1 4"/>
<path d="M20 15l6-4 3 2M20 17l7 0 3 3M20 19l6 3 2 4M19 21l4 5 1 4"/>
</g>
<ellipse cx="16" cy="12" rx="3.4" ry="3" fill="#3b2a52"/>
<ellipse cx="16" cy="19" rx="5" ry="5.6" fill="#3b2a52"/>
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

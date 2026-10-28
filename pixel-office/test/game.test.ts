// The walk: brisk with the keys, and a click's walk over in a moment however far it goes.
import { expect, test } from "bun:test"
import { Game } from "../themes/pixel-office/game.ts"

const room = { width: 2000, height: 1200 }

/** Runs the game's own timer for `ms`, then stops it. */
async function run(game: Game, ms: number) {
  await new Promise((done) => setTimeout(done, ms))
}

test("a held key walks you at a brisk stride, not a sprint", async () => {
  const game = new Game({ x: 100, y: 400 })
  game.size = room
  game.press("d")
  // Held: its repeats keep it held.
  const repeat = setInterval(() => game.press("d", true), 30)
  await run(game, 500)
  clearInterval(repeat)
  game.release("d")
  game.dispose()
  const walked = game.you.at.x - 100
  // Over half a second: 330 px a second, give or take a frame.
  expect(walked).toBeGreaterThan(120)
  expect(walked).toBeLessThan(200)
  expect(game.you.facing).toBe("right")
})

test("a click's walk across the floor is over in well under a second", async () => {
  const game = new Game({ x: 100, y: 400 })
  game.size = room
  let arrived = 0
  const start = Date.now()
  expect(game.walkTo({ x: 1800, y: 900 }, () => (arrived = Date.now()))).toBe(true)
  await run(game, 1000)
  game.dispose()
  expect(arrived).toBeGreaterThan(0)
  expect(arrived - start).toBeLessThan(850)
  expect(arrived - start).toBeGreaterThan(400)
  expect(Math.round(game.you.at.x)).toBe(1800)
})

test("a fast walk still stops at a desk", async () => {
  const game = new Game({ x: 100, y: 400 })
  game.size = room
  game.walls = [{ x: 300, y: 300, w: 60, h: 200 }]
  game.press("d")
  const repeat = setInterval(() => game.press("d", true), 30)
  await run(game, 600)
  clearInterval(repeat)
  game.dispose()
  expect(game.you.at.x).toBeLessThan(300)
})

# pumi-dog

A little pumi in the status bar. It walks back and forth along its track, stops to wag and blink,
and barks when you click it.

```text
  walk ──(one step in forty)──▶ sit ──(counted out)──▶ walk
   ▲                            │  wag, blink, turn around
   │                            ▼
   └────────────── bark ◀── a click, or `bark`: eight steps, then a sit
```

It is drawn in the status line's slot, last, and it comes out with the app: `toggle` puts it away
and brings it back. Clicking the dog barks.

## The dog

The art is six frames of 22×15 pixels — the walk's two, the wag's two, a blink and a bark — drawn
in the theme's own palette (Catppuccin Mocha's names, `palette.text` for the light fur,
`palette.red` for the tongue), one canvas rect per run of a colour. Left-facing frames are the
right-facing ones reversed, so there is one set of art and two directions.

What it does next is a function of what it is doing now, its options and a seed: it walks until it
feels like sitting (one step in forty), sits for a while — wagging its tail two frames at a time,
blinking now and then, sometimes turning around — and then walks on. At the end of its track it
turns rather than walking off it. A bark is eight steps long, the mouth opening and shutting two
frames at a time, and it ends in a sit.

## Options

Its three options are under **Pumi dog** in Settings, and their full names start
`amresyd.pumi_dog.`:

- `speed` — animation frames per second (default 8). Lower is calmer and cheaper.
- `track` — how much of the status bar the dog walks along, in pixels (default 140).
- `size` — the dog's height, in pixels (default 20).

A change is felt at the next frame: the dog is drawn again at its new size on the spot it stands
on, and the next step comes at the new pace.

## Functions

```sh
pumi call amresyd.pumi_dog.toggle     # show or hide the dog
pumi call amresyd.pumi_dog.bark       # the dog says hi
```

Another package, a script or a key binding of your own reaches them the same way.

## Limits

The timer is the package's: one step each frame while a dog is on the bar, so a `speed` of 20 is 50
steps a second of a few hundred small rects. Lower is cheaper, and a dog that is put away costs
nothing at all.

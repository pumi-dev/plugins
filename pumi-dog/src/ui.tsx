// What the dog draws, in the window's React tree: the frame it is in, on its track in the status
// bar, and its bubble while it barks. The art is `sprite.ts`'s runs of one colour, one div each; the
// walk is `walker.ts`'s step; the settings are the package's options, which the window reads itself.
import { useEffect, useRef, useState } from "react";
import { useOption, usePackage, useTheme } from "pumi";

import { interval, read, scale, width } from "./settings.ts";
import { paint } from "./sprite.ts";
import { bark as barked, barking, born, seeded, step, type Walker } from "./walker.ts";

/** The dog in the status bar: one track wide, drawn a frame at a time. */
export function Dog() {
  const t = useTheme();
  const pkg = usePackage() ?? "";
  const prefix = pkg ? `${pkg.replace("/", ".")}.` : "";
  const dog = useRef<Walker>(born());
  const rng = useRef(seeded());
  const [, drawn] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Its options: the frame rate, the room it walks in, and its height.
  const speed = useOption<number>(`${prefix}speed`);
  const track = useOption<number>(`${prefix}track`);
  const size = useOption<number>(`${prefix}size`);
  const settings = read((key) => ({ speed, track, size })[key]);
  // The last bark: a time, which the package sets wherever `bark` is called from.
  const barkAt = useOption<number>(`${prefix}@bark`);
  // Whether it is out: `toggle` sets it off.
  const out = useOption<boolean>(`${prefix}@dog`);

  useEffect(() => {
    if (barkAt) dog.current = barked(dog.current);
  }, [barkAt]);

  // One step every frame, for as long as the dog is drawn: the interval is read each time, so a
  // change of `speed` is felt at the next frame.
  useEffect(() => {
    if (out === false) return;
    let live = true;
    const next = () => {
      if (!live) return;
      timer.current = setTimeout(() => {
        dog.current = step(dog.current, settings, rng.current);
        drawn((n) => n + 1);
        next();
      }, interval(settings));
    };
    next();
    return () => {
      live = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [settings.fps, settings.track, settings.height, out]);

  if (out === false) return null;
  const walk = dog.current;
  const scaleOf = scale(settings);
  const dogWidth = width(settings);
  const roomRight = settings.track - (walk.x + dogWidth);
  const atRight = (!walk.left && roomRight >= 40) || (walk.left && walk.x < 40);
  return (
    <div
      aria-label="The pumi dog: click it and it barks"
      onClick={() => {
        dog.current = barked(dog.current);
        drawn((n) => n + 1);
      }}
      style={{ position: "relative", width: settings.track, height: settings.height, flexShrink: 0, cursor: "pointer" }}
    >
      <div style={{ position: "absolute", left: walk.x, top: 0, width: dogWidth, height: settings.height }}>
        {paint(walk.pose, walk.left, scaleOf, t).map((run, i) => {
          return <div key={i} style={{ position: "absolute", left: run.x, top: run.y, width: run.w, height: run.h, backgroundColor: run.color }} />;
        })}
      </div>
      {barking(walk) ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: atRight ? walk.x + dogWidth : Math.max(walk.x - 40, 0),
            paddingLeft: 4,
            paddingRight: 4,
            borderRadius: 4,
            backgroundColor: t.surface,
            color: t.accent,
            whiteSpace: "nowrap",
          }}
        >
          <text style={{ fontSize: 11, color: t.accent }}>woof!</text>
        </div>
      ) : null}
    </div>
  );
}

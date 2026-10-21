// The package as it runs: the dog comes out in the status bar, its two functions reach it, its
// options are followed, and the view it draws at the states it is in.
import { afterEach, expect, test } from "bun:test";
import type { FakeApp } from "pumi/testing";
import { dir, machine } from "./machine.ts";

let app: FakeApp;
afterEach(() => app?.stop());

/** The package's own `name` (`amresyd.pumi_dog.` in the app, `local.pumi_dog.` here). */
const at = (app: FakeApp, name: string) => `${app.init.prefix}${name}`;

/** Where the dog is put: the status line's slot, last, without the keyboard. */
const place = { kind: "slot", name: "statusline", order: 1000, focus: false };

/** The dog's box, as the view drew it. */
function box(v: ReturnType<FakeApp["open"]>) {
  const style = v.find("#pumi-dog").style ?? {};
  return { width: style.width, height: style.height };
}

test("the dog comes out in the status bar as the package starts", async () => {
  app = await machine();
  expect(app.called("pane.open")).toEqual([[at(app, "dog"), {}, place]]);
});

test("it comes out once, even when it is already there", async () => {
  app = await machine({ panes: [7] });
  expect(app.called("pane.open")).toEqual([]);
});

test("toggle takes a dog that is out away", async () => {
  app = await machine({ panes: [7] });
  await app.serve(at(app, "toggle"));
  expect(app.called("pane.close")).toEqual([[7, true]]);
});

test("toggle brings a dog that was taken away back", async () => {
  app = await machine({ panes: [] });
  app.calls.length = 0;
  await app.serve(at(app, "toggle"));
  expect(app.called("pane.open")).toEqual([[at(app, "dog"), {}, place]]);
});

test("bark says hi, whether or not the dog is out", async () => {
  app = await machine();
  await app.serve(at(app, "bark"));
  const v = app.open("dog");
  await app.settle();
  expect(v.text()).toBe("");
  await app.serve(at(app, "bark"));
  expect(v.text()).toBe("woof!");
});

test("the dog as it comes out: sitting at the start of its track", async () => {
  app = await machine();
  const v = app.open("dog", { size: { width: 800, height: 40 } });
  await app.settle();
  expect(v.errors).toEqual([]);
  expect(box(v)).toEqual({ width: "140px", height: "20px" });
  expect(v.find("#frame").paint?.length).toBeGreaterThan(0);
  expect(v.snapshot()).toMatchSnapshot();
});

test("a click barks: the mouth opens, and it says woof!", async () => {
  app = await machine();
  const v = app.open("dog");
  await app.settle();
  await v.click("#pumi-dog");
  expect(v.text()).toBe("woof!");
  expect(v.snapshot()).toMatchSnapshot();
});

test("its options are followed: the track it walks along and its size", async () => {
  app = await machine();
  const v = app.open("dog");
  await app.settle();
  app.options.set(at(app, "track"), 300);
  app.options.set(at(app, "size"), 30);
  await app.fire("option.changed", { name: at(app, "size"), old: 20, new: 30, scope: "global" }, { match: at(app, "size") });
  expect(box(v)).toEqual({ width: "300px", height: "30px" });
  // 30 screen pixels over 15 art pixels: the frame is drawn at two screen pixels a pixel.
  const frame = v.find("#frame");
  const commands = frame.paint ?? [];
  expect(commands[0]).toMatchObject({ cmd: "fillRect", h: 2 });
  expect((frame.style ?? {}).width).toBe("44px");
});

test("the dog steps with the clock", async () => {
  app = await machine({ options: { speed: 20 } });
  const v = app.open("dog");
  await app.settle();
  const drawn = v.batches.length;
  // The first frame waits the 8 fps default it started with, then two at 20 fps: its two wagging
  // poses, or a blink.
  await Bun.sleep(300);
  await app.settle();
  expect(v.batches.length).toBeGreaterThan(drawn);
});

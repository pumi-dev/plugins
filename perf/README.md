# perf

How the app is doing, floating in a corner of the window: the overlay that used to be built
into pumi (Cmd-Alt-P), as a package. The app keeps the numbers — it samples itself every
second — and answers `app.perf` with them; this package only draws them.

```text
performance
app    cpu    12% now    9% 10s    7% 60s  peak   31%    ▁▁▂▁▁▃▁▁▁▂▁▁▁▁▁▂▁▁▁▁▁▁▃▁▁▁▁▁▁▂
       rss 412.3 MB  threads 41  up 380s  samples 300
ui     thread    4% 10s    3% 60s  60 frames/s  avg 1.9ms  max 14.2ms  slow 3
ext       busy 10s cpu 10s cpu 60s call/s queue ui/s    mem      call
git       2%       1%      1%      0.4    0     0.1ms   1.2 MB   max refresh 31.5ms
thread                     now     10s     60s     peak
main                       4%      3%      3%      19%
plugin perf                0%      0%      0%      1%
```

- **app**: the process's CPU (100% is one core) and memory.
- **ui**: how much of each second the main thread spends drawing, frames a second, and frames
  slower than 16.7 ms.
- **ext**: each core plugin (`git`, `files`, …): how busy its thread is, its calls, what is
  queued for it, and its slowest call (or the one it is in, when that has run for a while).
- **thread**: the busiest threads by name; a package's component is `plugin <name>`.

Rows turn yellow past 10% of a core and red past half.

## Use

`perf.trigger` (Cmd-Alt-P) shows and hides it from anywhere, as does **View → Performance
Overlay** and `pumi call perf.toggle`. It floats over the whole window (`relative = "client"`)
in `perf.corner`, takes neither the keyboard nor the pointer, and is as tall as what it shows:
it moves its own pane (`pumi_pane_set_place`) when a row comes or goes.

| Option | | |
| --- | --- | --- |
| `trigger` | `<D-M-p>` | the key that toggles it |
| `corner` | `NE` | `NE`, `NW`, `SE` or `SW` |

`pumi call app.perf` is the same report as JSON, for anything else that wants it.

## Build

The crate is called `perf`, and so is a crate in the zed repository gpui comes from, so `-p perf`
is ambiguous: name it by its manifest when building it alone:

```sh
cargo build --release --manifest-path perf/ui/Cargo.toml
cargo test --target aarch64-apple-darwin --manifest-path perf/ui/Cargo.toml
pumi pack add ~/Kitchen/pumi-plugins/perf
```

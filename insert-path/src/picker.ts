// The picker: a float over the tab that lists the terminal's directory, filters it as you type,
// and on Enter (or a click) types the path into the terminal's program and closes.
import { join } from "node:path";
import {
  div,
  type El,
  icon,
  input,
  list,
  notify,
  pane,
  pkg,
  px,
  relative,
  ScrollHandle,
  svg,
  theme,
  ui,
  View,
  type ViewContext,
} from "pumi";
import { type Entry, walk } from "./entries.ts";
import { type Hit, hits } from "./match.ts";
import { quote, tilde } from "./path.ts";

const PLACEHOLDER = "Filter files…";
/** A row's height, and an icon's size. */
const ROW = 26;
const ICON = 14;

/** What a row's icon is by the file's extension. */
const CODE = new Set([
  "rs", "py", "js", "jsx", "ts", "tsx", "go", "lua", "c", "h", "cc", "cpp", "hpp", "swift", "kt",
  "java", "rb", "php", "sh", "bash", "zsh", "fish", "css", "scss", "html", "json", "toml", "yaml",
  "yml", "sql",
]);
const PICTURE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff"]);
const PAGE = new Set(["url", "webloc"]);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Types `text` into pane `id`, saying so when it cannot. */
function type(id: number, text: string): void {
  pane.call(id, "input", { text }).catch((err) => notify(`insert-path: ${message(err)}`, "error"));
}

/** The icon a row draws: the app's own by kind, otherwise the package's document. */
function rowIcon(entry: Entry): El {
  const extension = entry.extension;
  const named = entry.dir
    ? "folder"
    : extension !== null && CODE.has(extension)
      ? "code"
      : extension !== null && PICTURE.has(extension)
        ? "image"
        : extension !== null && PAGE.has(extension)
          ? "globe"
          : null;
  const drawn = named === null ? svg(join(pkg.dir, "icons/file.svg")) : icon(named);
  return drawn.flexNone().size(px(ICON)).textColor(theme.muted);
}

/** What the picker is opened with. */
export interface PickerArgs {
  /** The terminal pane the path is typed into. */
  pane?: number;
  /** The directory it lists; the package's own working directory without. */
  cwd?: string;
  /** Wrap the path in quotes when a shell would split it (`true` without). */
  quote?: boolean;
  /** Typed back when the picker is dismissed before anything was typed: the bare key that opened
   * it. */
  cancel?: string | null;
}

export class Picker extends View<PickerArgs> {
  /** The terminal the path is typed into. */
  private readonly term: number;
  /** The directory it lists, as the header shows it. */
  private readonly label: string;
  private readonly quoting: boolean;
  private readonly cancel: string | null;
  private readonly entries: Entry[];
  private found: Hit[];
  /** Which of `found` is highlighted. */
  private at = 0;
  private query = "";
  private readonly rows = new ScrollHandle();
  /** It was picked or cancelled: what closes it types nothing more. */
  private done = false;

  constructor(cx: ViewContext<PickerArgs>) {
    super(cx);
    const args = cx.args ?? {};
    this.term = typeof args.pane === "number" ? args.pane : cx.pane.id;
    const cwd = args.cwd ? args.cwd : process.cwd();
    this.label = tilde(cwd);
    this.quoting = args.quote !== false;
    this.cancel = args.cancel ?? null;
    this.entries = walk(cwd);
    this.found = hits(this.entries, "");
  }

  render(): El {
    const at = Math.min(this.at, Math.max(0, this.found.length - 1));
    return div()
      .id("insert-path")
      .flex()
      .flexCol()
      .sizeFull()
      .bg(theme.surface)
      .textSize(px(13))
      .textColor(theme.surface_text)
      .onKey((e) => this.key(e.key))
      .child(this.header())
      .child(this.listing(at))
      .child(ui.divider())
      .child(div().flexNone().p(px(8)).child(this.field()));
  }

  /** The app closed the float (a press outside it): a cancel, as Escape is. */
  closed(): void {
    if (this.done) return;
    this.done = true;
    if (this.query === "" && this.cancel !== null) type(this.term, this.cancel);
  }

  /** The directory, and how many paths match. */
  private header(): El {
    return div()
      .id("insert-path-header")
      .flex()
      .flexRow()
      .itemsCenter()
      .flexNone()
      .gap(px(6))
      .px(px(12))
      .pt(px(10))
      .pb(px(4))
      .textSize(px(12))
      .textColor(theme.muted)
      .child(icon("search").flexNone().size(px(12)).textColor(theme.placeholder))
      .child(div().flex1().child(this.label))
      .child(div().id("insert-path-count").flexNone().textColor(theme.placeholder).child(String(this.found.length)));
  }

  /** The matches, of which only those in sight are rendered; or that there are none. */
  private listing(at: number): El {
    if (this.found.length === 0) {
      return div()
        .id("insert-path-list")
        .flex1()
        .minH(px(0))
        .px(px(6))
        .py(px(2))
        .child(
          div()
            .id("insert-path-nothing")
            .flexNone()
            .h(px(ROW))
            .px(px(8))
            .flex()
            .itemsCenter()
            .textColor(theme.placeholder)
            .child("No files match"),
        );
    }
    return list({ rows: this.found.length, rowHeight: ROW, render: (i) => this.row(i, i === at) })
      .id("insert-path-list")
      .flex1()
      .minH(px(0))
      .px(px(6))
      .py(px(2))
      .track(this.rows);
  }

  /** Match `i`: its icon, its name, and the directory above it. */
  private row(i: number, selected: boolean): El {
    const entry = this.entries[this.found[i]!.index]!;
    const parent = entry.parent;
    return div()
      .id(`insert-path-row-${i}`)
      .flex()
      .flexRow()
      .itemsCenter()
      .flexNone()
      .h(px(ROW))
      .px(px(8))
      .gap(px(8))
      .roundedSm()
      .cursorPointer()
      .when(selected, (row) => row.bg(theme.primary).textColor(theme.primary_foreground))
      .when(!selected, (row) => row.hover((s) => s.bg(theme.hover)))
      .onMouseEnter(() => this.highlight(i))
      .onClick(() => this.insert(entry.dir ? `${entry.rel}/` : entry.rel))
      .child(rowIcon(entry))
      .child(div().flex1().fontWeight(500).child(entry.name))
      .when(parent !== "", (row) =>
        row.child(
          div()
            .flexNone()
            .maxW(relative(0.45))
            .truncate()
            .textColor(selected ? theme.primary_foreground : theme.muted)
            .child(parent),
        ),
      );
  }

  /** What is typed: the query the matches come from. */
  private field(): El {
    return input(this.query)
      .id("insert-path-query")
      .placeholder(PLACEHOLDER)
      .autofocus()
      .onInput((e) => this.refilter(e.value));
  }

  /** The match under the highlight. */
  private selected(): Entry | undefined {
    const hit = this.found[this.at];
    return hit === undefined ? undefined : this.entries[hit.index];
  }

  private refilter(query: string): void {
    this.query = query;
    this.found = hits(this.entries, query);
    this.at = 0;
    this.rows.scrollToRow(0);
    this.cx.notify();
  }

  /** Moves the highlight `by` rows, around the ends. */
  private step(by: number): void {
    if (this.found.length === 0) return;
    const len = this.found.length;
    this.at = (((this.at + by) % len) + len) % len;
    this.rows.scrollToRow(this.at);
    this.cx.notify();
  }

  /** Highlights match `i` (the pointer is over it). */
  private highlight(i: number): void {
    if (this.at === i) return;
    this.at = i;
    this.rows.scrollToRow(i);
    this.cx.notify();
  }

  /** Narrows to `entry`'s directory, with the `/` that makes the query match whole paths. */
  private descend(entry: Entry): void {
    this.refilter(`${entry.rel}/`);
  }

  /** Types `text` into the terminal and closes. */
  private insert(text: string): void {
    this.done = true;
    type(this.term, this.quoting ? quote(text) : text);
    void this.cx.pane.close();
  }

  /** Closes without picking; a bare trigger key is typed back so what was typed still lands. */
  private dismiss(): void {
    this.done = true;
    if (this.query === "" && this.cancel !== null) type(this.term, this.cancel);
    void this.cx.pane.close();
  }

  /** A key pressed while the field has it: the picker's own; whether it took it. */
  private key(typed: string): boolean {
    const empty = this.query === "";
    switch (typed) {
      case "escape":
        this.dismiss();
        return true;
      case "enter": {
        const entry = this.selected();
        if (entry) this.insert(entry.dir ? `${entry.rel}/` : entry.rel);
        return true;
      }
      case "tab": {
        const entry = this.selected();
        if (entry?.dir) this.descend(entry);
        return true;
      }
      case "backspace":
        if (!empty) return false;
        this.dismiss();
        return true;
      case "up":
      case "ctrl+p":
      case "ctrl+k":
        this.step(-1);
        return true;
      case "down":
      case "ctrl+n":
      case "ctrl+j":
        this.step(1);
        return true;
      case "pageup":
        this.step(-8);
        return true;
      case "pagedown":
        this.step(8);
        return true;
      default:
        return false;
    }
  }
}

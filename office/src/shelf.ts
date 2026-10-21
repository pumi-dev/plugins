// The bookshelf: the plugins' pages, open over the room when you click the shelf — a book for each
// page, and the page's sections with the views their plugins draw.
import { app, div, icon, native, text, type AppPage, type AppSection, type El, type ThemeContext } from "pumi";
import { activePage, iconButton, label, spacer } from "./parts.ts";
import type { OfficeState } from "./state.ts";

/** A page's section: its header (a press folds it), and its view. */
function section(sec: AppSection, stacked: boolean, first: boolean, open: boolean): El {
  return div()
    .key(sec.key)
    .class("section")
    .when(open, (e) => e.class("open"))
    .when(open && stacked, (e) => e.flexGrow(typeof sec.size === "number" ? sec.size : 1))
    .when(stacked, (e) =>
      e.child(
        div()
          .class("section-header")
          .onClick(() => {
            if (!first) app.toggleSection(sec.key);
            return true;
          })
          .when(!first, (head) => head.child(icon(open ? "chevron_down" : "chevron_right").class("chevron")))
          .child(label("section-label", sec.label)),
      ),
    )
    .when(open, (e) => e.child(native(sec.view).class("section-body")));
}

/** A page's sections, stacked when there are several; or a note that there is none. */
function pageBody(page: AppPage | undefined): El {
  if (!page) return div().class("page-empty").child(text("No plugins running. Turn one on in Settings."));
  const stacked = page.sections.length > 1;
  return div()
    .key(page.id)
    .class("page")
    .children(page.sections.map((sec, i) => section(sec, stacked, i === 0, !stacked || i === 0 || !sec.collapsed)));
}

/** The bookshelf: its books (a page each), and the page whose book is chosen. */
export function shelf(cx: ThemeContext<OfficeState>): El {
  const st = cx.state;
  const page = activePage(cx.app.pages, st.page);
  return div()
    .id("shelf")
    .onClick(() => true)
    .child(
      div()
        .class("shelf-head")
        .child(label("shelf-title", "Bookshelf"))
        .child(spacer())
        .child(
          iconButton("close", "Close", () => {
            st.shelf = false;
          }),
        ),
    )
    .child(
      div()
        .class("shelf-books")
        .children(
          cx.app.pages.map((pg) =>
            div()
              .key(pg.id)
              .class("book")
              .when(page !== undefined && pg.id === page.id, (e) => e.class("active"))
              .onClick(() => {
                st.page = pg.id;
                return true;
              })
              .child(icon(pg.icon ?? "package"))
              .child(text(pg.label)),
          ),
        ),
    )
    .child(div().class("shelf-body").child(pageBody(page)));
}

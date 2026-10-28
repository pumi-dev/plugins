// What an agent's tools do inside a page: plain JavaScript, run in the page's own world by the
// window's webview (`webviewRun`), so it reaches any site's DOM. It installs itself once per
// document as `window.__pumiKit` and each call is one of its methods with one JSON argument:
//
//   snapshot  the page as lines an agent reads: headings, text, and each control with a ref (`e12`)
//   text      the visible text, of the page or of one element
//   html      the HTML, of the page or of one element
//   find      one element, described: its ref, a CSS selector, its box, its HTML, its source
//   click, hover, fill, type, press, scroll, wait   what a person does, by ref, selector or text
//   console   the page's last console lines and errors (the app's page script keeps them)
//   pick      the element the user clicks, as `find` describes it; `cancelPick` stops it
//   mark      outlines over elements (the ones a note is about)
//
// A target is a ref (`"e12"`, from `snapshot`), a CSS selector, or `{text}` / `{role, name}`.
// It is a string, not a function `String()`ed, so no transpiler and no DOM types are involved.

/** Which version of the kit a document has: a page that kept an older one installs this one. */
export const KIT_VERSION = 1;

export const KIT = String.raw`(() => {
  if (window.__pumiKit && window.__pumiKit.v === ${KIT_VERSION}) return;
  if (window.__pumiKit && window.__pumiKit.cancelPick) window.__pumiKit.cancelPick();
  const refs = new Map();
  const ids = new WeakMap();
  let next = 1;
  const refOf = (el) => {
    let r = ids.get(el);
    if (!r) { r = "e" + next++; ids.set(el, r); refs.set(r, new WeakRef(el)); }
    return r;
  };
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + "\u2026" : s);
  const squash = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const quote = (s) => JSON.stringify(s);
  const style = (el) => getComputedStyle(el);
  const visible = (el) => {
    if (!el.isConnected) return false;
    if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true });
    const st = style(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || st.display === "contents";
  };
  const INPUTS = { button: "button", submit: "button", reset: "button", image: "button", file: "button", color: "button",
    checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox", number: "spinbutton" };
  const GROUPS = { NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    FORM: "form", DIALOG: "dialog", TABLE: "table", UL: "list", OL: "list", MENU: "list", FIELDSET: "group" };
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const tag = el.tagName;
    if (tag === "A" || tag === "AREA") return el.hasAttribute("href") ? "link" : null;
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return type === "hidden" ? null : INPUTS[type] || "textbox";
    }
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SELECT") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "OPTION") return "option";
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "IMG") return el.getAttribute("alt") ? "img" : null;
    if (tag === "IFRAME") return "iframe";
    if (tag === "VIDEO" || tag === "AUDIO") return tag.toLowerCase();
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return "textbox";
    return GROUPS[tag] || null;
  };
  const ACTS = new Set(["link", "button", "checkbox", "radio", "slider", "searchbox", "textbox", "spinbutton",
    "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "treeitem"]);
  const FIELDS = new Set(["textbox", "searchbox", "spinbutton", "combobox", "listbox", "slider", "checkbox", "radio", "switch"]);
  const acts = (el, role) => {
    if (ACTS.has(role)) return true;
    if (el.hasAttribute("onclick") || (el.hasAttribute("tabindex") && el.tabIndex >= 0)) return true;
    return style(el).cursor === "pointer" && !(el.parentElement && style(el.parentElement).cursor === "pointer");
  };
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && squash(aria)) return squash(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const said = squash(by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.innerText || e.textContent).join(" "));
      if (said) return said;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const labels = el.labels ? squash(Array.from(el.labels).map((l) => l.innerText).join(" ")) : "";
      if (labels) return labels;
      if (tag === "INPUT" && /^(button|submit|reset)$/i.test(el.type)) return squash(el.value);
      return squash(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
    }
    if (tag === "IMG") return squash(el.getAttribute("alt") || el.getAttribute("title") || "");
    const text = squash(el.innerText || el.textContent || "");
    if (text) return text;
    const inner = el.querySelector("img[alt], [aria-label], [title]");
    if (inner) return squash(inner.getAttribute("alt") || inner.getAttribute("aria-label") || inner.getAttribute("title"));
    return squash(el.getAttribute("title") || "");
  };
  // Ids and classes a build made up (css-modules, styled-components, React's useId) say nothing
  // that lasts; a selector is better without them.
  const made = (s) => /\d{4,}|[0-9a-f]{6,}|^[:_-]|:|__[0-9a-z]{4,}|^css-|^sc-|^jsx-/i.test(s);
  const unique = (sel, el) => {
    try { const all = document.querySelectorAll(sel); return all.length === 1 && all[0] === el; } catch { return false; }
  };
  const selectorOf = (el) => {
    if (el.id && !made(el.id) && unique("#" + CSS.escape(el.id), el)) return "#" + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    for (const a of ["data-testid", "data-test", "data-cy", "data-qa", "name", "aria-label"]) {
      const v = el.getAttribute(a);
      if (v && v.length < 80 && unique(tag + "[" + a + "=" + quote(v) + "]", el)) return tag + "[" + a + "=" + quote(v) + "]";
    }
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      let part;
      if (cur.id && !made(cur.id)) part = "#" + CSS.escape(cur.id);
      else {
        part = cur.tagName.toLowerCase();
        const classes = Array.from(cur.classList).filter((c) => !made(c) && c.length < 40).slice(0, 2);
        part += classes.map((c) => "." + CSS.escape(c)).join("");
        // Its place among its kind only where its tag and classes do not single it out.
        const plain = [part].concat(parts).join(" > ");
        if (cur === el && unique(plain, el)) return plain;
        const parent = cur.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(cur) + 1) + ")";
        }
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      if (unique(sel, el)) return sel;
    }
    return parts.join(" > ");
  };
  // Where the element comes from in the site's source, as a framework's development build says.
  const sourceOf = (el) => {
    const out = {};
    for (let e = el; e && !out.file; e = e.parentElement) {
      const m = e.__svelte_meta;
      if (m && m.loc) Object.assign(out, { file: m.loc.file, line: m.loc.line, column: m.loc.column });
    }
    let vue = null;
    for (let e = el; e && !vue; e = e.parentElement) vue = e.__vueParentComponent || null;
    const names = [];
    for (let c = vue; c && names.length < 8; c = c.parent) {
      const t = c.type || {};
      const n = t.name || t.__name || (t.__file ? t.__file.split("/").pop() : null);
      if (n && !names.includes(n)) names.push(n);
      if (!out.file && t.__file) out.file = t.__file;
    }
    let key = null;
    for (let e = el; e && !key; e = e.parentElement) {
      const k = Object.keys(e).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (k) key = [e, k];
    }
    for (let f = key ? key[0][key[1]] : null; f && names.length < 8; f = f.return) {
      const t = f.type;
      if (t && typeof t !== "string") {
        const n = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name));
        if (n && !names.includes(n)) names.push(n);
      }
      const s = f._debugSource;
      if (!out.file && s) Object.assign(out, { file: s.fileName, line: s.lineNumber, column: s.columnNumber });
    }
    if (names.length) out.components = names;
    for (let e = el; e && !out.file; e = e.parentElement) {
      for (const a of ["data-source", "data-source-file", "data-inspector-relative-path", "data-locator"]) {
        const v = e.getAttribute && e.getAttribute(a);
        if (!v) continue;
        out.file = v;
        const line = e.getAttribute("data-inspector-line") || e.getAttribute("data-source-line");
        if (line) out.line = Number(line);
        break;
      }
    }
    return Object.keys(out).length ? out : undefined;
  };
  const brief = (el) => {
    const role = roleOf(el);
    const name = clip(nameOf(el), 80);
    return (role || el.tagName.toLowerCase()) + (name ? " " + quote(name) : "") + " [" + refOf(el) + "]";
  };
  const ATTRS = ["id", "class", "href", "src", "alt", "type", "name", "value", "placeholder", "title", "role",
    "aria-label", "data-testid", "for", "action", "method"];
  const describe = (el, deep) => {
    const r = el.getBoundingClientRect();
    const out = {
      ref: refOf(el), selector: selectorOf(el), tag: el.tagName.toLowerCase(), role: roleOf(el) || undefined,
      name: clip(nameOf(el), 200) || undefined,
      box: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
    };
    const attrs = {};
    for (const a of ATTRS) {
      const v = a === "value" && "value" in el && el.type !== "password" ? el.value : el.getAttribute(a);
      if (v != null && v !== "" && !(a === "value" && el.type === "password")) attrs[a] = clip(String(v), 300);
    }
    if (Object.keys(attrs).length) out.attributes = attrs;
    if (!deep) return out;
    out.text = clip(squash(el.innerText || el.textContent || ""), 600) || undefined;
    out.html = clip(el.outerHTML, 2000);
    const path = [];
    for (let e = el.parentElement; e && e !== document.body && path.length < 6; e = e.parentElement) {
      path.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + Array.from(e.classList).slice(0, 2).map((c) => "." + c).join(""));
    }
    if (path.length) out.ancestors = path.join(" > ");
    const st = style(el);
    out.style = { display: st.display, color: st.color, background: st.backgroundColor, font: st.fontWeight + " " + st.fontSize + " " + st.fontFamily.split(",")[0],
      margin: st.margin, padding: st.padding };
    const source = sourceOf(el);
    if (source) out.source = source;
    return out;
  };
  const everything = () => Array.from(document.querySelectorAll("body *"));
  const find = (t) => {
    if (t == null || t === "") throw new Error("say which element: a ref (e12) from snapshot, a CSS selector, or {text}");
    if (typeof t === "string") t = /^e\d+$/.test(t) ? { ref: t } : { selector: t };
    let found = [];
    if (t.ref) {
      const w = refs.get(t.ref);
      const el = w && w.deref();
      if (!el || !el.isConnected) throw new Error("no element " + t.ref + " on the page now: take a snapshot again");
      return el;
    } else if (t.selector) {
      found = Array.from(document.querySelectorAll(t.selector));
    } else if (t.text != null || t.role || t.name != null) {
      const want = t.text != null ? squash(t.text).toLowerCase() : t.name != null ? squash(t.name).toLowerCase() : null;
      found = everything().filter((el) => {
        if (t.role && roleOf(el) !== t.role) return false;
        if (want == null) return true;
        const has = (t.text != null ? squash(el.innerText || "") : nameOf(el)).toLowerCase();
        return has.includes(want);
      });
      // The deepest of them, a control before anything else, an exact match before a partial one.
      found = found.filter((el) => !found.some((o) => o !== el && el.contains(o) && !acts(el, roleOf(el))));
      found.sort((a, b) => {
        const exact = (el) => (squash(t.text != null ? el.innerText : nameOf(el)).toLowerCase() === want ? 0 : 1);
        return exact(a) - exact(b) || Number(!acts(a, roleOf(a))) - Number(!acts(b, roleOf(b))) || 0;
      });
    } else throw new Error("a target is a ref, a selector, {text}, or {role, name}");
    const shown = found.filter(visible);
    const pool = shown.length ? shown : found;
    const el = pool[Math.max(0, Math.min(Number(t.index) || 0, pool.length - 1))];
    if (!el) throw new Error("no element matches " + JSON.stringify(t));
    return el;
  };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "PUMI-PICK", "PUMI-MARKS"]);
  const merges = (el) => {
    if (el.nodeType !== 1 || SKIP.has(el.tagName) || roleOf(el) || acts(el, null)) return false;
    // A label around its field is the field's name, said on the field's line.
    if (el.tagName === "LABEL" && el.control && el.contains(el.control)) return false;
    return style(el).display.startsWith("inline");
  };
  const ownText = (el) => {
    let out = "";
    for (const c of el.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1 && c.tagName === "BR") out += " ";
      else if (c.nodeType === 1 && merges(c) && visible(c)) out += ownText(c);
    }
    return squash(out);
  };
  const lineOf = (el, role) => {
    let s = (role || "clickable") + " " + quote(clip(nameOf(el), 120)) + " [" + refOf(el) + "]";
    if (role === "link") {
      const h = el.getAttribute("href");
      if (h && !/^javascript:/i.test(h)) s += " -> " + clip(h, 160);
    }
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) s += el.checked ? " checked" : " unchecked";
    else if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.type !== "password" && el.value) s += " value=" + quote(clip(el.value, 120));
    else if (el.tagName === "SELECT" && el.selectedOptions[0]) s += " value=" + quote(clip(squash(el.selectedOptions[0].text), 80));
    else if (el.isContentEditable && role === "textbox") s += " value=" + quote(clip(squash(el.innerText), 120));
    if (el.disabled || el.getAttribute("aria-disabled") === "true") s += " disabled";
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) s += " expanded=" + expanded;
    if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")) s += " current";
    if (document.activeElement === el) s += " focused";
    return s;
  };
  const snapshot = (a) => {
    a = a || {};
    const root = a.target != null ? find(a.target) : document.body;
    const max = Math.min(Math.max(Number(a.max) || 30000, 1000), 300000);
    const lines = [];
    let size = 0;
    let cut = false;
    const push = (depth, s) => {
      if (cut) return;
      const line = "  ".repeat(depth) + s;
      size += line.length + 1;
      if (size > max) { cut = true; return; }
      lines.push(line);
    };
    const kids = (el) => (el.shadowRoot ? Array.from(el.shadowRoot.children).concat(Array.from(el.children)) : Array.from(el.children));
    const walk = (el, depth, merged) => {
      if (cut || SKIP.has(el.tagName) || el.getAttribute("aria-hidden") === "true" || !visible(el)) return;
      const role = roleOf(el);
      if (role === "heading") {
        const level = /^H[1-6]$/.test(el.tagName) ? el.tagName.slice(1) : el.getAttribute("aria-level") || "";
        return push(depth, "heading" + level + " " + quote(clip(nameOf(el), 200)) + (acts(el, null) ? " [" + refOf(el) + "]" : ""));
      }
      if (role === "img") return push(depth, "img " + quote(clip(nameOf(el), 120)));
      if (role === "iframe") return push(depth, "iframe " + quote(el.getAttribute("title") || el.getAttribute("src") || "") + " [" + refOf(el) + "] (its document is its own)");
      if (role === "option" && el.tagName === "OPTION") return;
      if (acts(el, role)) {
        push(depth, lineOf(el, role));
        // A control is its name; a big clickable box (a card) has more in it worth reading.
        if (FIELDS.has(role) || role === "link" || role === "button" || squash(el.innerText || "").length <= 100) return;
        for (const c of kids(el)) walk(c, depth + 1, false);
        return;
      }
      let inner = depth;
      if (role && GROUPS[el.tagName] === role || ["navigation", "main", "banner", "contentinfo", "complementary", "form", "dialog", "list", "table", "group", "region", "menu", "menubar", "tablist", "toolbar", "alert", "status"].includes(role)) {
        const label = el.getAttribute("aria-label") || (role === "form" || role === "dialog" ? el.getAttribute("name") || el.getAttribute("title") : "");
        push(depth, role + (label ? " " + quote(clip(squash(label), 80)) : "") + ":");
        inner = depth + 1;
      }
      if (!merged && !(el.tagName === "LABEL" && el.control && el.contains(el.control))) {
        const own = ownText(el);
        if (own) push(inner, (role === "listitem" || el.tagName === "LI" ? "- " : "") + clip(own, 400));
      }
      for (const c of kids(el)) walk(c, inner, merges(c));
    };
    walk(root, 0, false);
    const doc = document.documentElement;
    const head = [
      "url: " + location.href,
      "title: " + document.title,
      "viewport: " + innerWidth + "x" + innerHeight + ", scrolled " + Math.round(scrollX) + "," + Math.round(scrollY) + " of " + doc.scrollWidth + "x" + doc.scrollHeight,
      "",
    ];
    return head.concat(lines).join("\n") + (cut ? "\n\u2026 (cut at " + max + " characters: pass max, or a target to read one part)" : "");
  };
  const text = (a) => {
    a = a || {};
    const el = a.target != null ? find(a.target) : document.body;
    const max = Math.min(Math.max(Number(a.max) || 30000, 100), 500000);
    const all = String(el.innerText || el.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return clip(all, max);
  };
  const html = (a) => {
    a = a || {};
    const el = a.target != null ? find(a.target) : document.documentElement;
    const max = Math.min(Math.max(Number(a.max) || 30000, 100), 1000000);
    return clip(el.outerHTML, max);
  };
  const center = (el) => {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const mouse = (el, types, extra) => {
    const at = center(el);
    const hit = document.elementFromPoint(at.x, at.y);
    const target = hit && (hit === el || el.contains(hit)) ? hit : el;
    const opts = Object.assign({ bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, view: window, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }, extra || {});
    for (const type of types) {
      const Kind = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      if (type === "focus") {
        const f = target.closest("a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]");
        if (f && document.activeElement !== f) f.focus({ preventScroll: true });
        continue;
      }
      const o = Object.assign({}, opts, { buttons: type.endsWith("down") ? 1 : 0 });
      target.dispatchEvent(new Kind(type, o));
    }
    return hit && hit !== el && !el.contains(hit) && !hit.contains(el) ? brief(hit) : null;
  };
  const click = (a) => {
    a = a || {};
    const el = find(a.target);
    const button = a.button === "right" ? 2 : a.button === "middle" ? 1 : 0;
    const types = button === 2 ? ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu"]
      : ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"];
    if (a.double) types.push("pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick");
    const covered = mouse(el, types, { button, detail: a.double ? 2 : 1 });
    return { clicked: brief(el), covered: covered ? "something else was over its middle: " + covered : undefined };
  };
  const hover = (a) => {
    const el = find((a || {}).target);
    mouse(el, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]);
    return { hovered: brief(el) };
  };
  const native = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  };
  const fire = (el, ...types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, composed: true })));
  const fill = (a) => {
    a = a || {};
    const el = find(a.target);
    const v = a.value == null ? "" : String(a.value);
    el.scrollIntoView({ block: "center", behavior: "instant" });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options);
      const opt = opts.find((o) => o.value === v) || opts.find((o) => squash(o.text).toLowerCase() === v.toLowerCase()) || opts.find((o) => squash(o.text).toLowerCase().includes(v.toLowerCase()));
      if (!opt) throw new Error(brief(el) + " has no option " + quote(v) + ": " + opts.map((o) => quote(squash(o.text))).join(", "));
      native(el, opt.value);
      fire(el, "input", "change");
      return { filled: brief(el), value: squash(opt.text) };
    }
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const want = !/^(false|0|off|no|unchecked)?$/i.test(v);
      if (el.checked !== want) el.click();
      return { filled: brief(el), checked: el.checked };
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      native(el, v);
      fire(el, "input", "change");
      return { filled: brief(el), value: el.type === "password" ? undefined : el.value };
    }
    if (el.isContentEditable) {
      document.execCommand("selectAll");
      document.execCommand("insertText", false, v);
      return { filled: brief(el) };
    }
    throw new Error(brief(el) + " takes no text: fill a field (a textbox, a select, a checkbox)");
  };
  const type = (a) => {
    a = a || {};
    const el = a.target != null ? find(a.target) : document.activeElement;
    if (!el || el === document.body) throw new Error("nothing has the keyboard: give a target");
    if (a.target != null && typeof el.focus === "function") el.focus({ preventScroll: true });
    const text = String(a.text == null ? "" : a.text);
    if (!document.execCommand("insertText", false, text) && "value" in el) {
      native(el, el.value + text);
      fire(el, "input");
    }
    return { typed: brief(el) };
  };
  const KEYS = { enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: " ", backspace: "Backspace",
    delete: "Delete", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End",
    pageup: "PageUp", pagedown: "PageDown" };
  const focusable = () => Array.from(document.querySelectorAll("a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]"))
    .filter((e) => !e.disabled && e.tabIndex >= 0 && visible(e));
  const press = (a) => {
    a = typeof a === "string" ? { key: a } : a || {};
    const parts = String(a.key || "").split("+");
    const named = parts.pop() || "";
    const key = KEYS[named.toLowerCase()] || named;
    if (!key) throw new Error("press takes a key: Enter, Escape, Tab, ArrowDown, a, cmd+a, …");
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    const el = a.target != null ? find(a.target) : document.activeElement || document.body;
    if (a.target != null && typeof el.focus === "function") el.focus({ preventScroll: true });
    const code = key.length === 1 ? (/[a-z]/i.test(key) ? "Key" + key.toUpperCase() : /\d/.test(key) ? "Digit" + key : "") : key;
    const opts = { key, code, bubbles: true, cancelable: true, composed: true, ctrlKey: mods.has("ctrl"), altKey: mods.has("alt") || mods.has("option"),
      shiftKey: mods.has("shift"), metaKey: mods.has("cmd") || mods.has("meta") };
    const taken = !el.dispatchEvent(new KeyboardEvent("keydown", opts));
    if (key.length === 1 && !taken) el.dispatchEvent(new KeyboardEvent("keypress", opts));
    // What the browser itself would do with the key, as a synthetic one does nothing.
    let did;
    if (!taken) {
      if (key === "Enter" && el.form && el.tagName === "INPUT") { el.form.requestSubmit(); did = "submitted the form"; }
      else if (key === "Enter" && /^(A|BUTTON|SUMMARY)$/.test(el.tagName)) { el.click(); did = "clicked it"; }
      else if (key === " " && /^(BUTTON|SUMMARY)$/.test(el.tagName)) { el.click(); did = "clicked it"; }
      else if (key === "Tab") {
        const all = focusable();
        const at = all.indexOf(el);
        const to = all[(at + (opts.shiftKey ? -1 : 1) + all.length) % all.length];
        if (to) { to.focus(); did = "focused " + brief(to); }
      } else if (key.length === 1 && !opts.ctrlKey && !opts.metaKey && (el.isContentEditable || "value" in el)) {
        document.execCommand("insertText", false, key);
        did = "typed it";
      }
    }
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    return { pressed: (parts.length ? parts.join("+") + "+" : "") + key, on: brief(el), prevented: taken || undefined, did };
  };
  const scroll = (a) => {
    a = a || {};
    if (a.target != null && a.x == null && a.y == null && !a.to) {
      const el = find(a.target);
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return { scrolledTo: brief(el), x: Math.round(scrollX), y: Math.round(scrollY) };
    }
    const el = a.target != null ? find(a.target) : null;
    const box = el || document.scrollingElement || document.documentElement;
    if (a.to === "top") box.scrollTo({ top: 0, behavior: "instant" });
    else if (a.to === "bottom") box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
    else box.scrollBy({ left: Number(a.x) || 0, top: a.y == null ? innerHeight * 0.8 : Number(a.y) || 0, behavior: "instant" });
    return { x: Math.round(box.scrollLeft), y: Math.round(box.scrollTop), height: box.scrollHeight, viewport: el ? el.clientHeight : innerHeight };
  };
  const wait = (a) => {
    a = a || {};
    const ms = Math.min(Math.max(Number(a.timeout) || 10000, 50), 60000);
    const t = a.target != null ? a.target : a.text != null ? { text: a.text } : a.selector != null ? { selector: a.selector } : null;
    if (!t) throw new Error("wait takes a target (a selector, {text}), with gone: true to wait for it to go; or url or load");
    const check = () => {
      let el = null;
      try { el = find(t); } catch { el = null; }
      const there = !!el && visible(el);
      return a.gone ? !there : there ? el : false;
    };
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const got = check();
        if (got) return resolve(a.gone ? { gone: true } : { found: brief(got) });
        if (Date.now() - start > ms) return reject(new Error((a.gone ? "still there after " : "not there after ") + ms + " ms: " + JSON.stringify(t)));
        setTimeout(tick, 100);
      };
      tick();
    });
  };
  let seen = 0;
  const consoled = (a) => {
    a = a || {};
    const all = (window.__pumiConsole ? window.__pumiConsole() : []).filter((e) => e.at > (a.all ? 0 : seen));
    const levels = a.level ? String(a.level).split(",") : null;
    const picked = all.filter((e) => !levels || levels.includes(e.level));
    const last = picked.slice(-Math.min(Math.max(Number(a.last) || 100, 1), 300));
    if (a.clear) seen = Date.now();
    if (!last.length) return "(nothing logged" + (seen && !a.all ? " since it was cleared" : "") + ")";
    return last.map((e) => "[" + e.level + "] " + new Date(e.at).toISOString().slice(11, 23) + " " + e.text).join("\n");
  };
  // The picker: the element under the mouse is outlined; a click takes it, Escape gives up, and
  // the arrow keys climb to its parent and back.
  let picking = null;
  const pick = () => new Promise((resolve) => {
    if (picking) picking.finish(null);
    const host = document.createElement("pumi-pick");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<style>div{position:fixed;pointer-events:none;box-sizing:border-box}" +
      ".box{border:2px solid #3b82f6;background:rgba(59,130,246,.14);border-radius:3px}" +
      ".tag{font:500 11px/1.5 -apple-system,system-ui,sans-serif;color:#fff;background:#1d4ed8;padding:1px 7px;border-radius:5px;white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
      ".hint{right:12px;bottom:12px;font:500 12px/1.5 -apple-system,system-ui,sans-serif;color:#fff;background:rgba(17,24,39,.88);padding:5px 10px;border-radius:7px}</style>" +
      "<div class=box></div><div class=tag></div><div class=hint>Click an element to note it \u00b7 \u2191 parent \u00b7 Esc to stop</div>";
    const box = root.querySelector(".box");
    const tag = root.querySelector(".tag");
    const cursor = document.createElement("style");
    cursor.textContent = "*{cursor:crosshair!important}";
    document.documentElement.append(host, cursor);
    let current = null;
    const down = [];
    const label = (el) => {
      const r = el.getBoundingClientRect();
      const src = sourceOf(el);
      const comp = src && src.components ? src.components[0] + " \u00b7 " : "";
      return comp + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + Array.from(el.classList).slice(0, 3).map((c) => "." + c).join("") + "  " + Math.round(r.width) + "\u00d7" + Math.round(r.height);
    };
    const show = (el) => {
      current = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      tag.textContent = label(el);
      const above = r.top > 24;
      Object.assign(tag.style, { left: Math.max(4, Math.min(r.left, innerWidth - 120)) + "px", top: (above ? r.top - 22 : Math.min(r.bottom + 4, innerHeight - 22)) + "px" });
    };
    const under = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el && el !== host && el !== document.documentElement ? el : null;
    };
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const move = (e) => { const el = under(e); if (el && el !== current && !down.length) show(el); };
    const take = (e) => { stop(e); finish(current || under(e)); };
    const key = (e) => {
      if (e.key === "Escape") { stop(e); finish(null); }
      else if (e.key === "Enter" && current) { stop(e); finish(current); }
      else if (e.key === "ArrowUp" && current && current.parentElement && current.parentElement !== document.documentElement) { stop(e); down.push(current); show(current.parentElement); }
      else if (e.key === "ArrowDown" && down.length) { stop(e); show(down.pop()); }
    };
    const again = () => current && show(current);
    const on = [["pointermove", move], ["mousemove", move], ["pointerdown", stop], ["mousedown", stop], ["pointerup", stop],
      ["mouseup", stop], ["click", take], ["dblclick", stop], ["contextmenu", stop], ["keydown", key], ["scroll", again]];
    for (const [t, f] of on) addEventListener(t, f, true);
    const finish = (el) => {
      for (const [t, f] of on) removeEventListener(t, f, true);
      host.remove();
      cursor.remove();
      picking = null;
      resolve(el ? describe(el, true) : null);
    };
    picking = { finish };
  });
  const cancelPick = () => { if (picking) picking.finish(null); return true; };
  // Outlines over the elements notes are about, numbered, following them as the page moves.
  let marks = null;
  const mark = (a) => {
    const items = (a && a.items) || [];
    if (marks) { cancelAnimationFrame(marks.frame); marks.host.remove(); marks = null; }
    if (!items.length) return 0;
    const host = document.createElement("pumi-marks");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<style>div{position:fixed;pointer-events:none;box-sizing:border-box}" +
      ".m{border:2px dashed #f59e0b;border-radius:3px;background:rgba(245,158,11,.08)}" +
      ".n{font:600 10px/16px -apple-system,system-ui,sans-serif;color:#111;background:#f59e0b;min-width:16px;height:16px;text-align:center;border-radius:8px;padding:0 4px}</style>";
    const shown = [];
    for (const item of items) {
      let el = null;
      const w = item.ref && refs.get(item.ref);
      el = w && w.deref();
      if (!el || !el.isConnected) { try { el = item.selector ? document.querySelector(item.selector) : null; } catch { el = null; } }
      if (!el) continue;
      const m = document.createElement("div");
      m.className = "m";
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = String(item.label || shown.length + 1);
      root.append(m, n);
      shown.push({ el, m, n });
    }
    document.documentElement.append(host);
    const place = () => {
      for (const s of shown) {
        const r = s.el.getBoundingClientRect();
        Object.assign(s.m.style, { left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px", display: s.el.isConnected ? "block" : "none" });
        Object.assign(s.n.style, { left: r.left - 8 + "px", top: r.top - 8 + "px", display: s.el.isConnected ? "block" : "none" });
      }
      marks.frame = requestAnimationFrame(place);
    };
    marks = { host, frame: 0 };
    place();
    return shown.length;
  };
  window.__pumiKit = {
    v: ${KIT_VERSION},
    snapshot, text, html, click, hover, fill, type, press, scroll, wait, pick, cancelPick, mark,
    console: consoled,
    find: (a) => describe(find(a && a.target != null ? a.target : a), true),
  };
})();`;

/** The body `webviewRun` runs for the kit's `method`: it installs the kit if the page has none yet. */
export function kitCall(method: string, args: unknown): string {
  return `${KIT}\nreturn window.__pumiKit[${JSON.stringify(method)}](${JSON.stringify(args ?? null)});`;
}

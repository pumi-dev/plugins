# win98

Windows 98 as a pumi UI theme.

- **The desktop** is teal, with My Computer (a new session), MS-DOS Prompt (a new view), Network Neighborhood (the remote servers), Internet Explorer (when a browser plugin is installed) and the Recycle Bin (the last closed thing, opened again) down its left. Double-click one to open it. Dragging the empty desktop, or the empty taskbar, moves pumi's window.
- **Each view is a window**: drag its caption to move it, its corner grip to size it, double-click the caption to maximize it, and use its own minimize, maximize and close buttons. Its icon, or a right click on its caption, opens the view's menu. Each window has a menu bar (File, Edit is the front tab's menu, View, Window, Help) and a status bar.
- **Panes are child windows** with small captions (`toggle_pane_titles` hides them), set apart by raised splitter bars; a pane of several tabs shows them as a strip in its caption. Drag a caption onto another pane to split it there.
- **The Explorer bar** (`toggle_sidebar`, ⌘B) is the folders tree: every session, its views and their tabs, plus the panels that plugins contribute.
- **The taskbar** has the Start button, a quick launch, a button for each window (click the active one to minimize it; right-click for the view's menu), and the tray with a light for each agent and the clock.
- **The Start menu** has Programs (your sessions and their views), Documents (the views in the session's worktrees), Settings, Find, Help, Run… (a command in a new view), Close Window… and Shut Down….
- **Menus and questions** across the app use the system's grey menus and message boxes.

```sh
pumi plugin add ./win98
pumi option set ui_theme win98
```

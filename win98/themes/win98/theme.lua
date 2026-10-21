-- extends: default
-- name: Windows 98
-- description: A teal desktop, a window for each tab, and a Start menu of your plugins.
-- Windows 98, as a pumi UI theme. Each tab is a window on a teal desktop, the dock's pages
-- open as Explorer windows, and the Start menu lists the plugins, packages, sessions and
-- themes. It extends `default` for its panes, splits and dividers (`C.Panes`), its sections and
-- its menus' buttons, and draws everything else itself, with its own rules only.

local box, text, img, native, input, map, cls = ui.box, ui.text, ui.img, ui.native, ui.input, ui.map, ui.cls
local C = components

-- Windows' places and sizes, the menus and dialogs: the theme's own, kept across reloads.
state.w98 = state.w98 or { win = {}, order = {}, open = {}, menu = false, path = {}, bar = nil, dialog = nil }
local S = state.w98

local DESK_TASKBAR = 28

local function image(name, class) return img { class = cls('px', class), src = 'images/' .. name .. '.svg' } end

local function close_menus() S.menu, S.path, S.bar = false, {}, nil end

-- -- windows' places -------------------------------------------------------------------------

local function raise(key)
  for i, k in ipairs(S.order) do if k == key then table.remove(S.order, i); break end end
  S.order[#S.order + 1] = key
end

local function place(key, n, desk)
  local s = S.win[key]
  if not s then
    local w, h = math.min(720, desk.w - 160), math.min(460, desk.h - 140)
    s = { x = 96 + 28 * (n % 8), y = 24 + 26 * (n % 8), w = w, h = h }
    S.win[key] = s
  end
  return s
end

-- A Win98 push button: two bevels around what it holds.
function C.W98Button(t)
  return box { id = t.id, key = t.key, class = cls('btn', t.class, t.pressed and 'pressed', t.disabled and 'disabled'),
    of = t.of, title = t.title,
    onclick = function(ev) if not t.disabled and t.onclick then t.onclick(ev) end; return true end,
    box { class = 'btn-in', t[1], t[2], t[3] } }
end

local function caption_button(label, title, onclick)
  return C.W98Button { class = 'capbtn', title = title, onclick = onclick, text { class = 'capbtn-label', label } }
end

-- -- menus -----------------------------------------------------------------------------------

-- A menu: a raised box of items, each `{ icon = 'name', label = '…', run = function, items = {…},
-- checked = bool, disabled = bool }`, or `'-'` for a separator. `depth` is how deep it is.
function C.W98Menu(items, depth, class)
  depth = depth or 1
  return box { class = cls('raised', 'menu', class), onclick = function() return true end,
    box { class = 'raised-in menu-in',
      map(items, function(item, i)
        if item == '-' then return box { key = 'sep' .. i, class = 'menu-sep' } end
        local open = S.path[depth] == i
        return box {
          key = (item.label or '') .. i,
          class = cls('menu-item', open and 'open', item.disabled and 'disabled'),
          onenter = function()
            for d = depth, #S.path do S.path[d] = nil end
            if item.items then S.path[depth] = i end
          end,
          onclick = function()
            if item.disabled then return true end
            if item.items then S.path[depth] = i; return true end
            close_menus()
            if item.run then item.run() end
            return true
          end,
          box { class = 'menu-check', item.checked and text { '✓' } or nil },
          item.icon and image(item.icon, 'menu-icon') or box { class = 'menu-icon' },
          text { class = 'menu-label', item.label },
          item.items and text { class = 'menu-arrow', '▶' } or nil,
          open and C.W98Menu(item.items, depth + 1, 'submenu') or nil,
        }
      end),
    },
  }
end

-- -- what the Start menu lists ---------------------------------------------------------------

local function page_of(app, plugin)
  for _, p in ipairs(app.pages) do
    if p.id == plugin.name then return p end
    for _, s in ipairs(p.sections) do
      if s.key:match('^' .. plugin.name .. '/') then return p end
    end
  end
  return nil
end

local function open_page(page)
  S.open['page:' .. page.id] = true
  raise('page:' .. page.id)
end

local function plugins_menu(app)
  local items = {}
  for _, p in ipairs(app.plugins) do
    local page = page_of(app, p)
    items[#items + 1] = {
      icon = 'plugin', label = p.label or p.name, checked = p.running,
      disabled = not p.running,
      run = function() if page then open_page(page) else pumi.cmd('settings', 'plugins') end end,
    }
  end
  if #app.packages > 0 then
    items[#items + 1] = '-'
    for _, pkg in ipairs(app.packages) do
      local views = {}
      for _, v in ipairs(pkg.views or {}) do
        views[#views + 1] = { icon = 'dos', label = v.label, run = function() pumi.cmd('open_view', v.type, {}, { kind = 'tab' }) end }
      end
      items[#items + 1] = {
        icon = 'folder', label = pkg.label or pkg.name, checked = pkg.active,
        items = #views > 0 and views or nil,
        run = function() pumi.cmd('settings', 'packages') end,
      }
    end
  end
  items[#items + 1] = '-'
  items[#items + 1] = { icon = 'settings', label = 'Plugin Settings…', run = function() pumi.cmd('settings', 'plugins') end }
  return items
end

local function sessions_menu(app)
  local items = map(app.spaces, function(sp)
    return { icon = 'folder', label = sp.label, checked = sp.active, run = function() pumi.cmd('select_space', sp.id) end }
  end)
  items[#items + 1] = '-'
  items[#items + 1] = { icon = 'documents', label = 'New Session…', run = function() pumi.cmd('new_workspace') end }
  items[#items + 1] = { icon = 'find', label = 'Open Session…', run = function() pumi.cmd('projects') end }
  return items
end

local function themes_menu(app)
  return map(app.themes, function(name)
    return { label = name, checked = name == app.ui_theme, run = function() pumi.cmd('set_theme', name) end }
  end)
end

local function programs_menu(app)
  local items = {
    { icon = 'dos', label = 'MS-DOS Prompt', run = function() pumi.cmd('new_tab') end },
    { icon = 'globe', label = 'Internet Explorer', run = function() pumi.cmd('open_browser') end },
  }
  if #app.pages > 0 then items[#items + 1] = '-' end
  for _, p in ipairs(app.pages) do
    items[#items + 1] = { icon = 'folder', label = p.label, run = function() open_page(p) end }
  end
  return items
end

local function start_items(app)
  return {
    { icon = 'dos', label = 'Programs', items = programs_menu(app) },
    { icon = 'plugin', label = 'Plugins', items = plugins_menu(app) },
    { icon = 'documents', label = 'Sessions', items = sessions_menu(app) },
    { icon = 'settings', label = 'Settings', items = {
      { icon = 'settings', label = 'Control Panel', run = function() pumi.cmd('settings') end },
      { icon = 'computer', label = 'Themes', items = themes_menu(app) },
      { icon = 'dos', label = 'Keyboard', run = function() pumi.cmd('settings', 'keys') end },
    } },
    { icon = 'find', label = 'Find', run = function() pumi.cmd('palette::Toggle') end },
    { icon = 'help', label = 'Help', run = function() pumi.cmd('help') end },
    { icon = 'run', label = 'Run…', run = function() S.dialog = 'run' end },
    '-',
    { icon = 'shutdown', label = 'Shut Down…', run = function() S.dialog = 'shutdown' end },
  }
end

function C.StartMenu(app)
  return box { id = 'startmenu',
    box { class = 'raised', box { class = 'raised-in start-in',
      -- Read bottom to top: the line turned a quarter anticlockwise.
      box { class = 'banner', text { class = 'banner-thin', '98' }, text { class = 'banner-bold', 'Windows' } },
      C.W98Menu(start_items(app), 1, 'start-items'),
    } },
  }
end

-- -- windows ---------------------------------------------------------------------------------

-- A window: `key` (its place's), `title`, `icon`, `active`, `menus` (the menu bar: a list of
-- `{ label, items }`), `body`, and `onfocus`, `onclose`.
function C.W98Window(t, desk, n)
  local s = place(t.key, n, desk)
  if s.min then return nil end
  local geo = s.max and { left = 0, top = 0, width = desk.w, height = desk.h - DESK_TASKBAR }
                     or { left = s.x, top = s.y, width = s.w, height = s.h }
  local bar = S.bar and S.bar.win == t.key and S.bar.menu or nil
  return box { key = t.key, class = cls('window', 'raised', t.active and 'active'), of = t.of, style = geo,
    onmousedown = function() raise(t.key); if t.onfocus then t.onfocus() end end,
    box { class = 'raised-in window-in',
      box { class = 'caption',
        ondrag = function(ev) if not s.max then s.x, s.y = s.x + ev.dx, math.max(0, s.y + ev.dy) end; return true end,
        ondblclick = function() s.max = not s.max; return true end,
        t.icon and image(t.icon, 'caption-icon') or nil,
        text { class = 'caption-title', t.title },
        box { class = 'spacer' },
        caption_button('_', 'Minimize', function() s.min = true end),
        caption_button(s.max and '❐' or '□', s.max and 'Restore' or 'Maximize', function() s.max = not s.max end),
        box { class = 'capgap' },
        caption_button('✕', 'Close', function() if t.onclose then t.onclose() end end),
      },
      t.menus and box { class = 'menubar',
        map(t.menus, function(m, i)
          local open = bar == i
          return box { key = m.label, class = cls('menubar-item', open and 'open'),
            onclick = function() S.bar = (not open) and { win = t.key, menu = i } or nil; S.path = {}; S.menu = false; return true end,
            onenter = function() if S.bar and S.bar.win == t.key then S.bar.menu = i; S.path = {} end end,
            text { m.label },
            open and C.W98Menu(m.items, 1, 'dropdown') or nil,
          }
        end) } or nil,
      box { class = 'client sunken', box { class = 'sunken-in client-in', t.body } },
      t.status and box { class = 'window-status', box { class = 'sunken status-field', text { t.status } } } or nil,
    },
    not s.max and box { class = 'grip',
      ondrag = function(ev) s.w, s.h = math.max(220, s.w + ev.dx), math.max(140, s.h + ev.dy); return true end } or nil,
  }
end

-- One pane's strip only when a window holds several (the caption names a lone pane).
local DefaultStrip = C.PaneStrip
function C.PaneStrip(p, tab, app)
  if #tab.panes < 2 and #(p.strip or {}) == 0 then return nil end
  return DefaultStrip(p, tab, app)
end

local function tab_window(tab, app, desk, n)
  local focused
  for _, p in ipairs(tab.panes) do if p.focused then focused = p end end
  local key = 'tab:' .. tab.id
  return C.W98Window({
    key = key, of = tab.of, title = tab.title, icon = tab.worktree and 'folder' or 'dos', active = tab.active and S.top == key,
    onfocus = function() if not tab.active then pumi.cmd('select_tab', tab.id) end; S.top = key end,
    onclose = function() pumi.cmd('close_tab', tab.id) end,
    menus = {
      { label = 'File', items = {
        { icon = 'dos', label = 'New Window', run = function() pumi.cmd('new_tab') end },
        { label = 'Split Right', run = function() pumi.cmd('split', focused and focused.key, 'right') end },
        { label = 'Split Down', run = function() pumi.cmd('split', focused and focused.key, 'down') end },
        '-',
        { label = 'Rename…', run = function() pumi.cmd('select_tab', tab.id); pumi.cmd('rename_tab') end },
        { label = 'Close Pane', disabled = not focused, run = function() pumi.cmd('close_pane', focused.key) end },
        { label = 'Close', run = function() pumi.cmd('close_tab', tab.id) end },
      } },
      { label = 'Edit', items = {
        { label = 'Clear', run = function() pumi.cmd('clear_pane') end },
        { label = 'Reopen Closed', run = function() pumi.cmd('reopen_closed') end },
      } },
      { label = 'View', items = {
        { label = 'Zoom Pane', checked = tab.zoomed, run = function() pumi.cmd('zoom') end },
        { label = 'Next Pane', run = function() pumi.cmd('cycle_pane_next') end },
        { label = 'Full Screen', checked = app.window.fullscreen, run = function() pumi.cmd('fullscreen') end },
      } },
      { label = 'Help', items = {
        { icon = 'help', label = 'Help Topics', run = function() pumi.cmd('help') end },
        { label = 'About pumi', run = function() S.dialog = 'about' end },
      } },
    },
    body = C.Panes(tab, app, 'panes-' .. tab.id),
    status = focused and (focused.cwd ~= '' and focused.cwd or focused.kind) or nil,
  }, desk, n)
end

local function page_window(page, desk, n)
  local key = 'page:' .. page.id
  return C.W98Window({
    key = key, title = page.label, icon = 'folder', active = S.top == key,
    onfocus = function() S.top = key end,
    onclose = function() S.open[key] = nil end,
    menus = { { label = 'File', items = { { label = 'Close', run = function() S.open[key] = nil end } } } },
    body = box { class = 'explorer', C.PageBody(page) },
  }, desk, n)
end

-- -- the desktop -----------------------------------------------------------------------------

local function desktop_icons(app)
  local first = app.pages[1]
  local icons = {
    { 'computer', 'My Computer', function() pumi.cmd('settings') end },
    { 'documents', 'Sessions', function() pumi.cmd('projects') end },
    { 'dos', 'MS-DOS Prompt', function() pumi.cmd('new_tab') end },
    { 'globe', 'Internet Explorer', function() pumi.cmd('open_browser') end },
    first and { 'folder', first.label, function() open_page(first) end } or nil,
    { 'recycle', 'Recycle Bin', function() pumi.cmd('reopen_closed') end },
  }
  return box { id = 'icons', map(icons, function(i)
    return box { key = i[2], class = cls('desk-icon', S.selected == i[2] and 'selected'),
      onclick = function() S.selected = i[2]; close_menus(); return true end,
      ondblclick = function() i[3](); return true end,
      image(i[1], 'desk-glyph'),
      text { class = 'desk-label', i[2] } }
  end) }
end

-- -- the taskbar -----------------------------------------------------------------------------

local function task(key, title, icon, pressed, onclick, of, status)
  return C.W98Button { key = key, class = cls('task', status and status ~= '' and ('status-' .. status)), of = of,
    pressed = pressed, title = title,
    onclick = function() onclick(); close_menus() end,
    image(icon, 'task-icon'), text { class = 'task-title', title } }
end

function C.Taskbar(app)
  local tasks = {}
  for _, tab in ipairs(app.tabs) do
    local key = 'tab:' .. tab.id
    local s = S.win[key] or {}
    tasks[#tasks + 1] = task(key, tab.title, 'dos', tab.active and S.top == key and not s.min, function()
      if tab.active and S.top == key and not s.min then s.min = true
      else s.min = false; raise(key); S.top = key; pumi.cmd('select_tab', tab.id) end
    end, tab.of, tab.status)
  end
  for _, page in ipairs(app.pages) do
    local key = 'page:' .. page.id
    if S.open[key] then
      local s = S.win[key] or {}
      tasks[#tasks + 1] = task(key, page.label, 'folder', S.top == key and not s.min, function()
        if S.top == key and not s.min then s.min = true else s.min = false; raise(key); S.top = key end
      end)
    end
  end
  local blocked, working = 0, 0
  for _, a in ipairs(app.agents) do
    if a.status == 'blocked' then blocked = blocked + 1 elseif a.status == 'working' then working = working + 1 end
  end
  return box { id = 'taskbar',
    C.W98Button { id = 'start', pressed = S.menu,
      onclick = function() S.menu = not S.menu; S.path = {}; S.bar = nil end,
      image('flag', 'start-flag'), text { class = 'start-label', 'Start' } },
    box { class = 'bar-sep' },
    box { id = 'quick',
      C.W98Button { class = 'quick', title = 'MS-DOS Prompt', onclick = function() pumi.cmd('new_tab') end, image('dos', 'quick-icon') },
      C.W98Button { class = 'quick', title = 'Internet Explorer', onclick = function() pumi.cmd('open_browser') end, image('globe', 'quick-icon') },
    },
    box { class = 'bar-sep' },
    box { id = 'tasks', tasks },
    box { id = 'tray', class = 'sunken',
      C.Slot(app, 'statusline', 'tray-view'),
      working > 0 and box { class = 'tray-agent working', title = working .. ' working', text { tostring(working) } } or nil,
      blocked > 0 and box { class = 'tray-agent blocked', title = blocked .. ' blocked',
        onclick = function() pumi.cmd('next_agent'); return true end, text { tostring(blocked) } } or nil,
      text { class = 'clock', app.clock } },
  }
end

-- -- dialogs ---------------------------------------------------------------------------------

local function dialog(title, body, buttons, width)
  return box { id = 'modal', onclick = function() return true end,
    box { class = 'raised dialog', style = { width = width or 340 },
      box { class = 'raised-in window-in',
        box { class = 'caption', text { class = 'caption-title', title }, box { class = 'spacer' },
          caption_button('✕', 'Close', function() S.dialog = nil end) },
        body,
        box { class = 'dialog-buttons', buttons },
      } } }
end

local function dialog_button(label, f, default)
  return C.W98Button { class = cls('dialog-btn', default and 'default'), onclick = function() f() end, text { label } }
end

local function run(line)
  S.dialog = nil
  line = (line or ''):match('^%s*(.-)%s*$')
  if line == '' then return end
  if line:match('^https?://') or line:match('^www%.') then pumi.cmd('open_browser', line)
  elseif line:match('^[/~]') then pumi.cmd('open_path', line)
  else pumi.cmd('call', 'pumi_cmd', 'new-window ' .. string.format('%q', line)) end
end

function C.Dialog(app)
  if S.dialog == 'shutdown' then
    return dialog('Shut Down Windows',
      box { class = 'dialog-body', image('shutdown', 'dialog-icon'),
        box { class = 'dialog-text', text { 'Are you sure you want to quit pumi?' },
          text { class = 'dim', 'Your sessions keep running in the server.' } } },
      { dialog_button('Yes', function() pumi.cmd('quit') end, true), dialog_button('No', function() S.dialog = nil end) })
  elseif S.dialog == 'run' then
    return dialog('Run',
      box { class = 'dialog-body', image('run', 'dialog-icon'),
        box { class = 'dialog-text',
          text { 'Type the name of a program, folder, or Internet resource, and pumi will open it for you.' },
          box { class = 'run-row', text { 'Open:' },
            input { id = 'run-input', class = 'run-input sunken', focusable = true, value = S.last_run or '',
              onsubmit = function(ev) S.last_run = ev.value; run(ev.value); return true end } } } },
      { dialog_button('Cancel', function() S.dialog = nil end) }, 380)
  elseif S.dialog == 'about' then
    return dialog('About pumi',
      box { class = 'dialog-body', image('computer', 'dialog-icon'),
        box { class = 'dialog-text', text { class = 'bold', 'pumi' }, text { 'A terminal workspace.' },
          text { class = 'dim', #app.plugins .. ' plugins, ' .. #app.packages .. ' packages' } } },
      { dialog_button('OK', function() S.dialog = nil end, true) })
  end
  return nil
end

-- -- the screen ------------------------------------------------------------------------------

function C.Desktop(app)
  local desk = { w = app.window.width, h = app.window.height }
  -- Windows: every tab's, and every open page's, in the order they were raised.
  local wins, n = {}, 0
  for _, tab in ipairs(app.tabs) do
    n = n + 1
    local key = 'tab:' .. tab.id
    wins[key] = function() return tab_window(tab, app, desk, n) end
    if tab.active and S.selected_tab ~= tab.id then S.selected_tab = tab.id; raise(key); S.top = key end
  end
  for _, page in ipairs(app.pages) do
    n = n + 1
    local key = 'page:' .. page.id
    if S.open[key] then local i = n; wins[key] = function() return page_window(page, desk, i) end end
  end
  -- New windows on top, then the raised order without what has gone.
  for key in pairs(wins) do if not S.win[key] then raise(key) end end
  local order = {}
  for _, key in ipairs(S.order) do if wins[key] then order[#order + 1] = key end end
  S.order = order
  local drawn = map(order, function(key) return wins[key]() end)
  return box { id = 'desktop', class = cls(app.window.active and 'active' or 'inactive'),
    onclick = function() close_menus(); S.selected = nil end,
    desktop_icons(app),
    box { id = 'windows', drawn },
    C.Taskbar(app),
    S.menu and C.StartMenu(app) or nil,
    C.Dialog(app),
  }
end

return {
  inherit_css = false,
  -- The Windows 98 palette, in both appearances.
  colors = {
    desktop = '#008080', face = '#c0c0c0', light = '#dfdfdf', white = '#ffffff', shadow = '#808080',
    dark = '#0a0a0a', black = '#000000', ink = '#000000', highlight = '#000080', checker = '#e8e8e8',
    title = '#000080', title2 = '#1084d0', inactive = '#808080', inactive2 = '#b5b5b5', tip = '#ffffe1',
    -- The app's own tokens: Settings, the menus, the pickers and every plugin draw in these.
    bg = '#c0c0c0', window = '#c0c0c0', chrome_surface = '#c0c0c0', chrome_selected = '#dfdfdf',
    chrome_border = '#808080', text = '#000000', chrome_muted = '#404040', faint = '#808080',
    accent = '#000080', surface = '#c0c0c0', surface_text = '#000000', muted = '#404040',
    placeholder = '#808080', hover = '#dfdfdf', active = '#b5b5b5', border = '#808080',
    border_variant = '#dfdfdf', element = '#ffffff', element_disabled = '#c0c0c0', editor = '#ffffff',
    input_hover = '#000000', focus_ring = '#000080', selection = '#a6caf0', row_selected = '#a6caf0',
    primary = '#000080', primary_hover = '#1084d0', primary_active = '#000060', primary_foreground = '#ffffff',
    danger_hover = '#c00000', danger_active = '#800000', danger_foreground = '#ffffff',
    success = '#008000', warning = '#808000', error = '#c00000', overlay = '#00000033',
    tab_bar = '#c0c0c0', tab_active = '#c0c0c0', tab_text = '#000000', tab_active_text = '#000000',
  },
  -- Square corners, thin borders and Tahoma, everywhere.
  metrics = {
    radius = 0, radius_sm = 0, radius_lg = 0, border = 1,
    font = 'Tahoma', font_size = 11, font_size_sm = 10, control_height = 22, spacing = 3,
  },
  components = C,
  render = function(app) return C.Desktop(app) end,
}

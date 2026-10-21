-- extends: default
-- name: Dia
-- description: One frosted sidebar of pinned tiles, folders and tabs; the panes on a card beside it.
--
-- After the Dia browser. The sidebar is the whole chrome: the plugins' pages pinned as tiles
-- at its top, your other sessions as folders, then this session's tabs as rows. The panes sit
-- on one rounded card beside it, under a quiet toolbar. It extends `default` for the panes,
-- the splits, the docks' pages and the menus, and replaces the rest.

local box, text, icon, input, map, cls = ui.box, ui.text, ui.icon, ui.input, ui.map, ui.cls
local C = components

-- What the sidebar shows besides the tabs: a pinned page, when one is open.
state.dia = state.dia or { page = nil }
local D = state.dia

-- -- the sidebar ---------------------------------------------------------------------------

-- A tab's "favicon": its agent's state when it has one, else what its first pane holds.
local function tab_icon(tab)
  if tab.status and tab.status ~= '' and tab.status ~= 'idle' then return C.Dot(tab.status) end
  local kind = tab.panes and tab.panes[1] and tab.panes[1].kind or 'terminal'
  local name = (kind == 'browser' and 'tool_web') or (kind == 'document' and 'code') or (tab.worktree and 'git_branch') or 'terminal'
  return icon { class = 'dia-favicon', name }
end

-- What one pane holds, as its icon: its agent's state, else its kind.
local function pane_icon(p)
  if p.status and p.status ~= '' and p.status ~= 'idle' then return C.Dot(p.status) end
  local name = (p.kind == 'browser' and 'tool_web') or (p.kind == 'document' and 'code') or 'terminal'
  return icon { class = 'dia-favicon', name }
end

-- One pane of a split tab, as Dia draws a split view: its icon, its title and its own close,
-- side by side with the others in the tab's row. Clicking it goes to that pane.
function C.DiaSegment(p, tab)
  return box {
    key = p.key, class = cls('dia-seg', tab.active and p.focused and 'focused'), of = p.id ~= '' and p.id or nil,
    title = p.title ~= '' and p.title or p.kind,
    onclick = function()
      if not tab.active then pumi.cmd('select_tab', tab.id) end
      pumi.cmd('focus_pane', p.key)
      return true
    end,
    box { class = 'dia-icon', pane_icon(p) },
    text { class = 'dia-label', p.title ~= '' and p.title or p.kind },
    C.IconButton { class = 'dia-close', icon = 'close', title = 'Close Pane', onclick = function() pumi.cmd('close_pane', p.key) end },
  }
end

function C.DiaTab(tab, app)
  local renaming = app.renaming == ('tab:' .. tab.id)
  local shown = {}
  for _, p in ipairs(tab.panes or {}) do if not p.hidden then shown[#shown + 1] = p end end
  local split = #shown > 1 and not renaming
  return box {
    key = 'tab' .. tab.id, class = cls('dia-row', 'dia-tab', tab.active and 'active', split and 'split'), of = tab.of,
    title = tab.worktree and ('Worktree ' .. tab.worktree) or tab.title,
    draggable = { tab = tab.id },
    ondrop = function(ev)
      if ev.data.tab and ev.data.tab ~= tab.id then pumi.cmd('move_tab', ev.data.tab, tab.id) end
      if ev.data.pane then pumi.cmd('move_pane_to_tab', ev.data.pane, tab.id) end
      return true
    end,
    onclick = function() pumi.cmd('select_tab', tab.id); return true end,
    ondblclick = function() pumi.cmd('start_rename', 'tab:' .. tab.id); return true end,
    onmousedown = function(ev) if ev.button == 'middle' then pumi.cmd('close_tab', tab.id); return true end end,
    oncontextmenu = function(ev) pumi.cmd('tab_menu', tab.id, ev.wx, ev.wy); return true end,
    split and map(shown, function(p) return C.DiaSegment(p, tab) end) or nil,
    not split and box { class = 'dia-icon', tab_icon(tab) } or nil,
    not split and (renaming and input {
      class = 'dia-rename', value = tab.label or tab.title, focusable = true,
      onsubmit = function(ev) pumi.cmd('rename_tab', tab.id, ev.value); return true end,
    } or text { class = 'dia-label', tab.title }) or nil,
    not split and C.IconButton { class = 'dia-close', icon = 'close', title = 'Close Tab',
      onclick = function() pumi.cmd('close_tab', tab.id) end } or nil,
  }
end

-- A session, as one of Dia's folders: the current one open, the rest a click away.
function C.DiaFolder(space)
  return box {
    key = 'space' .. space.id, class = cls('dia-row', 'dia-folder', space.active and 'current'),
    title = space.tabs .. (space.tabs == 1 and ' tab' or ' tabs'),
    onclick = function() if not space.active then pumi.cmd('select_space', space.id) end; return true end,
    oncontextmenu = function() pumi.cmd('projects'); return true end,
    box { class = 'dia-icon', (space.status and space.status ~= '' and space.status ~= 'idle') and C.Dot(space.status)
      or icon { class = 'dia-favicon', space.active and 'folder_open' or 'folder' } },
    text { class = 'dia-label', space.label },
    icon { class = 'dia-chevron', space.active and 'chevron_down' or 'chevron_right' },
  }
end

-- The plugins' pages, pinned: four to a row, the open one lifted.
function C.DiaTiles(pages)
  if #pages == 0 then return nil end
  return box { id = 'dia-tiles',
    map(pages, function(p)
      return box { key = p.id, class = cls('dia-tile', D.page == p.id and 'active'), title = p.label,
        onclick = function() D.page = (D.page ~= p.id) and p.id or nil; return true end,
        icon { p.icon or 'package' } }
    end),
  }
end

function C.DiaPage(page)
  return box { id = 'dia-page',
    box { class = 'dia-page-head',
      text { class = 'dia-page-title', page.label },
      C.Spacer(),
      C.IconButton { icon = 'close', title = 'Back to Tabs', onclick = function() D.page = nil end },
    },
    C.PageBody(page),
  }
end

function C.DiaTabs(app)
  return box { id = 'dia-list',
    map(app.spaces, function(s) return C.DiaFolder(s) end),
    box { class = 'dia-sep' },
    box { class = cls('dia-row', 'dia-new'), onclick = function() pumi.cmd('new_tab'); return true end,
      oncontextmenu = function(ev) pumi.cmd('new_menu', ev.wx, ev.wy, 0, 0); return true end,
      box { class = 'dia-icon', icon { class = 'dia-favicon', 'plus' } }, text { class = 'dia-label', 'New Tab' } },
    map(app.tabs, function(t) return C.DiaTab(t, app) end),
  }
end

function C.DiaSidebar(app)
  local pages = C.pages(app, 'primary')
  local page
  for _, p in ipairs(pages) do if p.id == D.page then page = p end end
  if not page then D.page = nil end
  local w = app.window
  return box { id = 'dia-sidebar', style = { width = C.size('sidebar', w.sidebar_width) },
    box { id = 'dia-top',
      ondblclick = function(ev) if ev.target and ev.target.id == 'dia-top' then pumi.cmd('zoom_window') end end,
      app.platform == 'macos' and not w.fullscreen and box { class = 'traffic-lights' } or nil,
      C.Spacer(),
      C.Slot(app, 'titlebar.left'),
      C.IconButton { id = 'space', icon = 'chevron_up_down', title = 'Sessions', onclick = function() pumi.cmd('projects') end },
    },
    C.DiaTiles(pages),
    C.Slot(app, 'sidebar.head', 'sidebar-head'),
    page and C.DiaPage(page) or C.DiaTabs(app),
    box { id = 'dia-foot',
      C.Agents(app),
      C.Spacer(),
      C.Slot(app, 'statusline', 'status-view'),
    },
    C.Handle('sidebar', 'right', w.sidebar_width),
  }
end

-- -- the card ------------------------------------------------------------------------------

function C.DiaToolbar(app)
  local w = app.window
  local tab = C.active_tab(app)
  local focused = app.focused
  return box { id = 'dia-toolbar', class = cls(not w.sidebar and 'no-sidebar'),
    ondblclick = function(ev) if ev.target and ev.target.id == 'dia-toolbar' then pumi.cmd('zoom_window') end end,
    not w.sidebar and app.platform == 'macos' and not w.fullscreen and box { class = 'traffic-lights' } or nil,
    C.IconButton { id = 'toggle-sidebar', icon = 'layout_sidebar_left', title = 'Side Bar',
      onclick = function() pumi.cmd('toggle', 'sidebar') end },
    focused and C.IconButton { icon = 'split', title = 'Split Right', onclick = function() pumi.cmd('split', focused, 'right') end } or nil,
    focused and C.IconButton { icon = 'split_down', title = 'Split Down', onclick = function() pumi.cmd('split', focused, 'down') end } or nil,
    tab and #tab.panes > 1 and C.IconButton { icon = tab.zoomed and 'minimize' or 'maximize', title = 'Zoom',
      onclick = function() pumi.cmd('zoom') end } or nil,
    C.PointButtons(app.menus.ToolBar, 'ToolBar', nil, true),
    C.Spacer(),
    C.Slot(app, 'ToolBar', 'toolbar-view'),
    C.PointButtons(app.menus.ToolBar, 'ToolBar', nil, false),
    C.Slot(app, 'titlebar.right'),
    app.notice and text { class = 'dia-notice', app.notice } or nil,
    #C.pages(app, 'secondary') > 0 and C.IconButton { id = 'toggle-secondary',
      icon = 'layout_sidebar_right', title = 'Secondary Side Bar', active = w.secondary,
      onclick = function() pumi.cmd('toggle', 'secondary') end } or nil,
    box { id = 'dia-settings', title = 'Settings', onclick = function() pumi.cmd('settings'); return true end,
      icon { 'settings' }, text { 'Settings' } },
  }
end

-- An empty tab: Dia's new tab, an orb over a field of what to start.
function C.Empty(message, actions)
  return box { class = 'empty dia-empty',
    box { class = 'dia-orb' },
    box { class = 'dia-ask',
      box { class = 'dia-ask-line', icon { 'magnifying_glass' }, text { class = 'dia-ask-text', message } },
      box { class = 'dia-ask-actions',
        map(actions, function(a)
          return box { class = 'dia-chip', onclick = function() pumi.cmd(a[2]); return true end,
            icon { a[2] == 'open_file' and 'folder' or 'plus' }, text { a[1] } }
        end) },
    },
  }
end

function C.DiaCard(app)
  local w = app.window
  return box { id = 'dia-card',
    C.DiaToolbar(app),
    C.Panes(C.active_tab(app), app),
    w.bottom and C.Bottom(app) or nil,
  }
end

function C.Dia(app)
  local w = app.window
  return box { id = 'window', class = cls('dia', app.appearance, w.active and 'active' or 'inactive', not w.sidebar and 'bare'),
    w.sidebar and C.DiaSidebar(app) or nil,
    C.DiaCard(app),
    w.secondary and #C.pages(app, 'secondary') > 0 and C.Secondary(app) or nil,
  }
end

-- Dia's own, both ways, then the app's tokens (dia.json's), so Settings, the menus and every
-- plugin are drawn in them too.
local dark = {
  dia_top = '#2b3540', dia_bottom = '#394854', dia_card = '#202327', dia_tile = '#ffffff12',
  dia_tile_hover = '#ffffff1c', dia_tile_active = '#ffffff2b', dia_row_hover = '#ffffff0f',
  dia_row_active = '#1d2024', dia_ink = '#eef1f4', dia_ink_muted = '#b9c2cb', dia_orb = '#8fa6c4',
  dia_orb2 = '#4d607a', dia_ask = '#2a2d31', dia_line = '#ffffff12',
  window = '#2b3540', bg = '#1a1d21', chrome_surface = '#ffffff14', chrome_selected = '#ffffff2e',
  chrome_border = '#ffffff0f', text = '#eef1f4', chrome_muted = '#b2bac2', faint = '#7f8892',
  accent = '#78aef5', surface = '#24282d', hover = '#ffffff12', active = '#ffffff1f', border = '#ffffff17',
  border_variant = '#ffffff0d', element = '#ffffff14', focus_ring = '#78aef5', surface_text = '#e3e7eb',
  muted = '#a3acb5', placeholder = '#6c757e', editor = '#202327', selection = '#2f4a6e',
  row_selected = '#ffffff2e', primary = '#5b9bf0', primary_hover = '#6ea8f3', primary_active = '#4a8be0',
  primary_foreground = '#ffffff', success = '#7cc58f', warning = '#e6b450', error = '#ef6b6b',
  overlay = '#15181bd9', ['terminal.background'] = '#202327',
}
local light = {
  dia_top = '#e4edf4', dia_bottom = '#d2dfe9', dia_card = '#ffffff', dia_tile = '#ffffff8c',
  dia_tile_hover = '#ffffffbf', dia_tile_active = '#ffffff', dia_row_hover = '#0000000a',
  dia_row_active = '#ffffff', dia_ink = '#1b2127', dia_ink_muted = '#56616b', dia_orb = '#9db6d8',
  dia_orb2 = '#6d86ab', dia_ask = '#f6f8fa', dia_line = '#00000012',
  window = '#e4edf4', bg = '#fbfcfd', chrome_surface = '#fffffff5', chrome_selected = '#fffffff2',
  chrome_border = '#00000012', text = '#1b2127', chrome_muted = '#56616b', faint = '#86909a',
  accent = '#4a8fe7', surface = '#f6f8fa', hover = '#0000000d', active = '#00000017', border = '#0000001a',
  border_variant = '#00000010', element = '#0000000f', focus_ring = '#4a8fe7', surface_text = '#1f262d',
  muted = '#5f6a74', placeholder = '#9aa4ad', editor = '#ffffff', selection = '#c4dcfb',
  row_selected = '#fffffff2', primary = '#4a8fe7', primary_hover = '#5d9cec', primary_active = '#3b7fd6',
  primary_foreground = '#ffffff', success = '#3f9b5a', warning = '#c98a12', error = '#d9534f',
  overlay = '#e6edf3d9', ['terminal.background'] = '#ffffff',
}

return {
  colors = { dark = dark, light = light },
  -- Soft, like Dia: round cards, rounder tiles, comfortable rows.
  metrics = { radius = 8, radius_sm = 6, radius_lg = 12, control_height = 28 },
  window = { background = 'blurred' },
  components = C,
  render = function(app) return C.Dia(app) end,
}

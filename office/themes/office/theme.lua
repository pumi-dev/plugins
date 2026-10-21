-- extends: default
-- attach: all
-- name: Office
-- description: A pixel office: a desk for every tab of every session, each with its screen.
-- Office: pumi as a little pixel office, after Gather. Every session is a pod on the floor with
-- its name on it, and every tab in it is a desk whose little screen shows that tab's pane in
-- front, live — so the whole app is in the room at once. Point at a desk and its screen opens
-- beside it, big and readable; click it and you walk over and sit at its computer (the real
-- panes, where you type). Click anywhere on the floor to walk there. The bookshelf holds the
-- plugins' pages, the coffee machine is Settings, the door mat is the way to your other sessions,
-- and a desk you have split has a row of coffee cups on it. One desk holds a whole tab; turn on
-- "A desk for every pane" (Settings → Office Settings, or the bar) and every pane of a split gets
-- a desk, an agent and a screen of its own instead.

local box, text, img, input, native, map, cls = ui.box, ui.text, ui.img, ui.input, ui.native, ui.map, ui.cls
local C = components
local pct = C.pct

state.office = state.office or { you = nil, at = nil, sitting = nil, walking = false, shelf = false, page = nil }
local O = state.office

-- What the office keeps between runs (`saved`): where each desk was moved to, by tab, and
-- where you were standing. Drag a desk to move it; "Tidy up" puts them back in rows.
saved.office = saved.office or {}
local S = saved.office
S.desks = S.desks or {}
O.you = O.you or S.you

local CELL_W, CELL_H = 176, 156   -- a desk's place on the carpet
local CARPET, LABEL_H = 22, 34    -- a pod's carpet around its desks, and its name above them
local MARGIN = 24                 -- the floor's own margin, left and right
local WALL, HUD = 56, 56          -- the wall along the top, the bar along the bottom
local POD_GAP = 18                -- between two pods
local WALK_MS = 650
local TICK_MS = 200               -- how often the room redraws itself: screens move, desks follow

local function sprite(name, class, style) return img { class = cls('px', class), src = 'images/' .. name .. '.svg', style = style } end

-- A preview is a pane's screen as the app has it, scaled to the box: nothing is attached or
-- resized to draw it, so a desk can show a pane that is not on screen (see `attach = all`).
local function preview(pane, class)
  return native { class = cls('preview', class), view = 'preview:' .. pane.key }
end

-- A pane as a box with its screen in it, at `style` (a share of the box it sits in).
local function pane_box(p, style)
  return box { key = 'pane' .. p.key, class = cls('desk-pane', 'kind-' .. (p.kind or 'terminal')), style = style,
    p.kind == 'terminal' and preview(p) or text { class = 'desk-pane-label', p.title or p.kind } }
end

-- All of a box: the pane alone, filling the screen it is given.
local function whole() return { left = '0%', top = '0%', width = '100%', height = '100%' } end

-- A tab's panes as boxes, each with its screen in it: the whole tab, laid out as the tab is.
local function panes(tab)
  return map(tab.panes, function(p)
    if p.hidden then return nil end
    return pane_box(p, { left = pct(p.x), top = pct(p.y), width = pct(p.w), height = pct(p.h) })
  end)
end

-- A desk's own screen is small — the one the sprite draws — and shows the pane in front of the
-- tab. Pointing at the desk opens the tab's panes, big, beside it.
local PEEK_W, PEEK_H = 720, 440

-- Where the open screen goes: beside the desk, to its right when there is room, else its left.
local function opened(cell, p)
  local left = cell.x + CELL_W + 14
  if left + PEEK_W > p.w - 8 then left = cell.x - PEEK_W - 14 end
  left = math.max(8, math.min(left, p.w - PEEK_W - 8))
  local top = cell.y + math.floor(CELL_H / 2 - PEEK_H / 2)
  top = math.max(WALL + 8, math.min(top, p.floor_h - PEEK_H - 64))
  return { left = left - cell.x, top = top - cell.y }
end

-- The pane in front of a tab: what the desk's screen has in it.
local function front(tab)
  for _, p in ipairs(tab.panes or {}) do
    if p.focused then return p end
  end
  return (tab.panes or {})[1]
end

-- A desk's screen. Without `pane` it is the tab's: the pane in front, or — pointed at — every
-- pane of the tab, laid out as the tab is. With `pane` (a desk of its own, `desk_per_pane`) it is
-- that one pane's screen.
local function screen(tab, space, cell, p, open, pane)
  local status = tab.status or ''
  if pane and (pane.status or '') ~= '' then status = pane.status end
  local title = pane and (tab.title .. '  ·  ' .. (pane.title or pane.kind or 'pane')) or tab.title
  if open then
    local at = opened(cell, p)
    return box { class = 'screen open', style = { left = at.left, top = at.top, width = PEEK_W, height = PEEK_H },
      box { class = 'screen-bar',
        C.Dot(status),
        text { class = 'screen-title', (space.label or 'Session') .. '  ·  ' .. title },
        box { class = 'spacer' },
        text { class = 'screen-hint', 'click the desk to work here' },
      },
      box { class = 'screen-panes', pane and pane_box(pane, whole()) or panes(tab) },
    }
  end
  local shown = pane or front(tab)
  return box { class = cls('screen', 'of-' .. tab.of), shown and pane_box(shown, whole()) or nil }
end

-- -- the plan: where each session's pod is, and each desk in it ----------------------------------

-- A tab's desks: the tab itself, or — with "A desk for every pane" on — one for each of its panes,
-- so a split tab is a row of agents at their own desks instead of one desk holding them all.
local function desks_of(tab, per)
  local out = {}
  if per then
    for i, p in ipairs(tab.panes or {}) do
      if not p.hidden then out[#out + 1] = { tab = tab, pane = p, i = i } end
    end
  end
  if #out == 0 then out[1] = { tab = tab, i = 1 } end
  return out
end

local function per_pane(app) return app.settings and app.settings.desk_per_pane == true end

local function plan(app)
  local w, h = app.window.width, app.window.height - HUD
  local per = per_pane(app)
  local pods = {}
  -- A pod is a session: a carpet with its name on it, and a desk for each of its tabs — or, with the
  -- setting on, for each of their panes (laid down the pod and wrapped into another column when
  -- there are more than it takes).
  for _, space in ipairs(app.spaces) do
    local seats = {}
    for _, tab in ipairs(space.tab_list or {}) do
      for _, seat in ipairs(desks_of(tab, per)) do seats[#seats + 1] = seat end
    end
    local n = math.max(#seats + 1, 1)   -- its desks, and always a free desk
    local down = math.max(1, math.min(n, math.ceil(math.sqrt(n / 1.4))))
    local cols = math.ceil(n / down)
    local pod = { space = space, cols = cols, down = down, seats = seats,
      w = cols * CELL_W + 2 * CARPET, h = LABEL_H + math.min(n, down) * CELL_H + CARPET, cells = {} }
    for i = 1, n do
      local c, r = math.floor((i - 1) / down), (i - 1) % down
      pod.cells[i] = { x = CARPET + c * CELL_W, y = LABEL_H + r * CELL_H }
    end
    pods[#pods + 1] = pod
  end
  -- Pods next to each other, onto the next row when the floor runs out.
  local rows, row = {}, { pods = {}, w = 0, h = 0 }
  for _, pod in ipairs(pods) do
    local extra = pod.w + (#row.pods > 0 and POD_GAP or 0)
    if row.w + extra > w - 2 * MARGIN and #row.pods > 0 then
      rows[#rows + 1] = row
      row, extra = { pods = {}, w = 0, h = 0 }, pod.w
    end
    row.w, row.h = row.w + extra, math.max(row.h, pod.h)
    row.pods[#row.pods + 1] = pod
  end
  if #row.pods > 0 then rows[#rows + 1] = row end
  -- Each row in the middle of the floor, and the rows in the middle of the room.
  local tall = 0
  for _, r in ipairs(rows) do tall = tall + r.h end
  tall = tall + math.max(0, #rows - 1) * POD_GAP
  local y = WALL + math.max(34, math.floor((h - WALL - tall) / 2))
  for _, r in ipairs(rows) do
    local x = math.floor((w - r.w) / 2)
    for _, pod in ipairs(r.pods) do
      pod.x, pod.y = x, y
      for _, cell in ipairs(pod.cells) do cell.x, cell.y = pod.x + cell.x, pod.y + cell.y end
      x = x + pod.w + POD_GAP
    end
    y = y + r.h + POD_GAP
  end
  local bottom = WALL
  for _, pod in ipairs(pods) do bottom = math.max(bottom, pod.y + pod.h) end
  local floor_h = math.max(h, bottom + 150)
  return { w = w, h = h, floor_h = floor_h, pods = pods, bottom = bottom,
           centre = { x = math.floor(w / 2) - 12, y = math.floor((WALL + bottom) / 2) } }
end

-- Where you stand at a desk: beside its chair.
local function spot(cell) return { x = cell.x + 122, y = cell.y + 70 } end

-- Where a desk is: where it was moved to, else its place in the rows.
local function desk_at(key, cell)
  local p = S.desks[key]
  return p and { x = p.x, y = p.y } or cell
end

local function walk_to(to, after)
  O.you, O.walking = to, true
  S.you = { x = to.x, y = to.y }
  if O.walk_timer then ui.cancel(O.walk_timer) end
  O.walk_timer = ui.after(WALK_MS, function()
    O.walking, O.walk_timer = false, nil
    if after then after() end
  end)
end

local function stand_up() O.sitting = nil end

-- Who sits at a desk: a shirt of their own per tab, and per pane when a desk is a pane's.
local function shirt(tab, i) return ((tab.id + (i or 1) - 1) % 5) + 2 end

-- Go to a desk: its session, its tab, and — once you are there — sit at its monitor.
local function sit_at(tab, space, cell, pane)
  pumi.cmd('select_space', space.id)
  pumi.cmd('select_tab', tab.id)
  if pane then pumi.cmd('focus_pane', pane) end
  local to = spot(cell)
  if O.you and O.you.x == to.x and O.you.y == to.y and not O.walking then
    O.sitting = tab.id
  else
    O.sitting = nil
    walk_to(to, function() O.sitting = tab.id end)
  end
end

-- -- desks --------------------------------------------------------------------------------------

-- An easter egg: a cup of coffee for every pane open on the desk, so a desk you have been splitting
-- all night has a row of them.
local function cups(tab)
  local out = {}
  for i = 1, math.min(#(tab.panes or {}), 5) do
    out[#out + 1] = img { key = 'cup' .. i, class = 'px cup', src = 'images/cup.svg',
      style = { left = 48 + (i - 1) * 13, top = 36 } }
  end
  return out
end

local BUBBLE = { working = '…', blocked = '!', done = '✓', error = '✕' }

function C.Desk(tab, space, cell, p, pane, i)
  local status = tab.status or ''
  if pane and (pane.status or '') ~= '' then status = pane.status end
  local key = 'desk' .. tab.id .. (pane and (':' .. pane.key) or '')
  local where = pane and (tab.title .. '  ·  ' .. (pane.title or pane.kind or 'pane')) or tab.title
  local active = tab.active and (pane == nil or pane.focused)
  cell = desk_at(key, cell)
  local open = O.peek == key
  return box {
    key = key, class = cls('desk', space.active and 'in-session', active and 'active',
      status ~= '' and ('status-' .. status), O.dragging == key and 'moving', open and 'peeking',
      pane and 'one-pane'), of = tab.of,
    title = (space.label or 'Session') .. ' · ' .. where .. '  —  click to work here',
    style = { left = cell.x, top = cell.y },
    onmousedown = function() O.moved = 0 end,
    -- Dragging moves the desk; where it ends up is kept.
    ondrag = function(ev)
      local d = S.desks[key] or { x = cell.x, y = cell.y }
      d.x = math.max(0, math.floor(d.x + ev.dx))
      d.y = math.max(WALL, math.floor(d.y + ev.dy))
      S.desks[key] = d
      O.moved = (O.moved or 0) + math.abs(ev.dx) + math.abs(ev.dy)
      if O.moved > 4 then O.dragging = key end
      return true
    end,
    ondragend = function() O.dragging = nil end,
    onclick = function()
      if (O.moved or 0) > 4 then O.moved = 0; return true end
      sit_at(tab, space, cell, pane and pane.key or nil)
      return true
    end,
    oncontextmenu = function(ev)
      pumi.cmd(pane and 'pane_menu' or 'tab_menu', pane and pane.key or tab.id, ev.wx, ev.wy); return true
    end,
    ondblclick = function()
      pumi.cmd('start_rename', pane and ('pane:' .. pane.key) or ('tab:' .. tab.id)); return true
    end,
    -- Pointing at a desk opens its screen: what it holds, big, where the screen is.
    onenter = function() O.peek = key end,
    onleave = function() if O.peek == key then O.peek = nil end end,
    sprite('desk', 'desk-art'),
    pane and nil or cups(tab),
    screen(tab, space, cell, p, open, pane),
    sprite('chair', 'chair'),
    status ~= '' and sprite('seated' .. shirt(tab, i or 1), 'seated') or nil,
    BUBBLE[status] and box { class = cls('bubble', 'bubble-' .. status), text { BUBBLE[status] } } or nil,
    box { class = 'nameplate', box { class = cls('dot', 'status-' .. status) }, text { class = 'nameplate-text', where } },
  }
end

function C.FreeDesk(space, cell)
  return box { key = 'free-desk' .. space.id, class = 'desk free', title = 'New desk: a new tab in ' .. (space.label or 'this session'),
    style = { left = cell.x, top = cell.y },
    onclick = function()
      walk_to(spot(cell), function()
        pumi.cmd('select_space', space.id)
        pumi.cmd('new_tab')
      end)
      return true
    end,
    sprite('desk', 'desk-art'),
    sprite('chair', 'chair'),
    box { class = 'nameplate', text { class = 'nameplate-text', '+ New desk' } },
  }
end

-- -- you -------------------------------------------------------------------------------------

function C.You(p)
  local at = O.you or p.centre
  return box { key = 'you', id = 'you', class = cls(O.walking and 'walking'),
    style = { transform = string.format('translate(%dpx, %dpx)', at.x, at.y) },
    box { class = 'you-label', box { class = 'online' }, text { 'You' } },
    sprite('person1', 'you-art'),
  }
end

-- -- renaming: a desk's (or a pane's) name, asked for in the middle of the room ------------------

-- What `app.renaming` names: a tab (`tab:12`) or a pane (`pane:t:%3`), and its name as it is.
local function renaming(app, target)
  local tab_id = tonumber((target or ''):match('^tab:(%d+)$'))
  for _, sp in ipairs(app.spaces) do
    for _, t in ipairs(sp.tab_list or {}) do
      if tab_id and t.id == tab_id then
        return { what = 'desk', name = t.label or t.title, space = sp, tab = t }
      end
      for _, p in ipairs(t.panes or {}) do
        if target == ('pane:' .. p.key) then
          return { what = 'pane', name = p.title, space = sp, tab = t, pane = p }
        end
      end
    end
  end
end

function C.Rename(app)
  if not app.renaming then
    O.typed = nil
    return nil
  end
  local r = renaming(app, app.renaming)
  if not r then return nil end
  local name = r.name or ''
  local function done(value)
    value = (value or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if r.pane then
      pumi.cmd('rename_pane', r.pane.key, value)
    else
      pumi.cmd('rename_tab', r.tab.id, value)
    end
    O.typed = nil
    return true
  end
  return box { id = 'rename-backdrop', onclick = function() pumi.cmd('finish_rename'); O.typed = nil; return true end,
    box { id = 'rename', onclick = function() return true end,
      text { class = 'rename-title', 'Rename ' .. r.what },
      text { class = 'rename-where', (r.space.label or 'Session') .. '  ·  ' .. (r.tab.title or '') },
      input { class = 'rename-input', value = name, focusable = true, autofocus = true,
        oninput = function(ev) O.typed = ev.value end,
        onsubmit = function(ev) return done(ev.value) end },
      box { class = 'rename-actions',
        box { class = 'rename-button', onclick = function() pumi.cmd('finish_rename'); O.typed = nil; return true end,
          text { 'Cancel' } },
        box { class = 'rename-button primary', onclick = function() return done(O.typed or name) end,
          text { 'Rename' } },
      },
    },
  }
end

-- -- the room --------------------------------------------------------------------------------

local function Pod(pod)
  local space = pod.space
  return box { key = 'pod' .. space.id, class = cls('pod', space.active and 'active'),
    style = { left = pod.x, top = pod.y, width = pod.w, height = pod.h },
    box { class = 'pod-carpet', style = { left = 0, top = 0, width = pod.w, height = pod.h } },
    box { class = 'pod-label', style = { left = 0, top = 8, width = pod.w },
      box { class = 'pod-head', title = space.label .. ' — click to make it the session in front',
        onclick = function() pumi.cmd('select_space', space.id); return true end,
        C.Dot(space.status), text { class = 'pod-name', space.label or 'Session' },
        text { class = 'pod-count', tostring(#(space.tab_list or {})) } } },
  }
end

-- Things to stand where a pod has room left: one per spare place, in the same order each time.
local DECOR = {
  { art = 'plant', w = 28, h = 44, top = 66 },
  { art = 'coffee', w = 32, h = 48, top = 64 },
  { art = 'mat', w = 60, h = 28, top = 96 },
  { art = 'plant', w = 28, h = 44, top = 66 },
}

local function decor(i, cell)
  local d = DECOR[(i - 1) % #DECOR + 1]
  return sprite(d.art, 'decor', { left = cell.x + math.floor((CELL_W - d.w) / 2), top = cell.y + d.top, width = d.w, height = d.h })
end

local function Props(p)
  return {
    box { key = 'shelf', class = 'prop', title = 'Bookshelf: plugins', style = { left = 36, top = WALL + 16 },
      onclick = function() O.shelf = not O.shelf; return true end,
      sprite('shelf', 'shelf-art'), box { class = 'prop-label', text { 'Plugins' } } },
    box { key = 'coffee', class = 'prop', title = 'Coffee: Settings', style = { left = p.w - 84, top = WALL + 12 },
      onclick = function() pumi.cmd('settings'); return true end,
      sprite('coffee', 'coffee-art'), box { class = 'prop-label', text { 'Settings' } } },
    box { key = 'mat', class = 'prop', title = 'Sessions', style = { left = math.floor(p.w / 2) - 30, top = p.floor_h - 30 },
      onclick = function() pumi.cmd('projects'); return true end,
      sprite('mat', 'mat-art') },
  }
end

function C.Room(p)
  local spare = 0
  local desks = map(p.pods, function(pod)
    local taken = #pod.seats + 1
    local extras = {}
    for i = taken + 1, #pod.cells do
      if #extras < 2 and pod.cells[i] then
        spare = spare + 1
        extras[#extras + 1] = decor(spare, pod.cells[i])
      end
    end
    local seats = {}
    for i, seat in ipairs(pod.seats) do
      seats[#seats + 1] = C.Desk(seat.tab, pod.space, pod.cells[i], p, seat.pane, seat.i)
    end
    return { Pod(pod), seats,
             C.FreeDesk(pod.space, pod.cells[taken] or pod.cells[#pod.cells]),
             extras }
  end)
  -- The floor is walkable: a press anywhere on it takes you there (a desk's own press stops here).
  return box { id = 'room',
    box { id = 'floor', style = { height = p.floor_h },
      onclick = function(ev)
        if (O.moved or 0) > 4 then O.moved = 0; return true end
        local floor = ui.rect('floor')
        if not floor then return end
        O.sitting = nil
        walk_to({ x = math.floor(ev.x - floor.x), y = math.max(WALL, math.floor(ev.y - floor.y)) })
        return true
      end,
      box { id = 'wall' },
      desks,
      Props(p),
      sprite('plant', 'plant', { left = 60, top = p.bottom + 40 }),
      sprite('plant', 'plant', { left = 96, top = p.bottom + 40 }),
      sprite('plant', 'plant', { left = p.w - 116, top = p.bottom + 40 }),
      sprite('plant', 'plant', { left = p.w - 80, top = p.bottom + 40 }),
      C.You(p),
    },
  }
end

-- -- the monitor: a desk's panes, while you sit at it --------------------------------------------

function C.Monitor(app)
  local tab
  for _, t in ipairs(app.tabs) do if t.id == O.sitting then tab = t end end
  if not tab then O.sitting = nil; return nil end
  return box { id = 'monitor-backdrop', onclick = function() stand_up(); return true end,
    box { id = 'monitor', onclick = function() return true end,
      box { class = 'monitor-bar',
        box { class = cls('dot', 'status-' .. (tab.status or '')) },
        text { class = 'monitor-title', tab.title },
        box { class = 'spacer' },
        C.IconButton { icon = 'split', title = 'Split Right', onclick = function() pumi.cmd('split', nil, 'right') end },
        C.IconButton { icon = 'split_down', title = 'Split Down', onclick = function() pumi.cmd('split', nil, 'down') end },
        box { class = 'stand', onclick = function() stand_up(); return true end, text { 'Stand up' } },
      },
      box { class = 'monitor-screen', C.Panes(tab, app, 'panes-office') },
    },
    box { class = 'monitor-stand' },
  }
end

-- -- the bookshelf: the plugins' pages ---------------------------------------------------------

function C.Shelf(app)
  local page = C.active_page(app.pages, O.page)
  return box { id = 'shelf', onclick = function() return true end,
    box { class = 'shelf-head',
      text { class = 'shelf-title', 'Bookshelf' },
      box { class = 'spacer' },
      C.IconButton { icon = 'close', title = 'Close', onclick = function() O.shelf = false end },
    },
    box { class = 'shelf-books',
      map(app.pages, function(pg)
        return box { key = pg.id, class = cls('book', page and pg.id == page.id and 'active'),
          onclick = function() O.page = pg.id; return true end,
          ui.icon { pg.icon or 'package' }, text { pg.label } }
      end) },
    box { class = 'shelf-body', C.PageBody(page) },
  }
end

-- -- the bar along the bottom ----------------------------------------------------------------

function C.Hud(app)
  local working, blocked = 0, 0
  for _, a in ipairs(app.agents) do
    if a.status == 'working' then working = working + 1 elseif a.status == 'blocked' then blocked = blocked + 1 end
  end
  local per = per_pane(app)
  local desks = 0
  for _, sp in ipairs(app.spaces) do
    for _, tab in ipairs(sp.tab_list or {}) do desks = desks + #desks_of(tab, per) end
  end
  local function button(icon, label, f, active)
    return box { class = cls('hud-button', active and 'active'), title = label, onclick = function() f(); return true end,
      ui.icon { icon }, text { label } }
  end
  return box { id = 'hud',
    box { class = 'hud-me', onclick = function() pumi.cmd('projects'); return true end,
      box { class = 'hud-avatar', sprite('person1', 'hud-avatar-art') },
      box { class = 'hud-who', text { class = 'hud-name', 'You' }, text { class = 'hud-space', app.space and app.space.label or 'No session' } },
    },
    box { class = 'hud-sep' },
    button('plus', 'New desk', function() pumi.cmd('new_tab') end),
    button('split', 'A desk for every pane',
      function() pumi.cmd('set_setting', 'desk_per_pane', not per) end, per),
    button('package', 'Plugins', function() O.shelf = not O.shelf end, O.shelf),
    button('settings', 'Settings', function() pumi.cmd('settings') end),
    next(S.desks) and button('blocks', 'Tidy up', function() S.desks = {} end) or nil,
    C.Spacer(),
    text { class = 'hud-count rooms', title = 'Sessions and desks', tostring(#app.spaces) .. ' sessions · ' .. tostring(desks) .. ' desks' },
    C.Slot(app, 'statusline', 'hud-view'),
    working > 0 and box { class = 'hud-count working', title = working .. ' working', C.Dot('working'), text { tostring(working) } } or nil,
    blocked > 0 and box { class = 'hud-count blocked', title = blocked .. ' blocked',
      onclick = function() pumi.cmd('next_agent'); return true end, C.Dot('blocked'), text { tostring(blocked) } } or nil,
    text { class = 'hud-clock', app.clock },
  }
end

function C.Office(app)
  local p = plan(app)
  -- The room keeps itself up to date: a desk shows a screen, and screens move.
  if not O.ticking then
    O.ticking = true
    ui.every(TICK_MS, function() ui.refresh() end)
  end
  return box { id = 'office', class = cls(app.window.active and 'active' or 'inactive'),
    onclick = function() O.shelf = false end,
    C.Room(p),
    O.shelf and C.Shelf(app) or nil,
    O.sitting and C.Monitor(app) or nil,
    C.Rename(app),
    C.Hud(app),
  }
end

return {
  attach = 'all',
  -- Settings → Office Settings. The bar's "A desk for every pane" is this, flipped.
  settings = {
    { name = 'desk_per_pane', type = 'boolean', default = false, label = 'A desk for every pane',
      desc = 'Each pane of a split tab gets a desk, an agent and a screen of its own, instead of one desk whose screen holds the whole tab.' },
  },
  colors = {
    floor = '#efe3cf', wall = '#6c74a8', ink = '#2b2d42', paper = '#ffffff', pill = '#1d1f2bd9',
    hud = '#1d1f2b', hud_text = '#e9eaf2', hud_muted = '#9a9db3', online = '#4ade80',
    lit = '#5aa9ff', working = '#ffd166', blocked = '#ef476f', done = '#06d6a0',
    -- The app's own tokens: the office's blue for what is chosen and what to press.
    accent = '#5aa9ff', primary = '#5aa9ff', primary_hover = '#3d8ce8', primary_active = '#2f78cc',
    primary_foreground = '#ffffff', focus_ring = '#5aa9ff',
  },
  -- Soft and round, like the room.
  metrics = { radius = 7, radius_sm = 5, radius_lg = 10, control_height = 30 },
  components = C,
  render = function(app) return C.Office(app) end,
}

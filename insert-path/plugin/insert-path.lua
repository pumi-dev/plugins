-- insert-path: type the trigger key (a bare `/` by default) in a terminal and a floating picker
-- opens over the tab: the files of the pane's directory, fuzzy-filtered, with the path typed into
-- the terminal when you pick one. The picker itself is `ui/`; this half declares its options,
-- binds the key, and opens the float.
--
-- A bare `/` is also a path, a URL and a search: Escape or Backspace on an empty query closes the
-- picker and types the slash you meant to type. Set `insert_path.trigger` to a chord (for example
-- `<D-/>`) to get the picker with no slash behind it.
local api = pumi.api

local GROUP = 'Insert path'

local function opt(name, spec)
  spec.group = GROUP
  pcall(api.pumi_create_option, 'insert_path.' .. name, spec)
end

opt('trigger', {
  type = 'string', default = '/', label = 'Trigger', placeholder = '/',
  desc = 'The key that opens the picker in a terminal. A chord such as <D-/> or a sequence works too.',
})
opt('quote', {
  type = 'boolean', default = true, label = 'Quote paths',
  desc = 'Wrap a path in single quotes when the shell would split it, so it types as one argument.',
})
opt('height', {
  type = 'number', default = 18, min = 6, max = 40, step = 1, unit = 'rows', label = 'Height',
  desc = 'How many terminal rows tall the picker is.',
})

local function value(name)
  local got = api.pumi_get_option_value('insert_path.' .. name, {})
  return got
end

local M = {}

--- The picker's pane, if one is open.
function M.picker()
  for _, pane in ipairs(api.pumi_list_panes({ type = 'insert-path.picker' })) do
    return pane
  end
end

--- Close the picker, wherever it is.
function M.close()
  local pane = M.picker()
  if pane then
    pcall(api.pumi_pane_close, pane, true)
  end
end

--- What the picker starts from: the current pane, its directory, and the options it draws with.
local function context(pane)
  local trigger = value('trigger')
  if type(trigger) ~= 'string' or trigger == '' then
    trigger = '/'
  end
  local cwd = api.pumi_get_option_value('pane_current_path', { pane = pane })
  return {
    pane = pane,
    cwd = type(cwd) == 'string' and cwd or nil,
    trigger = trigger,
    quote = value('quote') ~= false,
    height = value('height'),
    -- A bare key was typed to get here, so closing without a pick types it back. A chord was
    -- not, so there is nothing to type back.
    cancel = trigger:find('^%S$') and trigger or nil,
  }
end

--- Open the picker over the tab of a pane (the event's pane, or the current one).
function M.open(ev)
  local pane = type(ev) == 'table' and ev.pane or nil
  if type(pane) ~= 'number' then
    pane = api.pumi_get_current_pane()
  end
  if type(pane) ~= 'number' then
    pumi.notify('insert-path: no pane to pick a path for', 'error')
    return false
  end
  M.close()
  local ctx = context(pane)
  local height = tonumber(ctx.height) or 18
  local ok, err = pcall(api.pumi_open_pane, 'insert-path.picker', ctx, {
    kind = 'float',
    width = '60%',
    height = height,
    zindex = 60,
    -- The terminal stays the current pane: the picker only takes the keyboard.
    focus = false,
  })
  if not ok then
    pumi.notify('insert-path: ' .. tostring(err), 'error')
    return false
  end
  return true
end

--- Bind `insert_path.trigger` in the terminal's key table, and unbind the last one.
local bound = nil
function M.bind()
  local trigger = value('trigger')
  if type(trigger) ~= 'string' or trigger == '' then
    trigger = '/'
  end
  if bound == trigger then
    return
  end
  if bound then
    pcall(api.pumi_del_keymap, 'terminal', bound)
  end
  pcall(api.pumi_set_keymap, 'terminal', trigger, '', {
    desc = 'Insert a path…',
    callback = M.open,
  })
  bound = trigger
end

M.bind()

pcall(api.pumi_create_autocmd, 'OptionSet', {
  pattern = 'insert_path.*',
  desc = 'insert-path follows its options',
  callback = function()
    M.bind()
  end,
})

pcall(api.pumi_create_function, 'insert_path.open', {
  desc = 'Open the path picker over the current tab.',
  examples = { { args = {} } },
}, function()
  return M.open({})
end)

package.loaded['insert-path'] = M
return M

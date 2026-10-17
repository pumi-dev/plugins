-- pi-session: a bar on every pi pane (`pi-session.strip`, its view in `ui/`) with Fork, which
-- opens `pi --fork <session>` beside it, and Copy, which copies the session's id and path.
-- A pane is pi's when its agent's hook said so: `@agent` is `pi` and `@agent_session` is set
-- (`pumi skill setup pi`).
local api = pumi.api

local function opt(name, spec)
  spec.group = 'Pi session'
  pcall(api.pumi_create_option, 'pi_session.' .. name, spec)
end
opt('side', { type = 'string', default = 'right', choices = { 'right', 'down' }, labels = { 'To the right', 'Below' },
  label = 'Open the fork', desc = 'Where the new pane goes, beside the one forked.' })
opt('focused_only', { type = 'boolean', default = false, label = 'Only on the focused pane',
  desc = 'Show the bar on the focused pi pane alone.' })
opt('command', { type = 'string', default = 'pi', label = 'pi command',
  desc = 'The program run with `--fork <session>`.' })

local M = {}

--- Whether `pane` runs pi in a conversation the hook named.
function M.is_pi(pane)
  local p = pumi.p[pane]
  return p.agent == 'pi' and type(p.agent_session) == 'string' and p.agent_session ~= ''
end

--- Every pi pane has its bar (or only the current one, with `focused_only`), and no other
--- pane has one.
function M.sync()
  local bars = {}
  for _, bar in ipairs(api.pumi_list_panes({ type = 'pi-session.strip' })) do
    local owner = api.pumi_pane_get_place(bar).owner
    if owner then
      bars[owner] = bar
    end
  end
  local only = pumi.o['pi_session.focused_only'] and api.pumi_get_current_pane() or nil
  for _, pane in ipairs(api.pumi_list_panes({ type = 'terminal' })) do
    local wanted = M.is_pi(pane) and (only == nil or only == pane)
    if wanted and not bars[pane] then
      pcall(api.pumi_open_pane, 'pi-session.strip', { pane = pane },
        { kind = 'slot', slot = 'winbar', owner = pane, focus = false })
    elseif not wanted and bars[pane] then
      pcall(api.pumi_pane_close, bars[pane], true)
    end
    bars[pane] = nil
  end
  for _, bar in pairs(bars) do
    pcall(api.pumi_pane_close, bar, true)
  end
end

local group = api.pumi_create_augroup('pi_session', { clear = true })
api.pumi_create_autocmd('OptionSet', {
  group = group,
  pattern = { '@agent', '@agent_session', 'pi_session.focused_only' },
  desc = 'pi panes get their bar',
  callback = function() pumi.schedule(M.sync) end,
})
api.pumi_create_autocmd('PaneEnter', {
  group = group,
  desc = 'the bar follows the focus',
  callback = function()
    if pumi.o['pi_session.focused_only'] then
      pumi.schedule(M.sync)
    end
  end,
})

M.sync()
package.loaded['pi-session'] = M
return M

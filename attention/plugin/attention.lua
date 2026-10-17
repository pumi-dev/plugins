-- attention: tell the user when an agent is blocked and they are looking elsewhere (05 §5).
-- An agent's state is its pane's `@agent_state` (what agents' hooks set: `pumi set -p
-- @agent_state blocked`). While any is blocked, `@attention` is how many, and a notice says so
-- once each time the count goes up. The Dock bounce and the badge come with the system mod
-- (phase 4); until then they are `@attention` and the notice.
local api = pumi.api

pcall(api.pumi_create_option, 'attention.bounce', {
  type = 'string',
  default = 'once',
  choices = { 'none', 'once', 'until_focus' },
  desc = 'Bounce the Dock icon when an agent is blocked and the app is in the background.',
})
pcall(api.pumi_create_option, 'attention.badge', {
  type = 'boolean',
  default = false,
  desc = 'Badge the icon with how many agents are blocked.',
})

local M = { waiting = 0 }

local function blocked()
  local n = 0
  for _, pane in ipairs(api.pumi_list_panes({})) do
    if pumi.p[pane].agent_state == 'blocked' then
      n = n + 1
    end
  end
  return n
end

function M.update()
  local now = blocked()
  if now > M.waiting and pumi.o['attention.bounce'] ~= 'none' then
    pumi.notify(now == 1 and 'An agent is waiting for you' or (now .. ' agents are waiting for you'), pumi.log.levels.WARN)
  end
  M.waiting = now
  pumi.g.attention = now > 0 and now or pumi.NIL
end

local group = api.pumi_create_augroup('attention', { clear = true })
api.pumi_create_autocmd({ 'OptionSet' }, {
  group = group,
  pattern = { '@agent_state', 'attention.*' },
  callback = M.update,
})
api.pumi_create_autocmd({ 'PaneClosed' }, { group = group, callback = M.update })

package.loaded.attention = M
return M

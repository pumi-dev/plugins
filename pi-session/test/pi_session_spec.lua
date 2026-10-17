-- pumi --headless --clean -l pi-session/test/pi_session_spec.lua
local t = require('pumi.test')
local here = debug.getinfo(1, 'S').source:sub(2):match('^(.*)/test/') or 'pi-session'
pumi.cmd('source-file ' .. here .. '/plugin/pi-session.lua')

local session = pumi.api.pumi_create_session({ name = 'a', pane = { type = 'terminal', args = { command = { 'cat' } } } })
local pane = pumi.api.pumi_list_panes({ session = session })[1]

local function bars()
  local out = {}
  for _, bar in ipairs(pumi.api.pumi_list_panes({ type = 'pi-session.strip' })) do
    local place = pumi.api.pumi_pane_get_place(bar)
    out[#out + 1] = place.name .. ':' .. tostring(place.owner)
  end
  return table.concat(out, ',')
end

t.describe('pi-session', function()
  t.it('leaves other panes alone', function()
    t.eq('', bars())
  end)
  t.it('puts a bar on a pi pane once its hook names the session', function()
    pumi.p[pane].agent = 'pi'
    pumi.p[pane].agent_session = '0198c3e2-7a51-7c62-9a53-3f1a2b4c5d6e'
    t.wait_for(function() return bars() == 'winbar:' .. pane end, 2000, 'a winbar on the pane')
  end)
  t.it('takes it away when the pane is not pi any more', function()
    pumi.p[pane].agent = 'claude'
    t.wait_for(function() return bars() == '' end, 2000, 'no bar')
  end)
end)

t.done()

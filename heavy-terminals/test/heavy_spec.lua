-- pumi --headless --clean -l heavy-terminals/test/heavy_spec.lua
local t = require('pumi.test')
local here = debug.getinfo(1, 'S').source:sub(2):match('^(.*)/test/') or 'heavy-terminals'

-- Fast checks and a low bar, so a busy loop is heavy at once.
pumi.cmd('source-file ' .. here .. '/plugin/heavy-terminals.lua')
pumi.o['heavy_terminals.cpu'] = 30
pumi.o['heavy_terminals.sustain'] = 2
pumi.o['heavy_terminals.auto_sleep'] = true
pumi.o['heavy_terminals.interval'] = 0.3

local session = pumi.api.pumi_create_session({ name = 'h' })
local pane = pumi.api.pumi_list_panes({ session = session })[1]

t.describe('heavy-terminals', function()
  t.it('finds a busy terminal and puts it to sleep', function()
    pumi.cmd.send_keys({ t = pane, 'while :; do :; done', 'Enter' })
    t.wait_for(function()
      return pumi.p[pane].heavy == 'asleep'
    end, 10000, 'the pane to be put to sleep')
  end)
  t.it('wakes it with HeavyWake', function()
    pumi.cmd('HeavyWake %' .. pane)
    t.eq(nil, pumi.p[pane].heavy)
    pumi.cmd.send_keys({ t = pane, 'C-c' })
  end)
end)

t.done()

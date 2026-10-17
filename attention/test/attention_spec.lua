-- pumi --headless --clean -l attention/test/attention_spec.lua
local t = require('pumi.test')
local here = debug.getinfo(1, 'S').source:sub(2):match('^(.*)/test/') or 'attention'
pumi.cmd('source-file ' .. here .. '/plugin/attention.lua')

local session = pumi.api.pumi_create_session({ name = 'a' })
local panes = pumi.api.pumi_list_panes({ session = session })

t.describe('attention', function()
  t.it('counts the blocked agents', function()
    pumi.p[panes[1]].agent_state = 'blocked'
    t.wait_for(function()
      return pumi.g.attention == 1
    end, 2000, '@attention to be 1')
  end)
  t.it('says so once', function()
    t.matches('An agent is waiting for you', pumi.cmd('show-messages'))
  end)
  t.it('clears when it is unblocked', function()
    pumi.p[panes[1]].agent_state = 'working'
    t.wait_for(function()
      return pumi.g.attention == nil
    end, 2000, '@attention to clear')
  end)
end)

t.done()

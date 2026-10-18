-- pumi --headless --clean -l insert-path/test/insert_path_spec.lua
local t = require('pumi.test')
local here = debug.getinfo(1, 'S').source:sub(2):match('^(.*)/test/') or 'insert-path'
pumi.cmd('source-file ' .. here .. '/plugin/insert-path.lua')

local api = pumi.api
local session = api.pumi_create_session({ name = 'insert-path' })
local panes = api.pumi_list_panes({ session = session })
local term = panes[1]

local function picker_panes()
  return api.pumi_list_panes({ type = 'insert-path.picker' })
end

t.describe('insert-path', function()
  t.it('declares its options', function()
    t.eq('/', api.pumi_get_option_value('insert_path.trigger', {}))
    t.eq(true, api.pumi_get_option_value('insert_path.quote', {}))
    t.eq(18, api.pumi_get_option_value('insert_path.height', {}))
  end)

  t.it('binds the trigger in the terminal key table', function()
    local bound = nil
    for _, binding in ipairs(api.pumi_get_keymap('terminal')) do
      if binding.key == '/' then
        bound = binding
      end
    end
    t.ok(bound ~= nil, 'a / binding in the terminal table')
    t.eq('Insert a path…', bound.desc)
  end)

  t.it('opens a floating picker for the pane', function()
    local got = api.pumi_input('/', { pane = term })
    t.eq('command', got.action, 'the key is the mapping, not the terminal')
    t.wait_for(function()
      return #picker_panes() == 1
    end, 2000, 'the picker to open')
    t.eq('float', api.pumi_pane_get_place(picker_panes()[1]).kind)
  end)

  t.it('keeps one picker open however often it is asked', function()
    api.pumi_input('/', { pane = term })
    t.wait_for(function()
      return #picker_panes() == 1
    end, 2000, 'still one picker')
  end)

  t.it('closes', function()
    api.pumi_pane_close(picker_panes()[1], true)
    t.wait_for(function()
      return #picker_panes() == 0
    end, 2000, 'the picker to close')
  end)

  t.it('rebinds when the trigger option changes', function()
    api.pumi_set_option_value('insert_path.trigger', '<D-/>')
    t.wait_for(function()
      for _, binding in ipairs(api.pumi_get_keymap('terminal')) do
        if binding.key == 'D-/' then
          return true
        end
      end
      return false
    end, 2000, 'the chord to be bound')
    for _, binding in ipairs(api.pumi_get_keymap('terminal')) do
      t.ok(binding.key ~= '/', 'the bare / is unbound again')
    end
    api.pumi_set_option_value('insert_path.trigger', '/')
  end)
end)

t.done()

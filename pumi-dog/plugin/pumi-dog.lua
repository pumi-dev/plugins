-- pumi-dog: a little pumi that walks along the status bar (its view is `ui/`). This places
-- it and declares its options; `pumi_dog.toggle` takes it away and brings it back.
local api = pumi.api

local function opt(name, spec)
  spec.group = 'Pumi dog'
  pcall(api.pumi_create_option, 'pumi_dog.' .. name, spec)
end
opt('speed', { type = 'number', default = 8, min = 2, max = 16, step = 1, unit = 'fps', label = 'Speed', control = 'slider',
  desc = 'Animation frames per second. Lower is calmer and cheaper.' })
opt('track', { type = 'number', default = 140, min = 40, max = 600, unit = 'px', label = 'Walking room',
  desc = 'How much of the status bar the dog walks along.' })
opt('size', { type = 'number', default = 20, min = 12, max = 32, step = 1, unit = 'px', label = 'Size', control = 'slider',
  desc = "The dog's height." })

local M = {}

--- The dog's pane, if it is out.
function M.pane()
  for _, id in ipairs(api.pumi_list_panes({ type = 'pumi-dog.dog' })) do
    return id
  end
end

function M.show()
  if not M.pane() then
    api.pumi_open_pane('pumi-dog.dog', {}, { kind = 'slot', slot = 'statusline', order = 1000, focus = false })
  end
end

function M.toggle()
  local pane = M.pane()
  if pane then
    api.pumi_pane_close(pane, true)
  else
    M.show()
  end
end

pcall(api.pumi_create_function, 'pumi_dog.toggle', {
  desc = 'Show or hide the dog.',
  callback = M.toggle,
})

M.show()
package.loaded['pumi-dog'] = M
return M

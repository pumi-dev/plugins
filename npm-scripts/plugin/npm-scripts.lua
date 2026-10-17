-- npm-scripts: every package.json in the current pane's repository and the scripts it defines,
-- as a page in the left sidebar (its view is `ui/`). Click a script to run it in a terminal.
local api = pumi.api

local function opt(name, spec)
  spec.group = 'NPM Scripts'
  pcall(api.pumi_create_option, 'npm_scripts.' .. name, spec)
end
opt('show_command', { type = 'boolean', default = true, label = 'Commands',
  desc = 'Show what each script runs, beside its name.' })
opt('sort', { type = 'string', default = 'path', choices = { 'path', 'scripts' }, labels = { 'Path', 'Most scripts first' },
  label = 'Order packages by', desc = 'How the package.json files are listed.' })
opt('max_depth', { type = 'number', default = 4, min = 1, max = 10, step = 1, label = 'Depth',
  desc = 'How many directories below the repository root to look in.' })

if #api.pumi_list_panes({ type = 'npm-scripts.scripts' }) == 0 then
  local pane = api.pumi_open_pane('npm-scripts.scripts', {}, { kind = 'slot', slot = 'sidebar.left', order = 30, focus = false })
  api.pumi_set_option_value('title', 'NPM Scripts', { pane = pane })
  api.pumi_set_option_value('@icon', 'package', { pane = pane })
end

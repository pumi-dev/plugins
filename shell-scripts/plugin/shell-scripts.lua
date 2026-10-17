-- shell-scripts: every shell script in the current pane's repository, as a page in the left
-- sidebar (its view is `ui/`). Click a script to run it, in its directory, with its shell.
local api = pumi.api

local function opt(name, spec)
  spec.group = 'Shell Scripts'
  pcall(api.pumi_create_option, 'shell_scripts.' .. name, spec)
end
opt('show_command', { type = 'boolean', default = true, label = 'Commands',
  desc = 'Show how each script runs, beside its name.' })
opt('max_depth', { type = 'number', default = 4, min = 1, max = 10, step = 1, label = 'Depth',
  desc = 'How many directories below the repository root to look in.' })
opt('extensions', { type = 'string', default = 'sh, bash, zsh, ksh, fish', label = 'Extensions',
  desc = 'Which file extensions are scripts, separated by commas.' })
opt('shebang', { type = 'boolean', default = true, label = '#! files',
  desc = 'Also list files with no extension whose first line names a shell.' })

if #api.pumi_list_panes({ type = 'shell-scripts.scripts' }) == 0 then
  local pane = api.pumi_open_pane('shell-scripts.scripts', {}, { kind = 'slot', slot = 'sidebar.left', order = 31, focus = false })
  api.pumi_set_option_value('title', 'Shell Scripts', { pane = pane })
  api.pumi_set_option_value('@icon', 'terminal', { pane = pane })
end

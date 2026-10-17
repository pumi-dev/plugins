-- heavy-terminals: notice terminals whose processes eat the machine, and put them to sleep: the
-- foreground job is suspended as ctrl+z would, and woken with fg (05 §5).
local api = pumi.api

local function opt(name, spec)
  pcall(api.pumi_create_option, 'heavy_terminals.' .. name, spec)
end
opt('interval', { type = 'number', default = 5, desc = 'How often every terminal is measured, in seconds.' })
opt('cpu', { type = 'number', default = 150, desc = 'A terminal using more CPU than this (100 is one core) is heavy.' })
opt('memory', { type = 'number', default = 4096, desc = 'A terminal holding more memory than this, in MB, is heavy.' })
opt('sustain', { type = 'number', default = 3, desc = 'How many checks in a row it must be heavy for.' })
opt('auto_sleep', { type = 'boolean', default = false, desc = 'Suspend its foreground job right away.' })

local M = { watches = {}, sleeping = {} }

local function o(name)
  return pumi.o['heavy_terminals.' .. name]
end

--- Every process: pid → {ppid, cpu seconds, rss bytes}.
function M.processes()
  local r = pumi.system({ 'ps', '-A', '-o', 'pid=,ppid=,time=,rss=' }):wait()
  local procs = {}
  for line in (r.stdout or ''):gmatch('[^\n]+') do
    local pid, ppid, time, rss = line:match('^%s*(%d+)%s+(%d+)%s+(%S+)%s+(%d+)')
    if pid then
      local secs = 0
      local days, rest = time:match('^(%d+)-(.*)$')
      if days then
        secs = tonumber(days) * 86400
        time = rest
      end
      local parts = pumi.split(time, ':')
      local mult = 1
      for i = #parts, 1, -1 do
        secs = secs + (tonumber(parts[i]) or 0) * mult
        mult = mult * 60
      end
      procs[tonumber(pid)] = { ppid = tonumber(ppid), cpu = secs, rss = tonumber(rss) * 1024 }
    end
  end
  return procs
end

--- A pane's processes together: CPU seconds and bytes.
local function usage(procs, root)
  local children = {}
  for pid, p in pairs(procs) do
    children[p.ppid] = children[p.ppid] or {}
    table.insert(children[p.ppid], pid)
  end
  local cpu, rss = 0, 0
  local todo = { root }
  while #todo > 0 do
    local pid = table.remove(todo)
    local p = procs[pid]
    if p then
      cpu, rss = cpu + p.cpu, rss + p.rss
    end
    for _, c in ipairs(children[pid] or {}) do
      todo[#todo + 1] = c
    end
  end
  return cpu, rss
end

function M.sleep(pane)
  api.pumi_cmd('send-keys -t %' .. pane .. ' C-z', {})
  M.sleeping[pane] = true
  pumi.p[pane].heavy = 'asleep'
end

function M.wake(pane)
  api.pumi_cmd('send-keys -t %' .. pane .. ' fg Enter', {})
  M.sleeping[pane] = nil
  pumi.p[pane].heavy = pumi.NIL
end

--- Measures every terminal once; a heavy one is marked `@heavy`, and slept when asked.
function M.check()
  local procs = M.processes()
  local now = pumi.uv.now()
  local seen = {}
  for _, pane in ipairs(api.pumi_list_panes({ type = 'terminal' })) do
    seen[pane] = true
    local pid = pumi.po[pane].pane_pid
    if pid and pid ~= pumi.NIL then
      local cpu, rss = usage(procs, pid)
      local w = M.watches[pane] or { strikes = 0 }
      M.watches[pane] = w
      local percent = w.at and ((cpu - w.cpu) / ((now - w.at) / 1000) * 100) or 0
      w.at, w.cpu, w.percent, w.rss = now, cpu, percent, rss
      local heavy = percent > o('cpu') or rss > o('memory') * 1024 * 1024
      if heavy and not M.sleeping[pane] then
        w.strikes = w.strikes + 1
        if w.strikes >= o('sustain') and not w.alerted then
          w.alerted = true
          pumi.p[pane].heavy = ('%d%% cpu, %d MB'):format(percent, rss / 1048576)
          pumi.notify(('%%%d is heavy: %d%% cpu, %d MB'):format(pane, percent, rss / 1048576), pumi.log.levels.WARN)
          if o('auto_sleep') then
            M.sleep(pane)
          end
        end
      elseif not heavy then
        w.strikes, w.alerted = 0, false
      end
    end
  end
  for pane in pairs(M.watches) do
    if not seen[pane] then
      M.watches[pane], M.sleeping[pane] = nil, nil
    end
  end
end

local timer = pumi.uv.new_timer()
function M.start()
  timer:start(0, o('interval') * 1000, M.check)
end
M.start()

api.pumi_create_autocmd('OptionSet', {
  pattern = 'heavy_terminals.interval',
  callback = function()
    M.start()
  end,
})
pcall(api.pumi_create_user_command, 'HeavySleep', function(a)
  M.sleep(tonumber((a.args:gsub('%%', ''))) or api.pumi_get_current_pane())
end, { nargs = '?', desc = 'Suspend a terminal\'s foreground job, as ctrl+z would.' })
pcall(api.pumi_create_user_command, 'HeavyWake', function(a)
  M.wake(tonumber((a.args:gsub('%%', ''))) or api.pumi_get_current_pane())
end, { nargs = '?', desc = 'Wake a terminal put to sleep.' })

package.loaded['heavy-terminals'] = M
return M

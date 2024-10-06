let s:initialized = v:false
let s:delay = 15
let s:hlgroup = 'CopilotSuggestion'
let s:annot_hlgroup = 'CopilotAnnotation'
let s:timer = -1

function! lspoints#extension#copilot#accept(options = {}) abort
  call lspoints#denops#notify('executeCommand', ['copilot', 'accept', a:options])
endfunction

function! lspoints#extension#copilot#on_filetype() abort
  let b:copilot_disabled = v:true
  if &l:modifiable && &l:buflisted
    call lspoints#attach('copilot')
  endif
endfunction

function! lspoints#extension#copilot#on_insert_leave_pre() abort
  call s:clear()
endfunction

function! lspoints#extension#copilot#on_insert_enter() abort
  call s:schedule()
endfunction

function! lspoints#extension#copilot#on_cursor_movedi() abort
  call s:schedule()
endfunction

function s:schedule() abort
  if exists('b:__copilot')
    " Wait for drawing to avoid screen flickering
    call lspoints#denops#request('executeCommand', ['copilot', 'drawPreview', b:__copilot])
  endif
  call timer_stop(s:timer)
  let s:timer = timer_start(s:delay, function('s:trigger', [bufnr()]))
endfunction

function! s:trigger(bufnr, timer) abort
  if a:bufnr !=# bufnr() || a:timer !=# s:timer || mode() !=# 'i'
    return
  endif
  let s:timer = -1
  call lspoints#extension#copilot#suggest()
endfunction

function! lspoints#extension#copilot#on_buf_enter() abort
  if !denops#plugin#is_loaded('lspoints')
    call lspoints#denops#register()
  endif
  call lspoints#denops#notify('executeCommand', ['copilot', 'notifyDidFocus', bufnr()])
endfunction

function! lspoints#extension#copilot#initialize() abort
  if s:initialized || g:->get('lspoints#extensions', [])->index('copilot') < 0
    return
  endif
  call lspoints#start('copilot')
  if !has('nvim')
    if empty(prop_type_get(s:hlgroup))
      call prop_type_add(s:hlgroup, #{ highlight: s:hlgroup })
    endif
    if empty(prop_type_get(s:annot_hlgroup))
      call prop_type_add(s:annot_hlgroup, #{ highlight: s:annot_hlgroup })
    endif
  endif
  let s:initialized = v:true
endfunction

function! lspoints#extension#copilot#suggest() abort
  if !denops#plugin#is_loaded('lspoints')
    call lspoints#denops#register()
  endif
  call lspoints#denops#notify('executeCommand', ['copilot', 'suggest'])
endfunction

function! s:mod(n, m) abort
  return ((a:n % a:m) + a:m) % a:m
endfunction

function! s:cycling(delta) abort
  if !exists('b:__copilot')
    return
  endif
  if !b:__copilot->has_key('cyclingDeltas')
    " Request calculation
    let b:__copilot.cyclingDeltas = [a:delta]
    call lspoints#denops#notify('executeCommand', ['copilot', 'suggestCycling', b:__copilot])
  elseif b:__copilot.cyclingDeltas->len()
    " Caluculation is in progress, increment the delta
    let b:__copilot.cyclingDeltas += [a:delta]
  else
    " Calcualtion has been completed, only draw preview
    let b:__copilot.selected = s:mod(b:__copilot.selected + a:delta, len(b:__copilot.candidates))
    call lspoints#denops#notify('executeCommand', ['copilot', 'drawPreview', b:__copilot])
  endif
endfunction

function! lspoints#extension#copilot#next() abort
  call s:cycling(1)
endfunction

function! lspoints#extension#copilot#prev() abort
  call s:cycling(-1)
endfunction

function! lspoints#extension#copilot#dismiss() abort
  call s:clear()
endfunction

function! s:clear() abort
  call timer_stop(s:timer)
  let s:timer = -1
  call lspoints#denops#notify('executeCommand', ['copilot', 'abortRequest'])
  call lspoints#denops#notify('executeCommand', ['copilot', 'clearPreview'])
  unlet! b:__copilot
endfunction

function! lspoints#extension#copilot#command_completion(...) abort
  return ['disable', 'enable', 'signin', 'signout', 'status', 'version', 'feedback']->join("\n")
endfunction

if has('nvim')
  function! lspoints#extension#copilot#popup_user_code(params) abort
    let [code, lambda, bufnr, winid] = a:params
    let [@*, @+] = [code, code]
    call nvim_win_set_config(winid, #{ focusable: v:true, style: 'minimal' })
    call nvim_set_current_win(winid)
    call nvim_buf_set_lines(bufnr, 0, -1, v:true, [
          \ 'Your one-time code: ' .. code,
          \ '(already copied to system clipboard if provider is available)',
          \ '',
          \ 'Press <CR> to open GitHub in your browser',
          \ ])
    setlocal filetype=copilotauth nomodified nomodifiable
    execute printf('nnoremap <buffer> <CR> <Cmd>call lspoints#denops#notify("%s", [])<CR>', lambda)
  endfunction
else
  function! s:filter(lambda, winid, key) abort
    if a:key ==# "\<CR>"
      call lspoints#denops#notify(a:lambda, [])
      return v:true
    endif
    return v:false
  endfunction

  function! lspoints#extension#copilot#popup_user_code(params) abort
    let [code, lambda, bufnr, winid] = a:params
    let [@*, @+] = [code, code]
    call popup_settext(winid, [
          \ 'Your one-time code: ' .. code,
          \ '(already copied to system clipboard if supported)',
          \ '',
          \ 'Press <CR> to open GitHub in your browser',
          \ ])
    call popup_setoptions(winid, #{
          \ filter: function('s:filter', [lambda]),
          \ filtermode: 'n',
          \ })
    call setbufvar(bufnr, '&filetype', 'copilotauth')
    redraw
  endfunction
endif

let s:initailized = v:false
let s:delay = 15
let s:hlgroup = 'CopilotSuggestion'
let s:annot_hlgroup = 'CopilotAnnotation'
let s:timer = -1

if has('nvim')
  let s:ns = nvim_create_namespace('lspoints-extension-copilot')
else
  if empty(prop_type_get(s:hlgroup))
    call prop_type_add(s:hlgroup, #{ highlight: s:hlgroup })
  endif
  if empty(prop_type_get(s:annot_hlgroup))
    call prop_type_add(s:annot_hlgroup, #{ highlight: s:annot_hlgroup })
  endif
endif

" let annot = exists('b:__copilot.cycling_callbacks') ?
"      \   '(1/…)'
"      \ : exists('b:__copilot.cycling') ?
"      \   '(' .. (b:__copilot.selected + 1) .. '/' .. len(b:__copilot.candidates) .. ')'
"      \ : ''

function! lspoints#extension#copilot#accept(options = {}) abort
  call lspoints#denops#notify('executeCommand', ['copilot', 'accept', a:options])
endfunction

function! lspoints#extension#copilot#on_filetype() abort
  " NOTE: Check b:copilot_disabled until the plugin is improved enough to replace copilot.vim
  if b:->get('copilot_disabled', v:false) && &l:modifiable && &l:buflisted
    call lspoints#attach('copilot')
  endif
endfunction

function! lspoints#extension#copilot#on_insert_leave_pre() abort
  call lspoints#denops#notify('executeCommand', ['copilot', 'clearPreview'])
endfunction

function! lspoints#extension#copilot#on_insert_enter() abort
  call s:schedule()
endfunction

function! lspoints#extension#copilot#on_cursor_moved() abort
  call s:schedule()
endfunction

function s:schedule() abort
  call lspoints#denops#notify('executeCommand', ['copilot', 'drawPreview'])
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

function! lspoints#extension#copilot#on_buf_unload() abort
endfunction

function! lspoints#extension#copilot#initalize() abort
  if !s:initailized && g:->get('lspoints#extensions', [])->index('copilot') > -1
    call lspoints#start('copilot')
    let s:initailized = v:true
  endif
endfunction

function! lspoints#extension#copilot#suggest() abort
  if !denops#plugin#is_loaded('lspoints')
    call lspoints#denops#register()
  endif
  call lspoints#denops#notify('executeCommand', ['copilot', 'suggest'])
endfunction

function! lspoints#extension#copilot#next() abort
  throw 'Not Implemented Yet'
endfunction

function! lspoints#extension#copilot#prev() abort
  throw 'Not Implemented Yet'
endfunction

function! lspoints#extension#copilot#dismiss() abort
  call timer_stop(s:timer)
  unlet! b:__copilot
  call lspoints#denops#notify('executeCommand', ['copilot', 'drawPreview'])
endfunction

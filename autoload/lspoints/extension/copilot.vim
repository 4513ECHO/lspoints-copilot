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

function! s:get_current_candidate() abort
  if !exists('b:__copilot') || mode() !~# '^[iR]' || pumvisible() || empty(b:__copilot.candidates)
    return v:null
  endif
  let selected = b:__copilot.candidates->get(b:__copilot.selected, {})
  if !selected->has_key('range') || selected.range.start.line != line('.') - 1 || selected.range.start.character !=# 0
    return v:null
  endif
  return selected
endfunction

function! s:get_display_adjustment(candidate) abort
  if empty(a:candidate)
    return ['', 0, 0]
  endif
  let line = getline('.')
  let offset = col('.') - 1
  let choice_text = strpart(line, 0, line->byteidx(a:candidate.range.start.character, v:true)) .. a:candidate.text->substitute("\n*$", '', '')
  let typed = line->strpart(0, offset)
  let end_offset = line->byteidx(a:candidate.range.end.character, v:true)
  if end_offset < 0
    let end_offset = len(line)
  endif
  let delete = line->strpart(offset, end_offset - offset)
  if typed =~# '^\s*$'
    let leading = choice_text->matchstr('^\s\+')
    let unindented = choice_text->strpart(len(leading))
    if typed->strpart(0, len(leading)) == leading && unindented !=# delete
      return [unindented, len(typed) - len(leading), strchars(delete)]
    endif
  elseif typed ==# choice_text->strpart(0, offset)
    return [choice_text->strpart(offset), 0, strchars(delete)]
  endif
  return ['', 0, 0]
endfunction

" TODO: Move this logic to TypeScript
function! lspoints#extension#copilot#draw_preview() abort
  let candidate = s:get_current_candidate() ?? {}
  let text = candidate->get('displayText', '')->split("\n", v:true)
  call lspoints#extension#copilot#clear_preview()
  if empty(candidate) || empty(text)
    return
  endif
  " let annot = exists('b:__copilot.cycling_callbacks') ?
  "      \   '(1/…)'
  "      \ : exists('b:__copilot.cycling') ?
  "      \   '(' .. (b:__copilot.selected + 1) .. '/' .. len(b:__copilot.candidates) .. ')'
  "      \ : ''
  let annot = ''
  let newline_pos = candidate.text->stridx("\n")
  let text[0] = candidate.text[col('.') - 1 : newline_pos > 0 ? newline_pos - 1 : -1]
  if has('nvim')
    let data = #{ id: 1, virt_text_win_col: virtcol('.') - 1, hl_mode: 'combine' }
    let data.virt_text = [[text[0], s:hlgroup]]
    if len(text) > 1
      let data.virt_lines = text[1:]->map({ -> [[v:val, s:hlgroup]] })
      if !empty(annot)
        let data.virt_lines[-1] += [[' '], [annot, s:annot_hlgroup]]
      endif
    elseif !empty(annot)
      let data.virt_text += [[' '], [annot, s:annot_hlgroup]]
    endif
    call nvim_buf_set_extmark(0, s:ns, line('.') - 1, col('.') - 1, data)
  else
    call prop_add(line('.'), col('.'), #{ type: s:hlgroup, text: text[0] })
    eval text[1:]->map({ ->
          \  prop_add(line('.'), 0, #{ type: s:hlgroup, text_align: 'below', text: v:val })
          \ })
    if !empty(annot)
      call prop_add(line('.'), col('$'), #{ type: s:annot_hlgroup, text: ' ' .. annot })
    endif
  endif
  if !b:__copilot.shownCandidates->has_key(candidate.uuid)
    let b:__copilot.shownCandidates[candidate.uuid] = v:true
    call lspoints#request('copilot', 'notifyShown', #{ uuid: candidate.uuid })
  endif
endfunction

if has('nvim')
  function! lspoints#extension#copilot#clear_preview() abort
    call nvim_buf_del_extmark(0, s:ns, 1)
  endfunction
else
  function! lspoints#extension#copilot#clear_preview() abort
    call prop_remove(#{ type: s:hlgroup, all: v:true })
    call prop_remove(#{ type: s:annot_hlgroup, all: v:true })
  endfunction
endif

function! lspoints#extension#copilot#accept(options = {}) abort
  let candidate = s:get_current_candidate()
  let [text, outdent, delete] = s:get_display_adjustment(candidate)
  if empty(candidate) || empty(text)
    return ''
  endif
  unlet! b:__copilot
  if a:options->has_key('pattern')
    let text = text->matchstr("\n*\\%(" .. a:options.pattern ..'\)')
          \ ->substitute("\n*$", '', '') ?? text
  endif
  call lspoints#request('copilot', 'notifyAccepted',
        \ #{ uuid: candidate.uuid, acceptedLength: strutf16len(text) })
  call lspoints#extension#copilot#clear_preview()
  " NOTE: Append <C-u> before <CR> to avoid auto-indentation
  eval [repeat("\<BS>", outdent), repeat("\<Del>", delete),
        \ text->substitute("\n", "\n\<C-u>", 'g'), a:options->has_key('pattern') ?  '' : "\<End>",
        \ ]->join('')->feedkeys('ni')
endfunction

function! lspoints#extension#copilot#on_insert_enter() abort
  " NOTE: Check b:copilot_disabled until the plugin is improved enough to replace copilot.vim
  if g:->get('lspoints#extensions', [])->index('copilot') < 0 || !b:->get('copilot_disabled', v:false)
    return
  endif
  call lspoints#attach('copilot')
  call s:schedule()
endfunction

function! lspoints#extension#copilot#on_cursor_moved() abort
  call s:schedule()
endfunction

function s:schedule() abort
  call lspoints#extension#copilot#draw_preview()
  call timer_stop(s:timer)
  let s:timer = timer_start(15, function('s:trigger', [bufnr('')]))
endfunction

function! s:trigger(bufnr, timer) abort
  if a:bufnr !=# bufnr('') || a:timer !=# s:timer || mode() !=# 'i'
    return
  endif
  let s:timer = -1
  call lspoints#extension#copilot#suggest()
endfunction

function! lspoints#extension#copilot#on_buf_unload() abort
  call s:reject(+expand('<abuf>'))
endfunction

function! s:reject(bufnr) abort
  let context = getbufvar(a:bufnr, '__copilot', {})
  if !empty(context->get('shownCandidates', {}))
    call lspoints#request('copilot', 'notifyRejected', #{ uuids: keys(context.shownCandidates) })
    let context.shownCandidates = {}
  endif
endfunction

function! lspoints#extension#copilot#suggest() abort
  call denops#plugin#wait_async('lspoints', { -> denops#notify('lspoints', 'executeCommand', ['copilot', 'suggest']) })
endfunction

function! lspoints#extension#copilot#next() abort
  throw 'Not Implemented Yet'
endfunction

function! lspoints#extension#copilot#prev() abort
  throw 'Not Implemented Yet'
endfunction

function! lspoints#extension#copilot#dismiss() abort
  call s:reject('%')
  call timer_stop(s:timer)
  unlet! b:__copilot
  call lspoints#extension#copilot#draw_preview()
endfunction

if exists('g:loaded_lspoints_extension_copilot')
  finish
endif
let g:loaded_lspoints_extension_copilot = v:true

function! s:on_colorscheme() abort
  hi def CopilotSuggestion ctermfg=244 guifg=#808080
  hi def link CopilotAnnotation Normal
endfunction

augroup lspoints_extension_copilot
  autocmd!
  autocmd ColorScheme * call s:on_colorscheme()
  autocmd InsertLeave * call lspoints#extension#copilot#clear_preview()
  autocmd InsertEnter * call lspoints#extension#copilot#on_insert_enter()
  autocmd CursorMovedI * call lspoints#extension#copilot#on_cursor_moved()
  autocmd BufUnload * call lspoints#extension#copilot#on_buf_unload()
augroup END

call s:on_colorscheme()

inoremap <Plug>(copilot-accept) <Cmd>call lspoints#extension#copilot#accept()<CR>
inoremap <Plug>(copilot-suggest) <Cmd>call lspoints#extension#copilot#suggest()<CR>
inoremap <Plug>(copilot-next) <Cmd>call lspoints#extension#copilot#next()<CR>
inoremap <Plug>(copilot-prev) <Cmd>call lspoints#extension#copilot#prev()<CR>
inoremap <Plug>(copilot-dismiss) <Cmd>call lspoints#extension#copilot#dismiss()<CR>

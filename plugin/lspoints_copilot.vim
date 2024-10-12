if exists('g:loaded_lspoints_copilot')
  finish
endif
let g:loaded_lspoints_copilot = v:true

function! s:on_colorscheme() abort
  hi def CopilotSuggestion ctermfg=244 guifg=#808080
  hi def link CopilotAnnotation Normal
endfunction

augroup lspoints_copilot
  autocmd!
  autocmd ColorScheme,VimEnter * call s:on_colorscheme()
  autocmd FileType * call lspoints#copilot#on_filetype()
  autocmd InsertLeavePre * call lspoints#copilot#on_insert_leave_pre()
  autocmd InsertEnter * call lspoints#copilot#on_insert_enter()
  autocmd CursorMovedI * call lspoints#copilot#on_cursor_movedi()
  autocmd BufEnter * call lspoints#copilot#on_buf_enter()
  autocmd VimEnter * call lspoints#copilot#initialize()
augroup END

command! -bar -nargs=+ -complete=custom,lspoints#copilot#command_completion
      \ Copilot call lspoints#denops#notify('executeCommand', ['copilot', 'command', [<f-args>]])

inoremap <Plug>(copilot-accept) <Cmd>call lspoints#copilot#accept()<CR>
inoremap <Plug>(copilot-suggest) <Cmd>call lspoints#copilot#suggest()<CR>
inoremap <Plug>(copilot-next) <Cmd>call lspoints#copilot#next()<CR>
inoremap <Plug>(copilot-prev) <Cmd>call lspoints#copilot#prev()<CR>
inoremap <Plug>(copilot-dismiss) <Cmd>call lspoints#copilot#dismiss()<CR>

let g:copilot_client_backend = g:->get('copilot_client_backend', 'deno')

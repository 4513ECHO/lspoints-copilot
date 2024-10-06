if exists('b:current_syntax')
  finish
endif
let b:current_syntax = 'copilotauth'

syn match copilotauthOnetimeCode /\v[0-9A-F]{4}-[0-9A-F]{4}/
syn match copilotauthCR /<CR>/

hi def link copilotauthOnetimeCode Identifier
hi def link copilotauthCR Special

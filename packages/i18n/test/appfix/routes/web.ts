import { route } from '@elysia-ravel/core'
import { __ } from '@elysia-ravel/i18n'

export default route().get('/hi', () => ({ msg: __('messages.hi', { name: 'Ada' }) }))

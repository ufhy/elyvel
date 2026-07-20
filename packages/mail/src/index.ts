export { defineMailConfig, type MailConfig, type MailTransportConfig } from './config-schema'
export {
  configureFailedMail,
  failedMail,
  type FailedMailAdapter,
  type FailedMailRecord,
  FailedMailRepository,
  MemoryFailedMailStore,
} from './failed'
export { Mailable } from './mailable'
export { Mail, mail, MailManager, mailManager, PendingMail, setDefaultMailer } from './manager'
export { type Address, type Attachment, formatAddress, Message } from './message'
export { MailServiceProvider, MailToken } from './provider'
export {
  ArrayTransport,
  LogTransport,
  type SmtpOptions,
  SmtpTransport,
  type Transport,
} from './transports'

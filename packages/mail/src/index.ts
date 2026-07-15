export { defineMailConfig, type MailConfig, type MailTransportConfig } from './config-schema'
export { Mailable } from './mailable'
export { Mail, MailManager, mail, mailManager, PendingMail, setDefaultMailer } from './manager'
export { type Address, type Attachment, formatAddress, Message } from './message'
export { MailServiceProvider, MailToken } from './provider'
export {
  ArrayTransport,
  LogTransport,
  type SmtpOptions,
  SmtpTransport,
  type Transport,
} from './transports'

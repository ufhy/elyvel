/** Fired after a new user is created. Plain class carrying the payload. */
export class UserRegistered {
  constructor(readonly email: string) {}
}

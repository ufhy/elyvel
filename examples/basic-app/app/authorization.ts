import { Response, createGate, setDefaultGate } from '@elysia-ravel/auth'

/** The Better Auth user shape the gate reasons about (a plain session object). */
export interface AuthUser {
  id: string
  email: string
}

/** A tiny in-memory resource so the demo needs no extra table. */
export class Note {
  constructor(
    public id: string,
    public authorId: string,
    public title: string,
  ) {}
}

const store = new Map<string, Note>()
export const notes = {
  create(authorId: string, title: string): Note {
    const note = new Note(crypto.randomUUID(), authorId, title)
    store.set(note.id, note)
    return note
  },
  find(id: string): Note | undefined {
    return store.get(id)
  },
}

/** Only the author may mutate a note; anyone may view it. */
class NotePolicy {
  view(): Response {
    return Response.allow()
  }
  update(user: AuthUser | null, note: Note): Response {
    return user?.id === note.authorId
      ? Response.allow()
      : Response.deny('You do not own this note.')
  }
  delete(user: AuthUser | null, note: Note): Response {
    return user?.id === note.authorId ? Response.allow() : Response.denyAsNotFound()
  }
}

/** Configure the process-wide gate (Laravel's AppServiceProvider::boot gates). */
export function configureAuthorization(): void {
  setDefaultGate(
    createGate<AuthUser>()
      // model-less ability, guarded via `{ can: 'admin' }`
      .define('admin', (user) => user?.email === 'admin@example.test')
      // per-model policy, routed automatically by `can('update', note)`
      .policy(Note, new NotePolicy()),
  )
}

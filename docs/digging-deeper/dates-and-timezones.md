# Dates & Timezones

A configured [dayjs](https://day.js.org) instance is the framework's date
object — elyvel's Carbon — plus request-scoped timezone handling so the
same stored UTC instant displays correctly for whoever's looking at it.

## The `date()` helper

```ts
import { date, now, today } from '@elyvel/core'

date('2026-01-15')                 // parse any date-like value
date(user.created_at)              // wrap a Date/string/number
now()                               // the current moment
today()                             // 'YYYY-MM-DD' in the active timezone

now().format('DD/MM/YYYY')
now().add(3, 'day')
now().fromNow()                     // '3 days ago' style relative time
now().tz('Asia/Makassar')           // view in a specific zone
```

Every model `date`/`datetime`/timestamp attribute is already cast to this
same object — `post.created_at.format(...)`, `.add(...)`, `.fromNow()`
all work directly with no extra wrapping. Plugins (UTC, timezone,
relative-time, custom-parse-format, localized-format, advanced-format)
are pre-activated — nothing extra to install or enable.

`isDate(value)` checks whether something is one of these date objects
(as opposed to a raw `Date`/string).

## Store UTC, display local

Everything is *stored* in UTC (the ORM does this automatically); a
timezone only ever affects *display*. The active timezone comes from
`config('app.timezone')` by default, but can be narrowed per request — to
the signed-in user's own zone, for instance:

```ts
import { runWithTimezone, setRequestTimezone } from '@elyvel/core'

route().get('/dashboard', ({ user }) => {
  setRequestTimezone(user.timezone)
  // every date() / now() call for the rest of this request now displays in user.timezone
})
```

`setRequestTimezone` is safe to call after an `await` — it's resolved
concurrency-safely (`AsyncLocalStorage`), so parallel requests never see
each other's zone. `runWithTimezone(tz, fn)` scopes a timezone to a
callback instead, for one-off work outside a request (a script, a job).

`getAppTimezone()`/`setAppTimezone()` read/write the process-wide default;
`currentTimezone()` returns whichever is active right now (request
override, else the app default).

## Formatting without the dayjs wrapper

For a plain `Intl`-backed formatter instead of a full dayjs instance:

```ts
import { dateParts, formatDate, timezoneOffset, zonedStartOfDayUtc } from '@elyvel/core'

formatDate(user.created_at, { dateStyle: 'medium', timeStyle: 'short' }, 'id-ID')
// → "15 Jan 2026, 14.30" (locale + timezone aware)

dateParts(new Date(), 'Asia/Makassar')
// → { year: '2026', month: '01', day: '15', hour: '14', minute: '30', second: '00' }

timezoneOffset('Asia/Makassar')       // UTC offset in minutes, DST-correct
zonedStartOfDayUtc('2026-01-15', 'Asia/Makassar') // the UTC instant of local midnight
```

`zonedStartOfDayUtc` is the one to reach for when bucketing data by
"calendar day in the user's timezone" — grouping orders by day, for
example — since a naive UTC-midnight boundary would put some of a user's
own-timezone day into the wrong bucket.

/**
 * Pick the right segment from a pluralized line for `number`, mirroring Laravel's
 * MessageSelector. Segments are separated by `|` and may carry an explicit range:
 *
 *   'apple|apples'                              → 1 ? first : second
 *   '{0} none|[1,19] some|[20,*] many'          → exact `{n}` / inclusive `[a,b]`
 *
 * With no explicit ranges, English-style rules apply: `number === 1` → first
 * segment, otherwise the second (falling back to the only segment if just one).
 */
export function selectPluralSegment(line: string, number: number): string {
  const segments = line.split('|')

  for (const segment of segments) {
    const explicit = extractExplicit(segment)
    if (explicit && matchesRange(explicit.condition, number))
      return explicit.text
  }

  // No explicit range matched — strip any conditions and apply standard rules.
  const plain = segments.map(stripCondition)
  if (plain.length === 1)
    return plain[0]!
  return number === 1 ? plain[0]! : plain[1]!
}

interface Explicit {
  condition: string
  text: string
}

/** Parse a leading `{n}` / `[a,b]` condition off a segment, if present. */
function extractExplicit(segment: string): Explicit | null {
  const match = /^[{[]([^[\]{}]*)[}\]]([\s\S]*)$/.exec(segment.trim())
  if (!match)
    return null
  return { condition: match[1]!.trim(), text: match[2]!.trim() }
}

function stripCondition(segment: string): string {
  const match = /^[{[][^[\]{}]*[}\]]([\s\S]*)$/.exec(segment.trim())
  return (match ? match[1]! : segment).trim()
}

/** Does `number` satisfy an explicit `{n}` (exact) or `a,b` (inclusive range)? */
function matchesRange(condition: string, number: number): boolean {
  if (!condition.includes(',')) {
    return Number(condition) === number
  }
  const [fromRaw, toRaw] = condition.split(',', 2)
  const from = fromRaw!.trim() === '*' ? Number.NEGATIVE_INFINITY : Number(fromRaw)
  const to = toRaw!.trim() === '*' ? Number.POSITIVE_INFINITY : Number(toRaw)
  return number >= from && number <= to
}

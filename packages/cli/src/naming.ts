/** Normalize an arbitrary identifier into the casings a stub might need. */
export interface Names {
  /** PascalCase, e.g. `UserProfileController` */
  class: string
  /** camelCase, e.g. `userProfileController` */
  camel: string
  /** kebab-case, e.g. `user-profile-controller` */
  kebab: string
  /** snake_case, e.g. `user_profile_controller` */
  snake: string
}

function words(input: string): string[] {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

export function makeNames(raw: string, suffix = ''): Names {
  const base = words(raw)
  // Avoid duplicating a suffix the user already typed (e.g. "UserController").
  const suffixWords = suffix ? words(suffix) : []
  const alreadySuffixed =
    suffixWords.length > 0 && base.slice(-suffixWords.length).join(' ') === suffixWords.join(' ')
  const all = alreadySuffixed ? base : [...base, ...suffixWords]

  const pascal = all.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
  return {
    class: pascal,
    camel: pascal[0]!.toLowerCase() + pascal.slice(1),
    kebab: all.join('-'),
    snake: all.join('_'),
  }
}

import { type Html, html, raw } from './html'

/** The fields a paginator needs to render links (matches @elysia-ravel/database's Paginator). */
export interface PaginatorLike {
  currentPage: number
  lastPage: number
}

/**
 * Render prev/next + windowed page-number links for a paginator (Laravel's
 * `$paginator->links()`). `path` is the base URL; links append `?page=N`.
 */
export function paginationLinks(
  paginator: PaginatorLike,
  options: { path?: string; window?: number } = {},
): Html {
  const { currentPage, lastPage } = paginator
  const path = options.path ?? ''
  const win = options.window ?? 2

  const link = (
    page: number,
    label: string,
    state: { active?: boolean; disabled?: boolean } = {},
  ): Html => {
    if (state.disabled) return html`<span class="page disabled">${raw(label)}</span>`
    if (state.active)
      return html`<span class="page active" aria-current="page">${raw(label)}</span>`
    return html`<a class="page" href="${path}?page=${page}">${raw(label)}</a>`
  }

  const numbers: Html[] = []
  for (let p = Math.max(1, currentPage - win); p <= Math.min(lastPage, currentPage + win); p++) {
    numbers.push(link(p, String(p), { active: p === currentPage }))
  }

  return html`<nav class="pagination">
    ${link(currentPage - 1, '&laquo; Previous', { disabled: currentPage <= 1 })}
    ${numbers}
    ${link(currentPage + 1, 'Next &raquo;', { disabled: currentPage >= lastPage })}
  </nav>`
}

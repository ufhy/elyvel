import type { ComputedRef, DeepReadonly } from 'vue'
import { computed, readonly } from 'vue'
import { useRoute } from 'vue-router'

/** Current-path helpers backed by vue-router (replaces Inertia's page.url). */
export interface UseCurrentUrlReturn {
  currentUrl: DeepReadonly<ComputedRef<string>>
  isCurrentUrl: (urlToCheck: string, currentUrl?: string, startsWith?: boolean) => boolean
  isCurrentOrParentUrl: (urlToCheck: string, currentUrl?: string) => boolean
  whenCurrentUrl: <T, F = null>(urlToCheck: string, ifTrue: T, ifFalse?: F) => T | F
}

export function useCurrentUrl(): UseCurrentUrlReturn {
  const route = useRoute()
  const currentUrlReactive = computed(() => route.path)

  function isCurrentUrl(urlToCheck: string, currentUrl?: string, startsWith = false) {
    const urlToCompare = currentUrl ?? currentUrlReactive.value
    const path = urlToCheck.startsWith('http') ? new URL(urlToCheck).pathname : urlToCheck
    return startsWith ? urlToCompare.startsWith(path) : path === urlToCompare
  }

  function isCurrentOrParentUrl(urlToCheck: string, currentUrl?: string) {
    return isCurrentUrl(urlToCheck, currentUrl, true)
  }

  function whenCurrentUrl(urlToCheck: string, ifTrue: any, ifFalse: any = null) {
    return isCurrentUrl(urlToCheck) ? ifTrue : ifFalse
  }

  return {
    currentUrl: readonly(currentUrlReactive),
    isCurrentUrl,
    isCurrentOrParentUrl,
    whenCurrentUrl,
  }
}

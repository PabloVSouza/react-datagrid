import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no layout: give the grid's scroller a viewport (800×352 = header + 10 rows of 32px), so the
// virtualizer renders rows; every other element keeps jsdom's zero size.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const size = (
  name: 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollWidth',
  value: number
) => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, name)
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('rdg-scroller') ? value : (original?.get?.call(this) ?? 0)
    }
  })
}
size('clientHeight', 352)
size('clientWidth', 800)
// Content size: large enough for any scroll the tests make.
size('scrollHeight', 10_000_000)
size('scrollWidth', 10_000)

// jsdom has no scrollTo on elements (the virtualizer scrolls the scroller) and fires no scroll event.
Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
  if (typeof options === 'object' && options) {
    if (options.top !== undefined) this.scrollTop = options.top
    if (options.left !== undefined) this.scrollLeft = options.left
  }
  this.dispatchEvent(new Event('scroll'))
} as Element['scrollTo']

afterEach(() => cleanup())

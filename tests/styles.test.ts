import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8')

/** Brace depth at an index: 0 is the top level (outside any @layer). */
const depthAt = (index: number) => {
  let depth = 0
  for (const char of css.slice(0, index)) {
    if (char === '{') depth++
    if (char === '}') depth--
  }
  return depth
}

describe('stylesheet', () => {
  it('puts the base styles in the rdg layer, so apps override them', () => {
    const layer = css.indexOf('@layer rdg {')
    expect(layer).toBeGreaterThanOrEqual(0)
    expect(depthAt(css.indexOf('.rdg-cell {'))).toBe(1)
  })

  it('keeps the selected text colour unlayered, so no cell colour beats it', () => {
    // A cell that sets its own colour (status colours, utility classes) made selected text unreadable.
    const rule = ".rdg:focus-within .rdg-row[aria-selected='true'] .rdg-cell *"
    const index = css.indexOf(rule)
    expect(index).toBeGreaterThan(0)
    expect(depthAt(index)).toBe(0)
    expect(css.slice(index, css.indexOf('}', index))).toContain('color: var(--rdg-selected-fg)')
    expect(depthAt(css.indexOf(".rdg-cell[aria-selected='true']:not([data-editing]) *"))).toBe(0)
  })

  it('themes through variables', () => {
    for (const name of [
      '--rdg-bg',
      '--rdg-fg',
      '--rdg-border',
      '--rdg-header-bg',
      '--rdg-header-fg',
      '--rdg-selected-bg',
      '--rdg-selected-fg',
      '--rdg-selected-bg-inactive',
      '--rdg-range-bg',
      '--rdg-active-outline'
    ])
      expect(css).toContain(`${name}:`)
  })
})

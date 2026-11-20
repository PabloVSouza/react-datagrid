import { describe, expect, it } from 'vitest'
import { isTypingKey, navigate, nearestNavigable, normalizeSeek, tabTarget } from '../src/keyboard'

const base = {
  ctrl: false,
  rowCount: 100,
  colCount: 5,
  pageSize: 10,
  mode: 'cell' as 'row' | 'cell'
}
const at = (row: number, col: number) => ({ row, col })
const go = (key: string, cell = at(50, 2), extra: Partial<typeof base> = {}) =>
  navigate({ ...base, ...extra, key, cell })

describe('navigate (desktop grid keys)', () => {
  it('moves one cell with the arrows, clamped at the edges', () => {
    expect(go('ArrowUp')).toEqual(at(49, 2))
    expect(go('ArrowDown')).toEqual(at(51, 2))
    expect(go('ArrowLeft')).toEqual(at(50, 1))
    expect(go('ArrowRight')).toEqual(at(50, 3))
    expect(go('ArrowUp', at(0, 0))).toEqual(at(0, 0))
    expect(go('ArrowRight', at(0, 4))).toEqual(at(0, 4))
    expect(go('ArrowDown', at(99, 0))).toEqual(at(99, 0))
  })

  it('jumps to the edge with Ctrl+arrow', () => {
    expect(go('ArrowUp', undefined, { ctrl: true })).toEqual(at(0, 2))
    expect(go('ArrowDown', undefined, { ctrl: true })).toEqual(at(99, 2))
    expect(go('ArrowLeft', undefined, { ctrl: true })).toEqual(at(50, 0))
    expect(go('ArrowRight', undefined, { ctrl: true })).toEqual(at(50, 4))
  })

  it('Home / End: the row in cell mode, the list in row mode; Ctrl: the grid', () => {
    expect(go('Home')).toEqual(at(50, 0))
    expect(go('End')).toEqual(at(50, 4))
    expect(go('Home', undefined, { mode: 'row' })).toEqual(at(0, 2))
    expect(go('End', undefined, { mode: 'row' })).toEqual(at(99, 2))
    expect(go('Home', undefined, { ctrl: true })).toEqual(at(0, 0))
    expect(go('End', undefined, { ctrl: true })).toEqual(at(99, 4))
  })

  it('pages with PageUp / PageDown', () => {
    expect(go('PageUp')).toEqual(at(40, 2))
    expect(go('PageDown')).toEqual(at(60, 2))
    expect(go('PageDown', at(95, 0))).toEqual(at(99, 0))
    expect(go('PageUp', at(3, 0))).toEqual(at(0, 0))
  })

  it('ignores other keys and empty grids', () => {
    expect(go('F5')).toBeNull()
    expect(go('a')).toBeNull()
    expect(go('ArrowDown', undefined, { rowCount: 0 })).toBeNull()
  })
})

describe('tabTarget', () => {
  it('wraps to the next / previous row and stops past the ends', () => {
    expect(tabTarget(at(0, 4), false, 3, 5)).toEqual(at(1, 0))
    expect(tabTarget(at(1, 0), true, 3, 5)).toEqual(at(0, 4))
    expect(tabTarget(at(2, 4), false, 3, 5)).toBeNull()
    expect(tabTarget(at(0, 0), true, 3, 5)).toBeNull()
  })
})

describe('isTypingKey', () => {
  it('is a printable character without modifiers', () => {
    const key = (k: string, mods = {}) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...mods
    })
    expect(isTypingKey(key('a'))).toBe(true)
    expect(isTypingKey(key('7'))).toBe(true)
    expect(isTypingKey(key('Enter'))).toBe(false)
    expect(isTypingKey(key('c', { ctrlKey: true }))).toBe(false)
    expect(isTypingKey(key('v', { metaKey: true }))).toBe(false)
  })
})

describe('navigate: legacy keys and skipped rows', () => {
  it('Ctrl+PageUp / Ctrl+PageDown go to the first / last row, same column', () => {
    expect(go('PageUp', undefined, { ctrl: true })).toEqual(at(0, 2))
    expect(go('PageDown', undefined, { ctrl: true })).toEqual(at(99, 2))
  })

  it('homeEndRows: Home / End and Ctrl+Home / Ctrl+End go to the first / last row, same column', () => {
    const legacy = { homeEndRows: true } as Partial<typeof base>
    expect(go('Home', undefined, legacy)).toEqual(at(0, 2))
    expect(go('End', undefined, legacy)).toEqual(at(99, 2))
    expect(go('Home', undefined, { ...legacy, ctrl: true })).toEqual(at(0, 2))
    expect(go('End', undefined, { ...legacy, ctrl: true })).toEqual(at(99, 2))
  })

  it('skips rows that are not navigable, in the direction of the move', () => {
    const isNavigable = (row: number) => row % 10 !== 0
    const skip = { isNavigable } as Partial<typeof base>
    expect(go('ArrowDown', at(49, 1), skip)).toEqual(at(51, 1))
    expect(go('ArrowUp', at(51, 1), skip)).toEqual(at(49, 1))
    expect(go('Home', at(5, 1), { ...skip, mode: 'row' })).toEqual(at(1, 1))
    expect(go('ArrowUp', at(1, 1), skip)).toEqual(at(1, 1))
  })

  it('nearestNavigable searches the direction first, then the other way', () => {
    const odd = (row: number) => row % 2 === 1
    expect(nearestNavigable(4, 1, 10, odd)).toBe(5)
    expect(nearestNavigable(4, -1, 10, odd)).toBe(3)
    expect(nearestNavigable(0, -1, 10, odd)).toBe(1)
    expect(nearestNavigable(3, 1, 10, () => false)).toBe(-1)
    expect(nearestNavigable(3, 1, 10)).toBe(3)
  })

  it('tabTarget stops only on accepted cells', () => {
    const editable = (cell: { col: number }) => cell.col === 1 || cell.col === 3
    expect(tabTarget(at(0, 1), false, 3, 5, editable)).toEqual(at(0, 3))
    expect(tabTarget(at(0, 3), false, 3, 5, editable)).toEqual(at(1, 1))
    expect(tabTarget(at(1, 1), true, 3, 5, editable)).toEqual(at(0, 3))
    expect(tabTarget(at(2, 3), false, 3, 5, editable)).toBeNull()
  })

  it('normalizeSeek ignores case and accents', () => {
    expect(normalizeSeek('JOSÉ Ação')).toBe('jose acao')
  })
})

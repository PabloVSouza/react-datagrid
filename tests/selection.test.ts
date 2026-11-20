import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  cellSelected,
  clampRanges,
  normalizeRanges,
  rowSelected,
  selectedRowIndexes
} from '../src/selection'

const range = (r1: number, c1: number, r2: number, c2: number) => ({
  anchor: { row: r1, col: c1 },
  focus: { row: r2, col: c2 }
})

describe('selection ranges', () => {
  it('bounds a range in any direction', () => {
    expect(boundsOf(range(5, 3, 2, 1))).toEqual({ top: 2, bottom: 5, left: 1, right: 3 })
  })

  it('tells selected cells and rows', () => {
    const ranges = [range(1, 1, 2, 2), range(5, 0, 5, 0)]
    expect(cellSelected(ranges, 2, 2)).toBe(true)
    expect(cellSelected(ranges, 2, 3)).toBe(false)
    expect(cellSelected(ranges, 5, 0)).toBe(true)
    expect(rowSelected(ranges, 4)).toBe(false)
    expect(rowSelected(ranges, 5)).toBe(true)
  })

  it('row mode widens every range to all columns', () => {
    expect(normalizeRanges([range(3, 2, 4, 2)], 'row', 6)).toEqual([range(3, 0, 4, 5)])
    expect(normalizeRanges([range(3, 2, 4, 2)], 'cell', 6)).toEqual([range(3, 2, 4, 2)])
  })

  it('clamps ranges to fewer rows / columns, and drops them with none', () => {
    expect(clampRanges([range(8, 8, 20, 1)], 10, 5)).toEqual([range(8, 4, 9, 1)])
    expect(clampRanges([range(0, 0, 1, 1)], 0, 5)).toEqual([])
  })

  it('lists the selected rows once, in order', () => {
    expect(selectedRowIndexes([range(4, 0, 2, 0), range(3, 1, 6, 1)])).toEqual([2, 3, 4, 5, 6])
  })
})

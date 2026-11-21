import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataGrid } from '../src'
import type { DataGridColumn, DataGridHandle, DataGridProps } from '../src'

interface Item {
  id: number
  name: string
  qty: number
  price: number
  group?: boolean
}

const names = ['Álvaro', 'Beatriz', 'Bento', 'Carla', 'Caio', 'Davi']
const makeRows = (): Item[] =>
  names.map((name, index) => ({ id: index + 1, name, qty: index, price: (index + 1) * 2 }))

const columns: DataGridColumn<Item>[] = [
  { id: 'id', header: 'Code', width: 80 },
  { id: 'name', header: 'Name', width: 200, editable: true },
  {
    id: 'qty',
    header: 'Qty',
    width: 80,
    editable: true,
    parse: (text) => (/^\d+$/.test(text) ? Number(text) : undefined)
  },
  { id: 'price', header: 'Price', width: 100, format: (value) => (value as number).toFixed(2) }
]

const setup = (props: Partial<DataGridProps<Item>> = {}) => {
  const ref = createRef<DataGridHandle<Item>>()
  const utils = render(
    <DataGrid<Item>
      ref={ref}
      rows={makeRows()}
      columns={columns}
      getRowId={(row) => String(row.id)}
      aria-label="Items"
      {...props}
    />
  )
  return { ...utils, ref, grid: screen.getByRole('grid') }
}

const press = (element: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(element, { key, ...init })
const rowElement = (grid: HTMLElement, row: number, base = 2) =>
  grid.querySelector(`.rdg-body [role=row][aria-rowindex="${row + base}"]`) as HTMLElement
const activeCell = (grid: HTMLElement) => {
  const match = grid.getAttribute('aria-activedescendant')?.match(/-r(\d+)-c(\d+)$/)
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null
}
/** The cell being edited (the grid drops aria-activedescendant while editing). */
const editingCell = (grid: HTMLElement) => {
  const match = grid.querySelector('[data-editing]')?.id.match(/-r(\d+)-c(\d+)$/)
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null
}
const editor = () => screen.getByRole('textbox') as HTMLInputElement

afterEach(() => vi.useRealTimers())

describe('legacy keys', () => {
  it('homeEndRows: Home / End go to the first / last row in cell mode, keeping the column', () => {
    const { grid } = setup({ selectionMode: 'cell', homeEndRows: true })
    press(grid, 'ArrowRight')
    press(grid, 'End')
    expect(activeCell(grid)).toEqual({ row: 5, col: 1 })
    press(grid, 'Home', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 0, col: 1 })
  })

  it('Ctrl+PageDown / Ctrl+PageUp and Ctrl+← / Ctrl+→', () => {
    const { grid } = setup({ selectionMode: 'cell' })
    press(grid, 'PageDown', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 5, col: 0 })
    press(grid, 'ArrowRight', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 5, col: 3 })
    press(grid, 'PageUp', { ctrlKey: true })
    press(grid, 'ArrowLeft', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 0, col: 0 })
  })
})

describe('type-ahead seek', () => {
  it('jumps to the first row starting with the typed text (no case, no accents); Backspace and Esc', () => {
    const onTypeAheadChange = vi.fn()
    const { grid } = setup({ typeAhead: { columnId: 'name' }, onTypeAheadChange })
    press(grid, 'b')
    expect(activeCell(grid)?.row).toBe(1)
    press(grid, 'e')
    press(grid, 'n')
    expect(activeCell(grid)?.row).toBe(2)
    expect(onTypeAheadChange).toHaveBeenLastCalledWith('ben')
    press(grid, 'Backspace')
    press(grid, 'Backspace')
    expect(onTypeAheadChange).toHaveBeenLastCalledWith('b')
    expect(activeCell(grid)?.row).toBe(1)
    press(grid, 'Escape')
    expect(onTypeAheadChange).toHaveBeenLastCalledWith('')
    press(grid, 'a')
    expect(activeCell(grid)?.row).toBe(0)
  })

  it('a key with no match is ignored; the text resets after the timeout', () => {
    vi.useFakeTimers()
    const onTypeAheadChange = vi.fn()
    const { grid } = setup({ typeAhead: { columnId: 'name', timeout: 500 }, onTypeAheadChange })
    press(grid, 'c')
    press(grid, 'z')
    expect(onTypeAheadChange).toHaveBeenLastCalledWith('c')
    expect(activeCell(grid)?.row).toBe(3)
    act(() => void vi.advanceTimersByTime(600))
    expect(onTypeAheadChange).toHaveBeenLastCalledWith('')
    press(grid, 'd')
    expect(activeCell(grid)?.row).toBe(5)
  })

  it('searches the sorted column by default and leaves Space alone', () => {
    const { grid } = setup({
      typeAhead: true,
      defaultSorting: [{ columnId: 'name', direction: 'desc' }]
    })
    press(grid, 'c')
    // Descending: Davi, Carla, Caio… the first "c" is Carla at row 1.
    expect(activeCell(grid)?.row).toBe(1)
    press(grid, 'Escape')
    const event = fireEvent.keyDown(grid, { key: ' ' })
    expect(event).toBe(true)
  })

  it('typing still starts an edit on an editable cell', () => {
    const { grid } = setup({ typeAhead: true, editable: true, selectionMode: 'cell' })
    press(grid, 'ArrowRight')
    press(grid, 'x')
    expect(editor().value).toBe('x')
  })
})

describe('edit flow', () => {
  it('async onCellEdit keeps the editor open (pending) until it resolves, then moves', async () => {
    let resolve!: (value: boolean | void) => void
    const onCellEdit = vi.fn(() => new Promise<boolean | void>((done) => (resolve = done)))
    const { grid } = setup({ editable: true, selectionMode: 'cell', onCellEdit })
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    fireEvent.change(editor(), { target: { value: 'Novo' } })
    press(editor(), 'Enter')
    expect(editor().readOnly).toBe(true)
    expect(editor().getAttribute('aria-busy')).toBe('true')
    press(editor(), 'Enter')
    expect(onCellEdit).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
  })

  it('async onCellEdit resolving false (or rejecting) keeps editing, marked invalid', async () => {
    let finish!: (value: boolean) => void
    let fail!: (error: Error) => void
    const onCellEdit = vi
      .fn()
      .mockImplementationOnce(() => new Promise((done) => (finish = done)))
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const { grid } = setup({ editable: true, selectionMode: 'cell', onCellEdit })
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    fireEvent.change(editor(), { target: { value: 'Bad' } })
    press(editor(), 'Enter')
    await act(async () => finish(false))
    expect(editor().readOnly).toBe(false)
    expect(editor().getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(editor(), { target: { value: 'Worse' } })
    press(editor(), 'Enter')
    await act(async () => fail(new Error('server')))
    expect(editor().getAttribute('aria-invalid')).toBe('true')
    expect(editingCell(grid)).toEqual({ row: 0, col: 1 })
  })

  it('editNext editable + keepEditing: Enter goes to the next editable cell and edits it, wrapping rows', () => {
    const onCellEdit = vi.fn()
    const { grid } = setup({
      editable: true,
      selectionMode: 'cell',
      editNext: 'editable',
      keepEditing: true,
      enterEdits: true,
      onCellEdit
    })
    press(grid, 'ArrowRight')
    press(grid, 'Enter')
    fireEvent.change(editor(), { target: { value: 'Ana' } })
    press(editor(), 'Enter')
    expect(editingCell(grid)).toEqual({ row: 0, col: 2 })
    expect(editor().value).toBe('0')
    fireEvent.change(editor(), { target: { value: '9' } })
    press(editor(), 'Tab')
    expect(onCellEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ columnId: 'qty', value: 9 })
    )
    expect(editingCell(grid)).toEqual({ row: 1, col: 1 })
    expect(editor().value).toBe('Beatriz')
    press(editor(), 'Escape')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('enterEdits: Enter edits an editable cell before onRowActivate; elsewhere it activates', () => {
    const onRowActivate = vi.fn()
    const { grid } = setup({
      editable: true,
      selectionMode: 'cell',
      enterEdits: true,
      onRowActivate
    })
    press(grid, 'Enter')
    expect(onRowActivate).toHaveBeenCalledTimes(1)
    press(grid, 'ArrowRight')
    press(grid, 'Enter')
    expect(editor()).toBeTruthy()
    expect(onRowActivate).toHaveBeenCalledTimes(1)
  })

  it('Tab without editing, editNext editable: next editable cell', () => {
    const { grid } = setup({ editable: true, selectionMode: 'cell', editNext: 'editable' })
    press(grid, 'Tab')
    expect(activeCell(grid)).toEqual({ row: 0, col: 1 })
    press(grid, 'Tab')
    press(grid, 'Tab')
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
  })
})

describe('rows: marked, group, footer, custom', () => {
  it('marks rows by id and tells the cell renderer (rowActive, marked)', () => {
    const cell = vi.fn(
      ({ text, rowActive, marked }) => `${text}${rowActive ? '>' : ''}${marked ? '#' : ''}`
    )
    const { grid } = setup({
      selectionMode: 'cell',
      markedRowIds: ['2'],
      columns: [columns[0]!, { id: 'name', header: 'Name', cell }]
    })
    expect(rowElement(grid, 1).getAttribute('data-marked')).toBe('true')
    expect(rowElement(grid, 1).classList.contains('rdg-row-marked')).toBe(true)
    expect(rowElement(grid, 0).getAttribute('data-marked')).toBeNull()
    expect(rowElement(grid, 0).textContent).toBe('1Álvaro>')
    expect(rowElement(grid, 1).textContent).toBe('2Beatriz#')
  })

  it('group rows span the grid, are skipped by the keys, never selected nor copied', () => {
    const rows: Item[] = [
      { id: 100, name: 'Group A', qty: 0, price: 0, group: true },
      ...makeRows().slice(0, 2),
      { id: 200, name: 'Group B', qty: 0, price: 0, group: true },
      ...makeRows().slice(2, 4)
    ]
    const { grid } = setup({
      rows,
      manualSorting: true,
      isGroupRow: (row) => !!row.group,
      renderGroupRow: ({ row }) => `== ${row.name}`
    })
    expect(activeCell(grid)?.row).toBe(1)
    const group = rowElement(grid, 3)
    expect(group.getAttribute('data-group')).toBe('true')
    expect(group.querySelectorAll('[role=gridcell]')).toHaveLength(1)
    expect(group.textContent).toBe('== Group B')
    press(grid, 'ArrowDown')
    press(grid, 'ArrowDown')
    expect(activeCell(grid)?.row).toBe(4)
    press(grid, 'Home')
    expect(activeCell(grid)?.row).toBe(1)
    fireEvent.mouseDown(group.querySelector('[role=gridcell]')!, { button: 0 })
    expect(activeCell(grid)?.row).toBe(1)
    press(grid, 'a', { ctrlKey: true })
    expect(group.getAttribute('aria-selected')).toBeNull()
    const setData = vi.fn()
    fireEvent.copy(grid, { clipboardData: { setData, getData: () => '' } })
    expect(setData.mock.calls[0]![1]).not.toContain('Group')
    expect(setData.mock.calls[0]![1].split('\n')).toHaveLength(4)
  })

  it('footer rows sit under the body with the column footer or the formatted value', () => {
    const { grid } = setup({
      footerRows: [{ id: 0, name: 'Total', qty: 15, price: 42 }],
      columns: columns.map((column) =>
        column.id === 'qty' ? { ...column, footer: (row: Item) => `Σ ${row.qty}` } : column
      )
    })
    const footer = grid.querySelector('.rdg-footer [role=row]')!
    expect(footer.getAttribute('aria-rowindex')).toBe('8')
    expect([...footer.querySelectorAll('[role=gridcell]')].map((cell) => cell.textContent)).toEqual(
      ['0', 'Total', 'Σ 15', '42.00']
    )
    expect(grid.getAttribute('aria-rowcount')).toBe('8')
  })

  it('a headerless grid with custom rows and click to activate (a menu)', () => {
    const onRowActivate = vi.fn()
    const onCellContextMenu = vi.fn()
    const { grid } = setup({
      showHeader: false,
      columns: [columns[1]!],
      activateOnClick: true,
      onRowActivate,
      onCellContextMenu,
      renderRow: ({ row, rowIndex, rowActive }) =>
        `${rowIndex + 1} - ${row.name}${rowActive ? ' <' : ''}`
    })
    expect(grid.querySelector('[role=columnheader]')).toBeNull()
    expect(grid.getAttribute('aria-rowcount')).toBe('6')
    expect(rowElement(grid, 0, 1).textContent).toBe('1 - Álvaro <')
    const third = rowElement(grid, 2, 1).querySelector('[role=gridcell]')!
    fireEvent.mouseDown(third, { button: 0 })
    fireEvent.click(third)
    expect(onRowActivate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bento' }), 2)
    expect(rowElement(grid, 2, 1).getAttribute('aria-selected')).toBe('true')
    fireEvent.doubleClick(third)
    expect(onRowActivate).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(third)
    expect(onCellContextMenu).toHaveBeenCalled()
    press(grid, 'ArrowDown')
    expect(rowElement(grid, 3, 1).textContent).toBe('4 - Carla <')
  })
})

describe('handle', () => {
  it('setActiveRow keeps the column; findRow, getRowIndex, scrollToCell', () => {
    const onActiveCellChange = vi.fn()
    const { grid, ref } = setup({ selectionMode: 'cell', onActiveCellChange })
    press(grid, 'ArrowRight')
    act(() => ref.current!.setActiveRow(4))
    expect(activeCell(grid)).toEqual({ row: 4, col: 1 })
    expect(ref.current!.findRow((row) => row.name.startsWith('C'))).toBe(3)
    expect(ref.current!.findRow((row) => row.name.startsWith('C'), 4)).toBe(4)
    expect(ref.current!.findRow((row) => row.name === 'Zé')).toBe(-1)
    expect(ref.current!.getRowIndex('6')).toBe(5)
    expect(ref.current!.getRowIndex('nope')).toBe(-1)
    act(() => ref.current!.scrollToCell({ row: 0, col: 3 }))
    expect(activeCell(grid)).toEqual({ row: 4, col: 1 })
  })
})

describe('controls inside cells', () => {
  const inputColumns: DataGridColumn<Item>[] = [
    columns[0]!,
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <input aria-label={`name ${row.id}`} defaultValue={row.name} />
    }
  ]

  it('a click on an input selects its cell and leaves the focus in the input', () => {
    const onRowActivate = vi.fn()
    const { grid } = setup({
      selectionMode: 'cell',
      columns: inputColumns,
      onRowActivate,
      activateOnClick: true
    })
    const input = screen.getByLabelText('name 3')
    const down = fireEvent.mouseDown(input, { button: 0 })
    expect(down).toBe(true)
    input.focus()
    expect(document.activeElement).toBe(input)
    expect(activeCell(grid)).toEqual({ row: 2, col: 1 })
    fireEvent.click(input)
    fireEvent.doubleClick(input)
    expect(onRowActivate).not.toHaveBeenCalled()
  })

  it('focus reaching an input (Tab) makes its cell current; its keys stay its own', () => {
    const { grid } = setup({ selectionMode: 'cell', columns: inputColumns })
    const input = screen.getByLabelText('name 2')
    act(() => input.focus())
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
    const key = fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(key).toBe(true)
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
  })
})

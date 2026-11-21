# Changelog

## 0.2.1 (2026-11-21)

- Controls inside cells (inputs, selects, buttons, links, `[role=combobox]`, `[data-rdg-interactive]`) keep their
  mouse and focus: a mouse-down on one makes its cell current without taking the focus or preventing the default
  (before, an input in a cell could not be clicked into); a click or double-click on one never activates the row;
  focus reaching one (Tab, a click) makes its cell current. Their keys stay theirs, as before.

## 0.2.0 (2026-11-20)

Legacy desktop-grid habits (xBase / FiveWin browses) and the row kinds an ERP needs. Everything is opt-in;
0.1.0 behaviour is unchanged unless noted.

- Keys: Ctrl+PageUp / Ctrl+PageDown go to the first / last row (same column). `homeEndRows`: Home / End go to the
  first / last row in cell mode too, and Ctrl+Home / Ctrl+End keep the column. Ctrl+← / Ctrl+→ (first / last
  column) are now documented and tested.
- Type-ahead seek (`typeAhead`, `onTypeAheadChange`): typing jumps to the first row whose text starts with the
  typed characters (no case, no accents; sorted column by default), Backspace removes one, Esc or a timeout
  clears them. Typing still starts an edit on an editable cell.
- Async `onCellEdit`: a promise keeps the editor open and read-only (`pending`) until it settles; `false` or a
  rejection keeps editing and marks the value invalid. A synchronous `false` now marks it invalid too, and the
  default editor can be committed again (before, a refused value left it unable to commit on blur).
- Edit flow: `enterEdits` (Enter edits an editable cell), `editNext: 'editable'` (Enter / Tab go to the next
  editable cell in reading order), `keepEditing` (edit the cell the commit moves to).
- `markedRowIds`: marked rows (`data-marked`, `.rdg-row-marked`, `--rdg-marked-*`), apart from the selection.
- Group / heading rows (`isGroupRow`, `renderGroupRow`): full width, skipped by the keys, never selected, copied,
  pasted into or edited.
- Footer rows (`footerRows`, column `footer`): fixed under the body (`--rdg-footer-*`).
- Headerless grids (`showHeader: false`), custom rows across the width (`renderRow`), single-click activation
  (`activateOnClick`): enough for a menu.
- Cell renderer context: `rowActive` and `marked`. Editor props: `pending` and `rejections`.
- Handle: `scrollToCell`, `setActiveRow` (keeps the column), `findRow`, `getRowIndex`. `DataGridHandle<T>` takes
  the row type (`any` by default), so `getDisplayedRows()` is typed.
- `aria-rowcount` / `aria-rowindex` count the footer rows, and no header row when it is hidden.

## 0.1.0 (2026-11-20)

First version: virtualized rows, columns (resize, reorder, hide, freeze, sort), row and cell selection with
ranges, clipboard, in-place editing, theming by CSS variables, ARIA grid roles, touch.

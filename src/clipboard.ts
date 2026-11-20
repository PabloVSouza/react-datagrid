/**
 * Tab-separated text, as spreadsheets (Excel, LibreOffice, Google Sheets) copy and paste it: rows end with
 * a line break; a field holding a tab, a line break or a quote is quoted, with quotes doubled.
 */
const needsQuotes = /[\t\n\r"]/

export const toTsvField = (text: string) =>
  needsQuotes.test(text) ? `"${text.replaceAll('"', '""')}"` : text

export const toTsv = (matrix: readonly (readonly string[])[]) =>
  matrix.map((row) => row.map(toTsvField).join('\t')).join('\n')

/** Parses tab-separated text (quoted fields included); a trailing line break adds no empty row. */
export const parseTsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0
  const input = text.replace(/\r\n?/g, '\n')
  while (index < input.length) {
    const char = input[index]!
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index++
        } else quoted = false
      } else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
    index++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

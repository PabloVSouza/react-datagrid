// Ships the stylesheet next to the compiled entry (dist/index.js imports './styles.css').
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
mkdirSync(resolve(root, 'dist'), { recursive: true })
copyFileSync(resolve(root, 'src/styles.css'), resolve(root, 'dist/styles.css'))

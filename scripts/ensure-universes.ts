// Generates resources/universes/*.json if any file is missing (they are not checked in: they are
// compiled from Wikipedia and Nasdaq pages). Runs before `npm run dev` and `npm run dist`.
import { existsSync } from 'fs'
import { resolve } from 'path'
import { buildUniverses } from '../src/main/data/buildUniverses'

const dir = resolve(__dirname, '../resources/universes')
const files = ['sp500', 'ndx100', 'dow30', 'comp', 'djc', 'djt', 'dju', 'bkx', 'allus', 'symbols'].map((f) => `${f}.json`)
const missing = files.filter((f) => !existsSync(resolve(dir, f)))

if (!missing.length) process.exit(0)
console.log(`Generating universe data (missing: ${missing.join(', ')})…`)
buildUniverses(dir, console.log).catch((e) => {
  console.error('Could not build universe data:', e)
  process.exit(1)
})

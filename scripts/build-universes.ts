// Regenerates the bundled universe snapshot. Run: npm run universes
import { resolve } from 'path'
import { buildUniverses } from '../src/main/data/buildUniverses'

buildUniverses(resolve(__dirname, '../resources/universes'), console.log).catch((e) => {
  console.error(e)
  process.exit(1)
})

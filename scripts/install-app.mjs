// Signs the freshly built app ad hoc and copies it into /Applications. Run via `npm run install-app`.
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { resolve } from 'path'

const NAME = 'Schwab Heatmap'
const built = resolve(import.meta.dirname, `../dist/mac-arm64/${NAME}.app`)
const target = `/Applications/${NAME}.app`

if (!existsSync(built)) {
  console.error(`missing ${built}; run npm run dist first`)
  process.exit(1)
}

// Apple Silicon refuses to launch modified bundles without a valid signature; an ad-hoc one is enough
// for an app built and run on this Mac.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', built], { stdio: 'inherit' })

const running = spawnSync('pgrep', ['-f', `${target}/Contents/MacOS/`]).status === 0
if (running) {
  console.log(`quitting running ${NAME}…`)
  spawnSync('osascript', ['-e', `tell application "${NAME}" to quit`])
  for (let i = 0; i < 50 && spawnSync('pgrep', ['-f', `${target}/Contents/MacOS/`]).status === 0; i++)
    execFileSync('sleep', ['0.2'])
}

rmSync(target, { recursive: true, force: true })
execFileSync('ditto', [built, target])
spawnSync('xattr', ['-dr', 'com.apple.quarantine', target])
console.log(`installed ${target}`)

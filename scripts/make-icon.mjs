// Draws the app icon (a small treemap on a dark tile) and packs it into build/icon.icns,
// using only tools that ship with macOS: AppKit via JXA (SVG → PNG with alpha), sips, iconutil.
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'heatmap-icon-'))

// Tiles in a 1024 canvas; the macOS icon grid keeps artwork inside an ~824px rounded square.
const tiles = [
  [0, 0, 330, 300, '#089950'],
  [0, 304, 330, 180, '#b22833'],
  [334, 0, 286, 210, '#22c25e'],
  [334, 214, 140, 270, '#7a2a33'],
  [478, 214, 142, 130, '#1f6a4a'],
  [478, 348, 142, 136, '#f23645'],
  [0, 488, 200, 136, '#1f6a4a'],
  [204, 488, 230, 136, '#22c25e'],
  [438, 488, 182, 136, '#3c3f4a']
]
const ox = 202
const oy = 200
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e222d"/>
      <stop offset="1" stop-color="#0f1116"/>
    </linearGradient>
    <clipPath id="clip"><rect x="${ox}" y="${oy}" width="620" height="624" rx="36"/></clipPath>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <g clip-path="url(#clip)">
    ${tiles.map(([x, y, w, h, c]) => `<rect x="${ox + x}" y="${oy + y}" width="${w}" height="${h}" fill="${c}"/>`).join('\n    ')}
  </g>
</svg>`

const svgPath = join(work, 'icon.svg')
writeFileSync(svgPath, svg)
const png = join(work, 'icon.png')
// qlmanage would flatten onto white; NSImage keeps the transparent corners.
const jxa = `ObjC.import('AppKit')
const img = $.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(svgPath)})
const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, 1024, 1024, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
$.NSGraphicsContext.saveGraphicsState
$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 1024, 1024), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
$.NSGraphicsContext.restoreGraphicsState
rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).writeToFileAtomically(${JSON.stringify(png)}, true)`
execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa])

const iconset = join(work, 'icon.iconset')
mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
    execFileSync('sips', ['-z', String(px), String(px), png, '--out', join(iconset, name)], { stdio: 'ignore' })
  }
}
mkdirSync(join(root, 'build'), { recursive: true })
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(work, 'icon.icns')])
renameSync(join(work, 'icon.icns'), join(root, 'build/icon.icns'))
execFileSync('sips', ['-z', '512', '512', png, '--out', join(root, 'build/icon.png')], { stdio: 'ignore' })
rmSync(work, { recursive: true, force: true })
console.log('build/icon.icns written')

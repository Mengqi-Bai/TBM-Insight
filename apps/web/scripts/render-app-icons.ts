/** Render Web install icons from the TBM Insight favicon artwork. */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Vector source for the Web icon. */
export const TILE_SOURCE = fileURLToPath(new URL('../public/favicon.svg', import.meta.url))

/** Directory the generated PNGs are committed to. */
export const ICON_OUTPUT_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url))

const TILE_EDGE = 1024
const SOURCE_DENSITY = 72
const RENDER_SCALE = 4

/** Fraction of the artwork retained in the maskable tile. */
export const MASKABLE_ARTWORK_SCALE = 0.82

/** Fraction of the icon edge guaranteed visible around the mask centre. */
export const MASKABLE_SAFE_RADIUS_RATIO = 0.4

/** One committed install icon: the manifest or link member it serves and its edge in pixels. */
export interface AppIconVariant {
  /** File name inside `public/`. */
  readonly file: string
  /** Square edge in pixels. */
  readonly size: number
  /** Which rendering the platform receives. */
  readonly kind: 'tile' | 'maskable'
}

/**
 * Install icons the Web application ships. Chrome requires the 192px and 512px
 * raster pair to offer installation, prefers a maskable icon for the home
 * screen, and iOS reads the touch icon alone.
 */
export const APP_ICON_VARIANTS: readonly AppIconVariant[] = [
  { file: 'icon-192.png', size: 192, kind: 'tile' },
  { file: 'icon-512.png', size: 512, kind: 'tile' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'tile' },
]

/** Render the mark on an opaque white square, optionally inset for a platform mask. */
function iconDocument(source: string, artworkScale: number): string {
  const artwork = /<path[^>]*\/>/u.exec(source)?.[0]
  if (artwork === undefined) throw new Error('app icons: the favicon source has no mark path')
  return `<svg width="${TILE_EDGE}" height="${TILE_EDGE}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="24" height="24" fill="#fff"/>'
    + `<g transform="translate(12 12) scale(${artworkScale}) translate(-12 -12)">${artwork}</g></svg>`
}

/** Render the full mark on the install tile. */
export function tileDocument(source: string): string {
  return iconDocument(source, 1)
}

/** Render the mark within the safe zone of a maskable install tile. */
export function maskableDocument(source: string): string {
  return iconDocument(source, MASKABLE_ARTWORK_SCALE)
}

/**
 * Rasterize one rewritten document at a square edge.
 * @param document - output of {@link tileDocument} or {@link maskableDocument}.
 * @param size - square edge in pixels.
 * @returns the PNG bytes.
 */
async function renderPng(document: string, size: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  const renderSize = Math.max(TILE_EDGE, size * RENDER_SCALE)
  // Rasterize at higher resolution before downsampling to smooth the mark edges.
  const raster = await sharp(Buffer.from(document), { density: SOURCE_DENSITY * renderSize / TILE_EDGE })
    .png()
    .toBuffer()
  return sharp(raster)
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
}

/**
 * Render every install icon from the tile source.
 * @param source - complete favicon SVG document.
 * @returns one PNG per {@link APP_ICON_VARIANTS} entry, in declaration order.
 */
export async function renderAppIcons(source: string): Promise<readonly { variant: AppIconVariant; png: Buffer }[]> {
  return Promise.all(APP_ICON_VARIANTS.map(async variant => ({
    variant,
    png: await renderPng(
      variant.kind === 'maskable' ? maskableDocument(source) : tileDocument(source),
      variant.size,
    ),
  })))
}

async function main(): Promise<void> {
  const icons = await renderAppIcons(await readFile(TILE_SOURCE, 'utf8'))
  await Promise.all(icons.map(async ({ variant, png }) => {
    await writeFile(resolve(ICON_OUTPUT_DIRECTORY, variant.file), png)
  }))
  console.info(`app icons: wrote ${icons.map(icon => icon.variant.file).join(', ')} to ${ICON_OUTPUT_DIRECTORY}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()

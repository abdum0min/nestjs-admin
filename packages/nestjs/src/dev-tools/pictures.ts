/**
 * Pictures drawn from the record itself.
 *
 * Nothing is downloaded and nothing is shipped. A placeholder service means a
 * demo that breaks on a train, a database full of links to somebody else's
 * server, and a request to that server for every row of every table anybody
 * opens. Bundled images would mean the same forty faces across every project
 * that uses this package, and a fatter tarball for a development-only feature.
 *
 * So they are computed: an identicon from a hash of the record's own key, and
 * a gradient for anything wider than it is tall. Deterministic, which matters
 * more than it sounds - the same seed gives the same avatar, so regenerating a
 * demo does not silently change every face in the screenshots.
 */
import { encodePng, type Rgb } from './png.js'
import { seedFrom } from './random.js'

/** Hue to RGB, at the saturation and lightness these images use. */
function fromHue(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = lightness - chroma / 2

  const [r, g, b] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary]

  return [
    Math.round((r + match) * 255),
    Math.round((g + match) * 255),
    Math.round((b + match) * 255),
  ]
}

const AVATAR_SIZE = 160
/** Five columns, mirrored, which is what makes an identicon read as a face. */
const GRID = 5

/**
 * A square identicon.
 *
 * The pattern is bits of the seed's hash, mirrored down the middle. Symmetry is
 * the whole trick: an asymmetric grid of squares looks like noise, and the same
 * grid mirrored looks deliberate.
 */
export function avatarPng(seed: string): Buffer {
  const hash = seedFrom(seed)
  const hue = hash % 360
  const ink = fromHue(hue, 0.52, 0.45)
  const paper = fromHue(hue, 0.28, 0.94)

  // Three columns decide five: the outer two are the mirror of the inner two.
  const cells: boolean[] = []
  for (let index = 0; index < GRID * 3; index += 1) {
    cells.push(((hash >>> index) & 1) === 1)
  }

  const cell = AVATAR_SIZE / GRID

  return encodePng(AVATAR_SIZE, AVATAR_SIZE, (x, y) => {
    const column = Math.floor(x / cell)
    const row = Math.floor(y / cell)
    const mirrored = column < 3 ? column : GRID - 1 - column

    return cells[row * 3 + mirrored] === true ? ink : paper
  })
}

const COVER_WIDTH = 480
const COVER_HEIGHT = 160

/**
 * A wide gradient, for a cover or a banner.
 *
 * Two hues a third of the wheel apart, which is far enough to read as a
 * gradient and close enough not to look like a mistake.
 */
export function coverPng(seed: string): Buffer {
  const start = seedFrom(seed) % 360

  return encodePng(COVER_WIDTH, COVER_HEIGHT, (x, y) => {
    // Diagonal rather than horizontal: a straight left-to-right ramp is what
    // every default gradient does, and the diagonal costs one more term.
    const along = (x / COVER_WIDTH) * 0.75 + (y / COVER_HEIGHT) * 0.25

    // A third of the wheel: far enough to read as a gradient, close enough not
    // to look like a mistake. Darkening slightly along the way gives it depth
    // that two flat hues do not have.
    return fromHue((start + along * 120) % 360, 0.45, 0.55 - along * 0.12)
  })
}

/**
 * Which picture a column wants.
 *
 * A field the application declared `image` gets one; so does a column whose
 * name says it holds a picture, because most schemas have `avatarUrl` long
 * before anybody configures a widget for it. Anything obviously wide gets the
 * gradient rather than a face.
 */
export function pictureKindFor(
  name: string,
  widget: string | undefined,
): 'avatar' | 'cover' | undefined {
  const normalised = name.toLowerCase().replace(/[^a-z]/g, '')

  if (/cover|banner|hero|header|background/.test(normalised)) return 'cover'
  if (/avatar|photo|picture|portrait|headshot/.test(normalised)) return 'avatar'
  if (/image|thumbnail|logo|icon|artwork|poster/.test(normalised)) return 'avatar'

  return widget === 'image' ? 'avatar' : undefined
}

export function pictureFor(kind: 'avatar' | 'cover', seed: string): Buffer {
  return kind === 'cover' ? coverPng(seed) : avatarPng(seed)
}

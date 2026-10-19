const ORIGIN = 'https://pictwo.toneflix.net'

/** The photo categories Pictwo serves. */
export const PICTWO_CATEGORIES = [
  'technology',
  'robots',
  'people',
  'nature',
  'event',
  'poster',
  'product',
  'fashion',
  'african-fashion',
  'cars',
  'design',
  'fabric',
  'profile',
  'avatar',
  'album',
] as const

/** Sizes for where a photo is used: a Post, a profile picture, a Story, or a cover. */
export const PICTWO_SHAPES = {
  landscape: [1200, 800],
  square: [1080, 1080],
  portrait: [1080, 1350],
  banner: [1500, 500],
} as const

export type PictwoCategory = (typeof PICTWO_CATEGORIES)[number]
export type PictwoShape = keyof typeof PICTWO_SHAPES

/**
 * Photos from Pictwo, the open image service the agent draws on. A category
 * and seed always resolve to the same photo, so a seed of topic words picks
 * one deliberately and a different seed picks another.
 */
export class Pictwo {
  static isCategory(value: unknown): value is PictwoCategory {
    return PICTWO_CATEGORIES.includes(value as PictwoCategory)
  }

  static url(category: PictwoCategory, seed: string, shape: PictwoShape = 'landscape'): string {
    const [width, height] = PICTWO_SHAPES[shape] ?? PICTWO_SHAPES.landscape
    const normalizedSeed =
      seed
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')
        .slice(0, 60) || category

    return `${ORIGIN}/category/${category}/${width}/${height}?seed=${normalizedSeed}`
  }
}

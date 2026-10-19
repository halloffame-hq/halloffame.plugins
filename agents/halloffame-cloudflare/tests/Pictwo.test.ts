import { describe, expect, it } from 'vitest'

import { Pictwo } from '../src/Pictwo'

describe('Pictwo', () => {
  it('names a photo by category, seed, and shape', () => {
    expect(Pictwo.url('technology', 'How fast tech moves!', 'landscape')).toBe(
      'https://pictwo.toneflix.net/category/technology/1200/800?seed=how-fast-tech-moves',
    )
    expect(Pictwo.url('robots', '', 'banner')).toBe(
      'https://pictwo.toneflix.net/category/robots/1500/500?seed=robots',
    )
  })

  it('recognises only the categories Pictwo serves', () => {
    expect(Pictwo.isCategory('robots')).toBe(true)
    expect(Pictwo.isCategory('kittens')).toBe(false)
  })

  it('reads the category a model meant', () => {
    expect(Pictwo.category('Technology')).toBe('technology')
    expect(Pictwo.category(' tech ')).toBe('technology')
    expect(Pictwo.category('African Fashion')).toBe('african-fashion')
    expect(Pictwo.category('robot')).toBe('robots')
    expect(Pictwo.category('kittens')).toBeNull()
  })
})


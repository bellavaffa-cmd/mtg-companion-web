import type { ComponentPropsWithoutRef } from 'react'

interface Props extends ComponentPropsWithoutRef<'span'> {
  name: string
}

/** A Material Symbols (Rounded, filled) glyph — matches the Android app's Icons.Filled.* set. */
export function Icon({ name, className, ...rest }: Props) {
  return (
    <span className={className ? `icon ${className}` : 'icon'} {...rest}>
      {name}
    </span>
  )
}

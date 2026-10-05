import type { ComponentPropsWithoutRef } from 'react'

interface Props extends ComponentPropsWithoutRef<'span'> {
  name: string
}

/**
 * A Material Symbols (Rounded, filled) glyph — matches the Android app's Icons.Filled.* set.
 *
 * The glyph is a ligature, so its text is the icon's name ("arrow_back"): hidden from screen readers
 * unless it is given an aria-label, when it reads as an image with that label (contentDescription =
 * null versus a description on Android). Icon-only buttons put their label on the button.
 */
export function Icon({ name, className, ...rest }: Props) {
  const labelled = rest['aria-label'] != null
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      {...(labelled ? { role: 'img' } : { 'aria-hidden': true })}
      {...rest}
    >
      {name}
    </span>
  )
}

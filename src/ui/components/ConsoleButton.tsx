import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'

export type ConsoleButtonVariant = 'standard' | 'quiet' | 'commit'

interface ConsoleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'type'> {
  variant?: ConsoleButtonVariant
  /**
   * Unavailable buttons stay focusable (aria-disabled, not disabled) so keyboard
   * and screen-reader users can reach them and hear why via aria-describedby.
   */
  unavailable?: boolean
  icon?: ReactNode
}

export function ConsoleButton({ variant = 'standard', unavailable = false, icon, children, onClick, ...rest }: ConsoleButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (unavailable) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...rest}
      type="button"
      className="console-button"
      data-variant={variant}
      aria-disabled={unavailable || undefined}
      onClick={handleClick}
    >
      {icon}
      {children}
    </button>
  )
}

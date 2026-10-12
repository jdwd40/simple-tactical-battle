const iconProps = { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true, focusable: false } as const

export function PlayIcon() {
  return <svg {...iconProps}><path d="M4 2.5v11l9-5.5z" /></svg>
}

export function StepBackIcon() {
  return <svg {...iconProps}><path d="M3 3h1.5v10H3zM13 3v10L5.5 8z" /></svg>
}

export function StepForwardIcon() {
  return <svg {...iconProps}><path d="M11.5 3H13v10h-1.5zM3 3v10l7.5-5z" /></svg>
}

export function SkipToEndIcon() {
  return <svg {...iconProps}><path d="M12 3h1.5v10H12zM1.5 3v10L6.5 8zM6.5 3v10l5-5z" /></svg>
}

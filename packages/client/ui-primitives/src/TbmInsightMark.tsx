import type { IconProps } from './icons/props.ts'

/** A segmented cutterhead in front of a shield and its rear housing. */
const MARK_PATH = 'M7.75 5.25a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 1 0 0-13.5Zm0 1.75a5 5 0 1 1 0 10 5 5 0 1 1 0-10Zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3ZM7 7.9h1.5v1.8H7zm0 6.4h1.5v1.8H7zm-3.35-3.05h1.8v1.5h-1.8zm6.4 0h1.8v1.5h-1.8zM14.3 6.75h5.15l3.55 3.5v3.5l-3.55 3.5H14.3l.9-1.75h3.55l2.5-2.5v-2l-2.5-2.5H15.2zm1.3 4.38h3.8v1.74h-3.8z'

/** Render the TBM Insight mark in the surrounding text color. */
export function TbmInsightMark({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

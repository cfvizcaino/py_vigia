/** VIGÍA mark, traced from the Figma «VIGÍA-DESIGN» logo (node 2001:3). */
export function BrandMark({ size = 40, title }: { size?: number; title?: string }) {
  return <svg className="brand-mark" width={size} height={size * 56 / 61} viewBox="0 0 61 56" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
    <path fill="currentColor" d="M0 0h27l12.5 23 7-15h-8L35 0h26L38.8 39.5 22 8h-8.5L35 47l-4.5 9Z"/>
  </svg>;
}

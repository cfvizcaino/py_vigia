import { ICON_PATHS } from "./icon-paths";

export type IconName = keyof typeof ICON_PATHS;

/**
 * Icons from the Figma «VIGÍA-DESIGN» (Material Symbols drawn there) and, for the few the
 * design does not include, Material Symbols Outlined. Filled with the current text colour.
 */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const icon = ICON_PATHS[name];
  // The Figma chevron is an arrow pointing left that the design turns to point down.
  const turn = name === "chevron" ? { transform: "rotate(-90deg)" } : undefined;
  return <svg width={size} height={size} viewBox={icon.box} fill="currentColor" aria-hidden="true" style={turn}>
    {icon.d.map((d) => <path key={d.slice(0, 24)} d={d}/>)}
  </svg>;
}

// Standard hole sizes for ISO metric screws (coarse thread), in mm.
// clearance: normal fit (ISO 273). tap: tap drill for the coarse thread.
// cbore: counterbore for a socket head cap screw (ISO 4762), diameter and depth.
// csink: 90° countersink outer diameter for a flat head screw (ISO 10642).

export interface HoleSize {
  size: string;
  clearance: number;
  tap: number;
  cboreD: number;
  cboreDepth: number;
  csinkD: number;
}

export const ISO_HOLES: HoleSize[] = [
  { size: 'M3', clearance: 3.4, tap: 2.5, cboreD: 6.5, cboreDepth: 3.3, csinkD: 6.9 },
  { size: 'M4', clearance: 4.5, tap: 3.3, cboreD: 8, cboreDepth: 4.4, csinkD: 9.2 },
  { size: 'M5', clearance: 5.5, tap: 4.2, cboreD: 10, cboreDepth: 5.4, csinkD: 11.5 },
  { size: 'M6', clearance: 6.6, tap: 5, cboreD: 11, cboreDepth: 6.4, csinkD: 13.7 },
  { size: 'M8', clearance: 9, tap: 6.8, cboreD: 15, cboreDepth: 8.6, csinkD: 18.3 },
  { size: 'M10', clearance: 11, tap: 8.5, cboreD: 18, cboreDepth: 10.6, csinkD: 22.7 },
  { size: 'M12', clearance: 13.5, tap: 10.2, cboreD: 20, cboreDepth: 12.6, csinkD: 27.2 },
];

export const holeSize = (size: string | undefined) => ISO_HOLES.find((h) => h.size === size);

/**
 * The hole's cross-section as (radius, depth) points, from the axis at the face
 * down and back: revolved about the axis it makes the cutting tool.
 */
export function holeProfile(
  kind: 'simple' | 'counterbore' | 'countersink' | 'tapped',
  d: number,
  depth: number,
  cbore?: { d: number; depth: number },
  csink?: { d: number; angle: number },
): [number, number][] | { error: string } {
  const r = d / 2;
  if (!(r > 0)) return { error: 'The diameter must be more than zero.' };
  if (!(depth > 0)) return { error: 'Depth must be more than zero.' };
  if (kind === 'counterbore' && cbore) {
    if (!(cbore.d > d)) return { error: 'The counterbore must be wider than the hole.' };
    if (!(cbore.depth > 0 && cbore.depth < depth)) return { error: 'The counterbore depth must be more than zero and less than the hole depth.' };
    return [[0, 0], [cbore.d / 2, 0], [cbore.d / 2, cbore.depth], [r, cbore.depth], [r, depth], [0, depth]];
  }
  if (kind === 'countersink' && csink) {
    if (!(csink.d > d)) return { error: 'The countersink must be wider than the hole.' };
    if (!(csink.angle > 0 && csink.angle < 180)) return { error: 'The countersink angle must be between 0 and 180 degrees.' };
    const sinkDepth = (csink.d / 2 - r) / Math.tan((csink.angle * Math.PI) / 360);
    if (!(sinkDepth < depth)) return { error: 'The countersink is deeper than the hole.' };
    return [[0, 0], [csink.d / 2, 0], [r, sinkDepth], [r, depth], [0, depth]];
  }
  return [[0, 0], [r, 0], [r, depth], [0, depth]];
}

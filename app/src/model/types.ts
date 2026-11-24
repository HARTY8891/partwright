// Slice of replica/schema.ts used so far. Same names and units:
// lengths in mm. Revolve angles are stored in degrees (what the user types).
// Grows toward the full schema feature by feature.

export type Id = string;

export interface Param {
  expr: string;
  value: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type SketchEntity =
  | { id: Id; kind: 'point'; p: Pt; construction: boolean }
  | { id: Id; kind: 'line'; p1: Id; p2: Id; construction: boolean }
  /** radius is a solver unknown, like point coordinates */
  | { id: Id; kind: 'circle'; center: Id; radius: number; construction: boolean }
  /** arc from start to end around center; ccw = counter-clockwise in sketch coordinates */
  | { id: Id; kind: 'arc'; center: Id; start: Id; end: Id; ccw: boolean; construction: boolean }
  /** smooth curve through its points, in order (first and last are its ends) */
  | { id: Id; kind: 'spline'; points: Id[]; construction: boolean };

export type LineEntity = Extract<SketchEntity, { kind: 'line' }>;
export type CircleEntity = Extract<SketchEntity, { kind: 'circle' }>;
export type ArcEntity = Extract<SketchEntity, { kind: 'arc' }>;

export type ConstraintKind =
  | 'horizontal' | 'vertical' | 'coincident' | 'fix'
  | 'parallel' | 'perpendicular' | 'equal' | 'pointOnObject' | 'tangent' | 'concentric' | 'midpoint';

export interface Constraint {
  id: Id;
  kind: ConstraintKind;
  /**
   * horizontal/vertical: [line]; coincident: [pointA, pointB]; fix: [point];
   * parallel/perpendicular: [line, line]; equal: [line, line] or [circle|arc, circle|arc];
   * pointOnObject: [point, line|circle|arc]; tangent: [line|circle|arc, circle|arc];
   * concentric: [circle|arc, circle|arc]; midpoint: [point, line]
   */
  entityIds: Id[];
  /** fix only: where the point is held */
  at?: Pt;
}

export type DimensionKind = 'distance' | 'horizontalDistance' | 'verticalDistance' | 'diameter' | 'radius' | 'angle' | 'pointLine';

export interface Dimension {
  id: Id;
  name: string; // D1, D2 … shown as D1@Sketch1
  kind: DimensionKind;
  /**
   * distance kinds: [point, point]. diameter/radius: [circle|arc].
   * angle: [line, line], value in degrees. pointLine: [point, line].
   */
  entityIds: Id[];
  /** the line the dimension was placed on (for label placement), if any */
  lineId?: Id;
  value: Param;
  driving: boolean;
}

export interface Sketch {
  entities: SketchEntity[];
  constraints: Constraint[];
  dimensions: Dimension[];
}

export type PlaneWhich = 'front' | 'top' | 'right';

/**
 * A face of the model, named by the feature that made it (persistent naming).
 * cap: the start/end face of an extrude or cut. side: the face swept by one sketch line.
 * flip: the picked face normal points against the computed normal.
 */
export type FaceRef =
  | { kind: 'cap'; featureId: Id; cap: 'start' | 'end'; flip: boolean }
  | { kind: 'side'; featureId: Id; segmentId: Id; flip: boolean };

/**
 * An edge of the model, named by the feature that made it.
 * capEdge: a sketch segment at the start/end cap. sideEdge: the straight edge swept by a sketch point.
 */
export type EdgeRef =
  | { kind: 'capEdge'; featureId: Id; cap: 'start' | 'end'; segmentId: Id }
  | { kind: 'sideEdge'; featureId: Id; pointId: Id };

export type SketchSupport = { kind: 'plane'; featureId: Id } | { kind: 'face'; face: FaceRef };

interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
  /** colour of the faces this feature made, a token name like "part-blue"; none = the part colour */
  color?: string;
}

export type PlaneBase = { kind: 'plane'; featureId: Id } | { kind: 'face'; face: FaceRef };

export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  def:
    | { type: 'default'; which: PlaneWhich }
    /** parallel to a plane or flat face, `distance` along its normal (negative = the other way) */
    | { type: 'offset'; base: PlaneBase; distance: Param }
    /** the base plane turned about its own horizontal (x) or vertical (y) axis through its origin; degrees */
    | { type: 'angle'; base: PlaneBase; axis: 'x' | 'y'; angle: Param };
}

/** A picked point on a named face, in that face's own 2D coordinates. */
export interface FacePoint {
  face: FaceRef;
  at: Pt;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  on: SketchSupport;
  sketch: Sketch;
}

export type EndCondition =
  | { type: 'blind'; depth: Param }
  | { type: 'midPlane'; depth: Param }
  | { type: 'throughAll'; depth: Param } // depth kept so switching back keeps the value
  | { type: 'throughAllBoth'; depth: Param }
  /** up to a flat face of the model (any angle); `depth` kept for switching back */
  | { type: 'upToFace'; depth: Param; face: FaceRef | null }
  /** up to a model corner; `depth` holds the resolved distance from the sketch plane */
  | { type: 'upToVertex'; depth: Param; vertex: VertexRef | null };

/** A corner of the model: where the side edge through a sketch point meets an extrude's start or end cap. */
export type VertexRef = { kind: 'corner'; featureId: Id; pointId: Id; cap: 'start' | 'end' };

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude' | 'cutExtrude';
  sketchId: Id;
  direction1: EndCondition;
  /** optional second, opposite direction (fixed depth) for fixed-depth extrudes */
  direction2?: { depth: Param };
  /** thin wall: extrude a wall of this thickness along the outline instead of the filled outline */
  thin?: { thickness: Param; side: 'inside' | 'outside' | 'both' };
  /** taper the sides, in degrees, from the sketch plane; inward unless `outward` */
  draft?: { angle: Param; outward: boolean };
  reverse: boolean;
  merge: boolean;
}

export interface RevolveFeature extends FeatureBase {
  type: 'revolve' | 'cutRevolve';
  sketchId: Id;
  /** a construction line in the sketch */
  axisLineId: Id;
  /** a reference axis to turn about instead of the sketch line */
  axisId?: Id;
  /** degrees */
  angle: Param;
  reverse: boolean;
}

export interface EdgeFeature extends FeatureBase {
  type: 'fillet' | 'chamfer';
  edges: EdgeRef[];
  /** fillet radius or chamfer distance */
  size: Param;
  /** fillet only: a different radius at the other end of each edge (variable radius) */
  size2?: Param;
}

/** A reference axis, for revolves and patterns. */
export interface AxisFeature extends FeatureBase {
  type: 'axis';
  def:
    /** where two planes meet */
    | { type: 'planes'; a: Id; b: Id }
    /** along a line in a sketch */
    | { type: 'sketchLine'; sketchId: Id; lineId: Id }
    /** through the centre of a circle or arc of an extrude or cut (the axis of its round face) */
    | { type: 'cylinder'; featureId: Id; entityId: Id };
}

/** A solid blended through two or more closed outlines, in order. */
export interface LoftFeature extends FeatureBase {
  type: 'loft';
  sketchIds: Id[];
  /** straight sides between the outlines instead of a smooth blend */
  ruled: boolean;
}

/** A closed outline (profile sketch) swept along a path (an open chain in another sketch). */
export interface SweepFeature extends FeatureBase {
  type: 'sweep';
  profileId: Id;
  pathId: Id;
}

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  /** where the hole starts: a point on a flat face */
  at: FacePoint | null;
  diameter: Param;
  end: { type: 'blind'; depth: Param } | { type: 'throughAll' };
  /** hole wizard type; simple when missing */
  kind?: 'simple' | 'counterbore' | 'countersink' | 'tapped';
  /** ISO metric screw size ("M5") when picked from the table; none = custom sizes */
  size?: string;
  cbore?: { diameter: Param; depth: Param };
  csink?: { diameter: Param; angle: Param };
}

/** A thin wall grown from an open line in a sketch, sideways until it meets the part. */
export interface RibFeature extends FeatureBase {
  type: 'rib';
  sketchId: Id;
  thickness: Param;
  /** grow to the other side of the line (default: the side the part is on) */
  flip: boolean;
}

/** A helix around a sketch circle: a path for sweeping springs and threads. */
export interface HelixFeature extends FeatureBase {
  type: 'helix';
  sketchId: Id;
  /** distance between turns */
  pitch: Param;
  turns: Param;
  /** climb against the sketch normal */
  reverse: boolean;
  leftHand: boolean;
}

export interface ShellFeature extends FeatureBase {
  type: 'shell';
  /** faces to remove (open); none = closed hollow part */
  faces: FacePoint[];
  thickness: Param;
}

export type PatternAxis = 'x' | 'y' | 'z';

export interface PatternFeature extends FeatureBase {
  type: 'linearPattern' | 'circularPattern';
  /** features to repeat (extrudes, cuts, revolves, holes) */
  seeds: Id[];
  axis: PatternAxis;
  /** a reference axis to use instead of x, y or z */
  axisId?: Id;
  count: number;
  /** linear: spacing between copies. circular: total angle in degrees */
  spacing: Param;
  reverse: boolean;
}

/** Copies of features placed on the points of a sketch (sketch-driven pattern). */
export interface SketchPatternFeature extends FeatureBase {
  type: 'sketchPattern';
  seeds: Id[];
  /** the sketch whose points (and circle centres) say where the copies go */
  sketchId: Id;
}

/** A solid read from another program's file, kept inside the part (geometry only, no history). */
export interface ImportFeature extends FeatureBase {
  type: 'import';
  fileName: string;
  /** how `step` is stored; missing means STEP (parts saved before other formats) */
  format?: 'step' | 'brep' | 'stl';
  /** the contents: STEP or BREP text, or base64 binary STL for a mesh */
  step: string;
  /** meshes: triangles in each separate body, in order */
  parts?: number[];
}

export interface MirrorFeature extends FeatureBase {
  type: 'mirror';
  seeds: Id[];
  /** a plane feature */
  planeId: Id;
}

export type Feature =
  | PlaneFeature | SketchFeature | ExtrudeFeature | RevolveFeature | EdgeFeature
  | HoleFeature | ShellFeature | PatternFeature | MirrorFeature | ImportFeature | LoftFeature | SweepFeature | AxisFeature
  | RibFeature | HelixFeature | SketchPatternFeature;
export type SolidFeature =
  | ExtrudeFeature | RevolveFeature | EdgeFeature | HoleFeature | ShellFeature | PatternFeature | MirrorFeature | ImportFeature
  | LoftFeature | SweepFeature | RibFeature | SketchPatternFeature;
export type SolidType = SolidFeature['type'];

export interface PartDocument {
  schemaVersion: number;
  id: Id;
  name: string;
  units: 'mm' | 'in';
  createdAt: string;
  updatedAt: string;
  features: Feature[];
  rollbackIndex: number;
  /** global variables for equations (S16) */
  variables?: Variable[];
  /** material id for mass properties */
  material?: string;
  /** part colour, a token name like "part-blue" */
  color?: string;
  /** named sets of variable values; the active one overrides `variables` */
  configurations?: Configuration[];
  /** id of the active configuration; none = the base variables */
  activeConfig?: Id;
  /** features suppressed in the base configuration, saved while another configuration is active */
  baseSuppressed?: Id[];
}

export interface Configuration {
  id: Id;
  name: string;
  /** variable name -> expression, for the variables this configuration changes */
  values: Record<string, string>;
  /** features suppressed in this configuration (saved when switching away); none = as in the base */
  suppressed?: Id[];
}

export interface Variable {
  id: Id;
  name: string;
  /** "50" or "width * 2"; in the part's units */
  expression: string;
  /** last evaluated value in the part's units (not mm) */
  value?: number;
}

type Draft<T> = T extends unknown ? Omit<T, 'id' | 'name' | 'suppressed'> : never;
export type FeatureDraft = Draft<SolidFeature> | Draft<PlaneFeature & { def: { type: 'offset' | 'angle' } }> | Draft<AxisFeature> | Draft<HelixFeature>;
export type ExtrudeDraft = Draft<ExtrudeFeature>;

export const SCHEMA_VERSION = 1;

/** Features whose solid can be repeated by a pattern or mirror. */
export const isSeedType = (t: Feature['type']) =>
  t === 'extrude' || t === 'cutExtrude' || t === 'revolve' || t === 'cutRevolve' || t === 'hole' || t === 'loft' || t === 'sweep';

/** The sketches a feature is built from (shown nested under it, deleted and moved with it). */
export const sketchesOf = (f: Feature): Id[] =>
  f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve' || f.type === 'cutRevolve'
    ? [f.sketchId]
    : f.type === 'loft'
      ? f.sketchIds
      : f.type === 'sweep'
        ? [f.profileId, f.pathId]
        : f.type === 'rib' || f.type === 'helix' || f.type === 'sketchPattern'
          ? [f.sketchId]
          : [];

export const usesSketch = (f: Feature): f is ExtrudeFeature | RevolveFeature =>
  f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve' || f.type === 'cutRevolve';

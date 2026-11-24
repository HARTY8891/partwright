import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import tokens from '../../../replica/design/tokens.json';
import { useDoc, getSketch, consumedSketches, type PointPick } from '../store/docStore';
import { useKernel } from '../store/rebuild';
import { DEFAULT_FRAMES, frameForSketch, planeFrame, toLocal, toWorld, add, dot, scale, sub, type Frame, type Vec3 } from '../model/planes';
import { resolveAxis, type AxisDef } from '../model/axes';
import { arcMid, candidateEdges, candidateVertices, distToSegments, edgePoint, faceFrame, facePointWorld, pickFace, vertexPoint } from '../model/refs';
import type { EdgeRef, FaceRef, FacePoint, Id, PartDocument, PlaneFeature, Pt, Sketch, VertexRef } from '../model/types';
import type { MeshData } from '../kernel/client';
import { pointOf } from '../solver/solve';
import { sampleSpline } from '../model/spline';
import { parseLength, parseValue } from '../ui/Fields';
import { formatDim, unitLabel, unitWord, type Units } from '../model/units';
import { docVars } from '../model/equations';
import { useView } from './viewStore';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const C = tokens.color;

export function Viewport() {
  const mode = useDoc((s) => s.mode);
  const inSketch = mode.kind === 'sketch';
  return (
    <div
      role="region"
      aria-label="3D view"
      className="absolute inset-0"
      style={{ background: `linear-gradient(var(--pw-color-viewport-top), var(--pw-color-viewport-bottom))` }}
    >
      <Canvas
        camera={{ position: [160, -220, 150], fov: 35, near: 0.5, far: 20000 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => void (gl.localClippingEnabled = true)}
        onPointerMissed={(e) => {
          if (e.button !== 0 || inSketch) return;
          useDoc.getState().select(null);
          useView.getState().setPickedFace(null);
        }}
      >
        <hemisphereLight args={['#ffffff', '#8a93a0', 1.4]} />
        <CameraLight />
        <CameraRig />
        <OrbitControls
          makeDefault
          enableDamping={false}
          mouseButtons={{
            LEFT: inSketch ? (undefined as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />
        <Planes />
        <Body />
        <Preview />
        <Sketches />
        <Triad />
        <MeasureOverlay />
        <HoleMarker />
      </Canvas>
    </div>
  );
}

/* ---------- lights / camera ---------- */

function CameraLight() {
  const { camera, scene } = useThree();
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __scene: THREE.Scene }).__scene = scene;
    const light = new THREE.DirectionalLight('#ffffff', 1.6);
    light.position.set(1, 1, 2);
    camera.add(light);
    scene.add(camera);
    return () => {
      camera.remove(light);
    };
  }, [camera, scene]);
  return null;
}

function bodyRadius(mesh: MeshData | null): { center: THREE.Vector3; radius: number; empty: boolean } {
  if (!mesh || !mesh.vertices.length) return { center: new THREE.Vector3(), radius: 80, empty: true };
  const box = new THREE.Box3().setFromArray(mesh.vertices);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center, radius: Math.max(sphere.radius, 20), empty: false };
}

function CameraRig() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const request = useView((s) => s.request);
  const mode = useDoc((s) => s.mode);
  const sketchId = mode.kind === 'sketch' ? mode.sketchId : null;

  const look = (dir: Vec3, center?: THREE.Vector3, radius?: number) => {
    const fit = bodyRadius(useKernel.getState().mesh);
    const c = center ?? fit.center;
    const dist = ((radius ?? fit.radius) * 1.6) / Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const d = new THREE.Vector3(...dir).normalize();
    // Looking straight down the up axis confuses orbit controls: nudge it.
    if (Math.abs(d.z) > 0.999) d.set(0, -0.001, Math.sign(d.z)).normalize();
    camera.position.copy(c).addScaledVector(d, dist);
    camera.lookAt(c);
    if (controls) {
      controls.target.copy(c);
      controls.update();
    }
  };

  useEffect(() => {
    if (!request) return;
    const views: Record<string, Vec3> = { front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0], iso: [1, -1.3, 0.9] };
    if (request.view === 'fit') {
      const dir = camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).normalize();
      look([dir.x, dir.y, dir.z]);
    } else look(views[request.view]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Starting a new solid feature turns the view to isometric so the result is visible.
  const t = mode.kind === 'feature' ? mode.draft.type : null;
  const featuring = mode.kind === 'feature' && !mode.editingId && (t === 'extrude' || t === 'cutExtrude' || t === 'revolve' || t === 'cutRevolve');
  useEffect(() => {
    if (featuring) look([1, -1.3, 0.9]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuring]);

  // Entering a sketch turns the view normal to its plane, centred on the part.
  useEffect(() => {
    if (!sketchId) return;
    const f = frameForSketch(useDoc.getState().doc, sketchId);
    if (!f) return;
    const fit = bodyRadius(useKernel.getState().mesh);
    const centre = fit.empty
      ? new THREE.Vector3(...f.origin)
      : fit.center.clone().addScaledVector(new THREE.Vector3(...f.normal), -dot(sub(fit.center.toArray() as Vec3, f.origin), f.normal));
    look(f.normal, centre, Math.max(fit.radius, 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchId]);
  return null;
}

/* ---------- planes ---------- */

const PLANE_HALF = 60;

/** True when the pointer ray also hits the solid (behind or in front of a plane). */
const solidBehind = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.intersections.some((i) => i.object.userData.solid);

function Planes() {
  const doc = useDoc((s) => s.doc);
  const show = useDoc((s) => s.showPlanes);
  const selection = useDoc((s) => s.selection);
  const mode = useDoc((s) => s.mode);
  const sk = mode.kind === 'sketch' ? getSketch(doc, mode.sketchId) : undefined;
  const activePlane = sk && sk.on.kind === 'plane' ? sk.on.featureId : null;
  const sketching = mode.kind === 'sketch';
  const planes = doc.features.slice(0, doc.rollbackIndex).filter((f): f is PlaneFeature => f.type === 'plane' && !f.suppressed);
  // a plane being created or edited: preview it
  const draft = mode.kind === 'feature' && mode.draft.type === 'plane' ? ({ ...mode.draft, id: '__draft', name: 'Preview', suppressed: false } as PlaneFeature) : null;
  const pickMirror = mode.kind === 'feature' && mode.draft.type === 'mirror' ? mode.draft.planeId : null;
  return (
    <>
      {planes.map((p) =>
        mode.kind === 'feature' && mode.editingId === p.id ? null : (show && !sketching) || p.id === activePlane || (p.id === selection && !sketching) || p.id === pickMirror ? (
          <PlaneQuad key={p.id} doc={doc} plane={p} selected={p.id === selection || p.id === pickMirror} active={p.id === activePlane} interactive={mode.kind === 'model'} />
        ) : null,
      )}
      {draft && <PlaneQuad doc={doc} plane={draft} selected active={false} interactive={false} preview />}
      {doc.features.slice(0, doc.rollbackIndex).map((f) =>
        f.type === 'axis' && !f.suppressed && !(mode.kind === 'feature' && mode.editingId === f.id) && ((show && !sketching) || f.id === selection) ? (
          <AxisLineView key={f.id} def={f.def} color={f.id === selection ? C.selected : C['plane-fill']} />
        ) : null,
      )}
      {mode.kind === 'feature' && mode.draft.type === 'axis' && <AxisLineView def={mode.draft.def} color={C.preview} />}
    </>
  );
}

/** A reference axis: a long dash-dot line through the model. */
function AxisLineView({ def, color }: { def: AxisDef; color: string }) {
  const doc = useDoc((s) => s.doc);
  const r = resolveAxis(doc, def);
  if ('error' in r) return null;
  const L = PLANE_HALF * 1.4;
  const pts: Vec3[] = [add(r.origin, scale(r.dir, -L)), add(r.origin, scale(r.dir, L))];
  return <Line points={pts} color={color} lineWidth={1.5} dashed dashSize={4} gapSize={1.5} depthTest={false} renderOrder={11} />;
}

function PlaneQuad({ doc, plane, selected, active, interactive, preview }: { doc: PartDocument; plane: PlaneFeature; selected: boolean; active: boolean; interactive: boolean; preview?: boolean }) {
  const [hover, setHover] = useState(false);
  const f = planeFrame(doc, plane);
  const corners = useMemo(
    () => (f ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => toWorld(f, { x: x * PLANE_HALF, y: y * PLANE_HALF })) : []),
    [f],
  );
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, [corners]);
  const color = preview ? C.preview : selected ? C.selected : hover ? C.hover : C['plane-fill'];
  if (!f) return null;
  return (
    <group>
      <mesh
        geometry={geom}
        renderOrder={1}
        onPointerOver={(e) => interactive && !solidBehind(e) && (e.stopPropagation(), setHover(true))}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          // Planes are see-through: a solid face anywhere under the cursor wins.
          if (!interactive || e.delta > 4 || solidBehind(e)) return;
          e.stopPropagation();
          useDoc.getState().select(plane.id);
          useView.getState().setPickedFace(null);
        }}
        onDoubleClick={(e) => {
          if (!interactive || solidBehind(e)) return;
          e.stopPropagation();
          useDoc.getState().beginSketch(plane.id);
        }}
      >
        <meshBasicMaterial color={color} transparent opacity={active ? 0.06 : selected || hover ? 0.22 : 0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[...corners, corners[0]]} color={color} lineWidth={selected || hover ? 2 : 1} transparent opacity={0.8} />
    </group>
  );
}

/* ---------- body: faces, edges, picking ---------- */

function useMeshGeometry(mesh: MeshData | null) {
  return useMemo(() => {
    if (!mesh) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
    const e = new THREE.BufferGeometry();
    e.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    return { faces: g, edges: e };
  }, [mesh]);
}

/**
 * Per-vertex colours when any feature has its own colour: each model face
 * takes the colour of the feature that made it (found by the kernel).
 */
function useFaceColors(mesh: MeshData | null, doc: PartDocument): THREE.BufferAttribute | null {
  return useMemo(() => {
    if (!mesh || !mesh.faceOwners || !doc.features.some((f) => f.color && !f.suppressed)) return null;
    const tok = C as Record<string, string>;
    const base = new THREE.Color(tok[doc.color ?? ''] ?? C['model-face']);
    const colors = new Float32Array(mesh.vertices.length);
    for (let i = 0; i < colors.length; i += 3) (colors[i] = base.r), (colors[i + 1] = base.g), (colors[i + 2] = base.b);
    const t = mesh.triangles;
    for (let k = 0; k < mesh.faceGroups.length; k += 2) {
      const start = mesh.faceGroups[k], count = mesh.faceGroups[k + 1];
      const owner: string = mesh.faceOwners[k / 2];
      const col = owner && doc.features.find((f) => f.id === owner)?.color;
      if (!col || !tok[col]) continue;
      const fc = new THREE.Color(tok[col]);
      for (let j = start; j < start + count; j++) {
        const vi = t[j] * 3;
        (colors[vi] = fc.r), (colors[vi + 1] = fc.g), (colors[vi + 2] = fc.b);
      }
    }
    return new THREE.BufferAttribute(colors, 3);
  }, [mesh, doc]);
}

/** Triangles of the mesh that lie on a face's plane (for highlighting a picked face). */
function faceTriangles(mesh: MeshData, f: Frame): THREE.BufferGeometry {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const out: number[] = [];
  const onPlane = (i: number) => Math.abs(dot(sub([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], f.origin), f.normal)) < 1e-3;
  for (let k = 0; k < t.length; k += 3) {
    if (onPlane(t[k]) && onPlane(t[k + 1]) && onPlane(t[k + 2])) {
      for (const i of [t[k], t[k + 1], t[k + 2]]) out.push(v[i * 3] + f.normal[0] * 0.01, v[i * 3 + 1] + f.normal[1] * 0.01, v[i * 3 + 2] + f.normal[2] * 0.01);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

/** Index of the model edge (edge group) nearest to a point, if within tol. */
function nearestEdgeGroup(mesh: MeshData, p: Vec3, tol: number): number | null {
  let best: number | null = null;
  let bd = tol;
  for (let g = 0; g < mesh.edgeGroups.length / 2; g++) {
    const d = distToSegments(p, mesh.edges, mesh.edgeGroups[g * 2], mesh.edgeGroups[g * 2 + 1]);
    if (d < bd) (bd = d), (best = g);
  }
  return best;
}

function groupPoints(mesh: MeshData, groups: number[]): Vec3[] {
  const out: Vec3[] = [];
  for (const g of groups) {
    const s = mesh.edgeGroups[g * 2];
    const n = mesh.edgeGroups[g * 2 + 1];
    for (let i = s; i < s + n; i++) out.push([mesh.edges[i * 3], mesh.edges[i * 3 + 1], mesh.edges[i * 3 + 2]]);
  }
  return out;
}

/** The edge group that a named edge is on now. */
function groupOfRef(mesh: MeshData, doc: PartDocument, ref: EdgeRef): number | null {
  const p = edgePoint(doc, ref);
  return p ? nearestEdgeGroup(mesh, p, 1e-3) : null;
}

/** Name the model edge in an edge group, if an extrude/cut made it. */
function refOfGroup(mesh: MeshData, doc: PartDocument, g: number): EdgeRef | null {
  const s = mesh.edgeGroups[g * 2];
  const n = mesh.edgeGroups[g * 2 + 1];
  for (const c of candidateEdges(doc)) if (distToSegments(c.at, mesh.edges, s, n) < 1e-3) return c.ref;
  return null;
}

/** Clipping planes for the section view (empty when it is off). */
function useSectionPlanes(): THREE.Plane[] {
  const section = useView((s) => s.section);
  return useMemo(() => {
    if (!section.on) return [];
    const f = DEFAULT_FRAMES[section.plane];
    const n = new THREE.Vector3(...f.normal).multiplyScalar(section.flip ? 1 : -1);
    // keep the side the normal points away from; `offset` moves the cut along the plane's normal
    return [new THREE.Plane(n, (section.flip ? -1 : 1) * section.offset)];
  }, [section]);
}

function Body() {
  const style = useView((s) => s.displayStyle);
  const clip = useSectionPlanes();
  const mesh = useKernel((s) => s.mesh);
  const mode = useDoc((s) => s.mode);
  const doc = useDoc((s) => s.doc);
  const pickedFace = useView((s) => s.pickedFace);
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: OrbitControlsImpl | null };
  const g = useMeshGeometry(mesh);
  const faceColors = useFaceColors(mesh, doc);
  const [hoverFace, setHoverFace] = useState<FaceRef | null>(null);
  const [hoverVertex, setHoverVertex] = useState<VertexRef | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);

  const picking = mode.kind === 'feature' && (mode.draft.type === 'fillet' || mode.draft.type === 'chamfer');
  const facePicking =
    mode.kind === 'feature' &&
    (mode.draft.type === 'hole' || mode.draft.type === 'shell' || ((mode.draft.type === 'extrude' || mode.draft.type === 'cutExtrude') && mode.draft.direction1.type === 'upToFace'));
  const vertexPicking = mode.kind === 'feature' && (mode.draft.type === 'extrude' || mode.draft.type === 'cutExtrude') && mode.draft.direction1.type === 'upToVertex';
  const pickedVertex = vertexPicking && 'direction1' in mode.draft && mode.draft.direction1.type === 'upToVertex' ? mode.draft.direction1.vertex : null;
  const measuring = useView((s) => s.measuring) && mode.kind === 'model';
  const shellFaces = mode.kind === 'feature' && mode.draft.type === 'shell' ? mode.draft.faces : [];
  const pickedEdges = mode.kind === 'feature' && 'edges' in mode.draft ? mode.draft.edges : null;
  const selectedGroups = useMemo(
    () => (mesh && pickedEdges ? (pickedEdges.map((r) => groupOfRef(mesh, doc, r)).filter((x) => x !== null) as number[]) : []),
    [mesh, doc, pickedEdges],
  );

  const highlightFace = (mode.kind === 'model' && !measuring) || facePicking ? (hoverFace ?? (mode.kind === 'model' ? pickedFace : null)) : null;
  const faceGeo = useMemo(() => {
    if (!mesh || !highlightFace) return null;
    const f = faceFrame(doc, highlightFace);
    return f ? faceTriangles(mesh, f) : null;
  }, [mesh, doc, highlightFace]);
  const shellGeo = useMemo(() => {
    if (!mesh || !shellFaces.length) return [];
    return shellFaces.map((fp) => faceFrame(doc, fp.face)).filter(Boolean).map((f) => faceTriangles(mesh, f!));
  }, [mesh, doc, shellFaces]);

  if (!g || !mesh) return null;
  if (faceColors) g.faces.setAttribute('color', faceColors);
  else if (g.faces.hasAttribute('color')) g.faces.deleteAttribute('color');
  const dim = mode.kind === 'sketch';
  const tol = () => camera.position.distanceTo(controls?.target ?? new THREE.Vector3()) * 0.012;
  const hitNormal = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec3 | null => (e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : null);
  const P = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec3 => [e.point.x, e.point.y, e.point.z];

  /** a face point under the cursor, in the face's own coordinates */
  const facePointAt = (e: ThreeEvent<PointerEvent | MouseEvent>): FacePoint | null => {
    const n = hitNormal(e);
    const face = n ? pickFace(doc, P(e), n) : null;
    const f = face && faceFrame(doc, face);
    return face && f ? { face, at: toLocal(f, P(e)) } : null;
  };
  /** nearest model corner (end of an edge) within tol, else the hit point */
  const snapVertex = (p: Vec3): Vec3 => {
    let best = p;
    let bd = tol() * 0.8;
    for (let g = 0; g < mesh.edgeGroups.length / 2; g++) {
      const s0 = mesh.edgeGroups[g * 2];
      const n = mesh.edgeGroups[g * 2 + 1];
      for (const i of [s0, s0 + n - 1]) {
        const q: Vec3 = [mesh.edges[i * 3], mesh.edges[i * 3 + 1], mesh.edges[i * 3 + 2]];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (d < bd) (bd = d), (best = q);
      }
    }
    return best;
  };

  /** the pickable model corner nearest the cursor, if close enough */
  const nearestVertex = (p: Vec3): VertexRef | null => {
    let best: VertexRef | null = null;
    let bd = tol() * 1.5;
    const editing = mode.kind === 'feature' ? mode.editingId : undefined;
    for (const c of candidateVertices(doc, editing)) {
      const d = Math.hypot(c.at[0] - p[0], c.at[1] - p[1], c.at[2] - p[2]);
      if (d < bd) (bd = d), (best = c.ref);
    }
    return best;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (measuring) return;
    if (vertexPicking) {
      e.stopPropagation();
      setHoverVertex(nearestVertex(P(e)));
      return;
    }
    if (facePicking) {
      e.stopPropagation();
      setHoverFace(facePointAt(e)?.face ?? null);
    } else if (mode.kind === 'model') {
      const n = hitNormal(e);
      setHoverFace(n ? pickFace(doc, P(e), n) : null);
    } else if (picking) {
      e.stopPropagation();
      setHoverEdge(nearestEdgeGroup(mesh, P(e), tol()));
    }
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.button !== 0) return;
    if (measuring) {
      e.stopPropagation();
      useView.getState().addMeasurePoint(snapVertex(P(e)));
      return;
    }
    if (vertexPicking) {
      e.stopPropagation();
      const v = nearestVertex(P(e));
      if (v) useDoc.getState().setUpToVertex(v);
      else useDoc.getState().notify('info', 'Click closer to a corner of the model.');
      return;
    }
    if (facePicking) {
      e.stopPropagation();
      const fp = facePointAt(e);
      if (!fp) return useDoc.getState().notify('info', 'Only flat faces made by an extrude or cut can be picked for now.');
      if (mode.kind === 'feature' && mode.draft.type === 'hole') useDoc.getState().setHolePoint(fp);
      else if (mode.kind === 'feature' && 'direction1' in mode.draft) useDoc.getState().setUpToFace(fp.face);
      else useDoc.getState().toggleShellFace(fp);
      return;
    }
    if (mode.kind === 'model') {
      e.stopPropagation();
      const n = hitNormal(e);
      const f = n ? pickFace(doc, P(e), n) : null;
      useView.getState().setPickedFace(f);
      useDoc.getState().select(null);
      if (!f) useDoc.getState().notify('info', 'Only flat faces made by an extrude or cut can be picked for now.');
    } else if (picking) {
      e.stopPropagation();
      const grp = nearestEdgeGroup(mesh, P(e), tol());
      if (grp === null) return;
      const ref = refOfGroup(mesh, doc, grp);
      if (ref) useDoc.getState().toggleEdge(ref);
      else useDoc.getState().notify('info', 'That edge was not made directly by an extrude or cut, so it cannot be picked yet.');
    }
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (mode.kind !== 'model') return;
    const n = hitNormal(e);
    const f = n ? pickFace(doc, P(e), n) : null;
    if (f) {
      e.stopPropagation();
      useView.getState().setPickedFace(null);
      useDoc.getState().beginSketch({ kind: 'face', face: f });
    }
  };

  // While sketching the solid is drawn faded but opaque, so the sketch overlay
  // (opaque, later render order, no depth test) always stays on top of it.
  return (
    <group>
      <mesh
        geometry={g.faces}
        userData={{ solid: true }}
        onPointerMove={onMove}
        onPointerOut={() => (setHoverFace(null), setHoverEdge(null), setHoverVertex(null))}
        onClick={onClick}
        onDoubleClick={onDouble}
        // (passing undefined would wipe three's raycast method after the first sketch)
        raycast={dim ? noRaycast : THREE.Mesh.prototype.raycast}
      >
        <meshStandardMaterial
          key={faceColors && !dim ? 'by-feature' : 'plain'}
          vertexColors={!!faceColors && !dim}
          color={dim ? C['surface-sunken'] : faceColors ? '#ffffff' : ((C as Record<string, string>)[doc.color ?? ''] ?? C['model-face'])}
          roughness={0.55}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          // wireframe: faces still catch clicks but are not drawn
          colorWrite={style !== 'wireframe'}
          depthWrite={style !== 'wireframe'}
          clippingPlanes={clip}
          side={clip.length ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
      {style !== 'shaded' && (
        <lineSegments geometry={g.edges} raycast={() => null}>
          <lineBasicMaterial color={dim ? C['border-input'] : C['model-edge']} clippingPlanes={clip} />
        </lineSegments>
      )}
      {faceGeo && (
        <mesh geometry={faceGeo} raycast={() => null} renderOrder={3}>
          <meshBasicMaterial color={hoverFace ? C.hover : C.selected} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {shellGeo.map((geo, i) => (
        <mesh key={i} geometry={geo} raycast={() => null} renderOrder={3}>
          <meshBasicMaterial color={C.selected} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {vertexPicking &&
        [pickedVertex && { v: pickedVertex, c: C.selected }, hoverVertex && { v: hoverVertex, c: C.hover }].map((m, i) => {
          const at = m ? vertexPoint(doc, m.v) : undefined;
          return at ? (
            <mesh key={i} position={at} renderOrder={13} raycast={() => null}>
              <sphereGeometry args={[i ? 1.1 : 0.9, 12, 12]} />
              <meshBasicMaterial color={m!.c} depthTest={false} />
            </mesh>
          ) : null;
        })}
      {picking && selectedGroups.length > 0 && <EdgeHighlight points={groupPoints(mesh, selectedGroups)} color={C.selected} />}
      {picking && hoverEdge !== null && <EdgeHighlight points={groupPoints(mesh, [hoverEdge])} color={C.hover} />}
    </group>
  );
}

const noRaycast = () => null;

function EdgeHighlight({ points, color }: { points: Vec3[]; color: string }) {
  if (points.length < 2) return null;
  return <Line points={points} segments color={color} lineWidth={4} depthTest={false} renderOrder={12} />;
}

function Preview() {
  const preview = useKernel((s) => s.preview);
  const g = useMeshGeometry(preview);
  if (!g) return null;
  return (
    <group renderOrder={2}>
      <mesh geometry={g.faces} raycast={() => null}>
        <meshStandardMaterial color={C.preview} transparent opacity={0.55} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <lineSegments geometry={g.edges} raycast={() => null}>
        <lineBasicMaterial color={C.preview} />
      </lineSegments>
    </group>
  );
}

/* ---------- sketches ---------- */

function Sketches() {
  const doc = useDoc((s) => s.doc);
  const mode = useDoc((s) => s.mode);
  const selection = useDoc((s) => s.selection);
  const used = consumedSketches(doc);
  const activeId = mode.kind === 'sketch' ? mode.sketchId : null;
  const highlight = mode.kind === 'feature' && 'sketchId' in mode.draft ? mode.draft.sketchId : selection;
  return (
    <>
      {doc.features.map((f) => {
        if (f.type !== 'sketch' || f.id === activeId || f.suppressed) return null;
        // In the model, sketches used by a feature are hidden unless selected.
        if (used.has(f.id) && highlight !== f.id) return null;
        const frame = frameForSketch(doc, f.id);
        return frame ? <PassiveSketch key={f.id} sketch={f.sketch} frame={frame} highlight={highlight === f.id} /> : null;
      })}
      {activeId && <ActiveSketch sketchId={activeId} doc={doc} />}
    </>
  );
}

const lift = 0.02; // draw sketch geometry just above its plane

/** World-space polyline for any curve entity. */
function entityPoints(sk: Sketch, frame: Frame, id: Id, offset = lift): Vec3[] {
  const e = sk.entities.find((x) => x.id === id);
  if (!e) return [];
  if (e.kind === 'line') return [toWorld(frame, pointOf(sk, e.p1), offset), toWorld(frame, pointOf(sk, e.p2), offset)];
  if (e.kind === 'circle') {
    const c = pointOf(sk, e.center);
    return [...Array(65).keys()].map((i) => toWorld(frame, { x: c.x + e.radius * Math.cos((i / 64) * 2 * Math.PI), y: c.y + e.radius * Math.sin((i / 64) * 2 * Math.PI) }, offset));
  }
  if (e.kind === 'spline') return sampleSpline(e.points.map((id) => pointOf(sk, id))).map((q) => toWorld(frame, q, offset));
  if (e.kind === 'arc') {
    const c = pointOf(sk, e.center);
    const a = pointOf(sk, e.start);
    const b = pointOf(sk, e.end);
    const r = Math.hypot(a.x - c.x, a.y - c.y);
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    let a1 = Math.atan2(b.y - c.y, b.x - c.x);
    if (e.ccw) while (a1 <= a0) a1 += 2 * Math.PI;
    else while (a1 >= a0) a1 -= 2 * Math.PI;
    return [...Array(49).keys()].map((i) => {
      const t = a0 + ((a1 - a0) * i) / 48;
      return toWorld(frame, { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }, offset);
    });
  }
  return [];
}

const curves = (sk: Sketch) => sk.entities.filter((e) => e.kind !== 'point');

function PassiveSketch({ sketch, frame, highlight }: { sketch: Sketch; frame: Frame; highlight: boolean }) {
  return (
    <>
      {curves(sketch).map((e) =>
        !e.construction || highlight ? (
          <Line
            key={e.id}
            points={entityPoints(sketch, frame, e.id)}
            color={highlight ? C.selected : C['sketch-construction']}
            lineWidth={highlight ? 2.5 : 1.5}
            dashed={e.construction}
            dashSize={4}
            gapSize={3}
            depthTest={!highlight}
            renderOrder={highlight ? 10 : 0}
          />
        ) : null,
      )}
    </>
  );
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToEntity(sk: Sketch, id: Id, p: Pt): number {
  const e = sk.entities.find((x) => x.id === id);
  if (!e) return Infinity;
  if (e.kind === 'spline') {
    const pts = sampleSpline(e.points.map((q) => pointOf(sk, q)), 8);
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
    return best;
  }
  if (e.kind === 'line') return distToSegment(p, pointOf(sk, e.p1), pointOf(sk, e.p2));
  if (e.kind === 'circle') {
    const c = pointOf(sk, e.center);
    return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - e.radius);
  }
  if (e.kind === 'arc') {
    const c = pointOf(sk, e.center);
    const a = pointOf(sk, e.start);
    const r = Math.hypot(a.x - c.x, a.y - c.y);
    const m = arcMid(sk, e);
    // only on the drawn side of the circle
    const onSide = Math.hypot(p.x - m.x, p.y - m.y) <= Math.hypot(a.x - m.x, a.y - m.y) * 1.05 + 1e-9;
    return onSide ? Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r) : Infinity;
  }
  return Infinity;
}

function ActiveSketch({ sketchId, doc }: { sketchId: Id; doc: PartDocument }) {
  const mode = useDoc((s) => s.mode);
  const solve = useDoc((s) => s.solve);
  const editingDimId = useDoc((s) => s.editingDimId);
  const selected = useView((s) => s.sketchSel);
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: OrbitControlsImpl | null };
  const feature = getSketch(doc, sketchId)!;
  const sk = feature.sketch;
  const frame = frameForSketch(doc, sketchId);
  const tool = mode.kind === 'sketch' ? mode.tool : 'select';

  const [cursor, setCursor] = useState<Pt | null>(null);
  const [picks, setPicks] = useState<PointPick[]>([]);
  const [hoverId, setHoverId] = useState<Id | null>(null);
  /** Dimension tool: a point picked first, waiting for a second point or a line. */
  const [dimFirst, setDimFirst] = useState<Id | null>(null);

  // Reset an unfinished shape when the tool changes; clear selection on exit.
  useEffect(() => (setPicks([]), setDimFirst(null)), [tool]);
  useEffect(() => () => useView.getState().setSketchSel([]), []);

  // Esc ends a chain; Delete removes the selected entity.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Enter' && tool === 'spline' && picks.length >= 2) {
        e.stopPropagation();
        useDoc.getState().addSpline(picks);
        setPicks([]);
      }
      if (e.key === 'Escape' && (picks.length || dimFirst)) {
        e.stopPropagation();
        setPicks([]);
        setDimFirst(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        for (const id of selected) useDoc.getState().deleteSketchEntity(id);
        useView.getState().setSketchSel([]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picks, selected, dimFirst, tool]);

  if (!frame) return null;

  const tolerance = () => camera.position.distanceTo(controls?.target ?? new THREE.Vector3()) * 0.012;

  const points = sk.entities.filter((e) => e.kind === 'point');
  const curveList = curves(sk);

  const nearestPoint = (p: Pt): Id | null => {
    let best: Id | null = null;
    let bd = tolerance();
    for (const e of points) {
      if (e.kind !== 'point') continue;
      const d = Math.hypot(e.p.x - p.x, e.p.y - p.y);
      if (d < bd) (bd = d), (best = e.id);
    }
    return best;
  };
  const nearestCurve = (p: Pt): Id | null => {
    let best: Id | null = null;
    let bd = tolerance();
    for (const c of curveList) {
      const d = distToEntity(sk, c.id, p);
      if (d < bd) (bd = d), (best = c.id);
    }
    return best;
  };

  /**
   * Inference: when the cursor lines up with an existing point (same x or same y)
   * it snaps to that line-up and a dashed guide is drawn from the point.
   */
  const infer = (p: Pt): { pt: Pt; guides: [Pt, Pt][] } => {
    const tol = tolerance() * 0.6;
    let x = p.x;
    let y = p.y;
    let gx: Pt | null = null;
    let gy: Pt | null = null;
    let bx = tol;
    let by = tol;
    const anchors = [...points.map((e) => (e.kind === 'point' ? e.p : null)), ...picks.map(pickPos)].filter(Boolean) as Pt[];
    for (const q of anchors) {
      if (Math.abs(q.x - p.x) < bx && Math.abs(q.y - p.y) > tol) (bx = Math.abs(q.x - p.x)), (x = q.x), (gx = q);
      if (Math.abs(q.y - p.y) < by && Math.abs(q.x - p.x) > tol) (by = Math.abs(q.y - p.y)), (y = q.y), (gy = q);
    }
    const pt = { x, y };
    const guides: [Pt, Pt][] = [];
    if (gx) guides.push([gx, pt]);
    if (gy) guides.push([gy, pt]);
    return { pt, guides };
  };

  const pickAt = (p: Pt): PointPick => {
    const id = nearestPoint(p);
    if (id) return { id };
    const q = infer(p).pt;
    return { at: { x: round(q.x), y: round(q.y) } };
  };
  const pickPos = (pk: PointPick): Pt => ('id' in pk ? pointOf(sk, pk.id) : pk.at);

  const localOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => toLocal(frame, [e.point.x, e.point.y, e.point.z]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p = localOf(e);
    setCursor(p);
    if (tool === 'trim' || tool === 'extend') setHoverId(nearestCurve(p));
    else if (tool === 'select' || tool === 'dimension') setHoverId(nearestPoint(p) ?? nearestCurve(p));
    else setHoverId(nearestPoint(p));
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.button !== 0) return;
    e.stopPropagation();
    const p = localOf(e);
    const store = useDoc.getState();
    if (tool === 'select') {
      // points win over curves so endpoints and centres can be picked for relations
      const hit = nearestPoint(p) ?? nearestCurve(p);
      const view = useView.getState();
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (hit) view.toggleSketchSel(hit);
      } else view.setSketchSel(hit ? [hit] : []);
      return;
    }
    if (tool === 'trim' || tool === 'extend') {
      const c = nearestCurve(p);
      const ent = c && sk.entities.find((x) => x.id === c);
      if (!ent || ent.kind !== 'line') return store.notify('info', `Click on a line to ${tool} it.`);
      if (tool === 'trim') store.trimAt(c!, p);
      else store.extendAt(c!, p);
      return;
    }
    if (tool === 'spline') {
      const pk = pickAt(p);
      const last = picks[picks.length - 1];
      // clicking the last point again finishes the spline
      if (last && 'id' in pk && 'id' in last && pk.id === last.id) {
        store.addSpline(picks);
        setPicks([]);
      } else if (last && 'at' in pk && 'at' in last && Math.hypot(pk.at.x - last.at.x, pk.at.y - last.at.y) < tolerance() * 0.5) {
        store.addSpline(picks);
        setPicks([]);
      } else setPicks([...picks, pk]);
      return;
    }
    if (tool === 'dimension') {
      const pt = nearestPoint(p);
      const c = nearestCurve(p);
      if (dimFirst) {
        // second pick: point -> distance, line -> point-to-line distance
        const second = pt ?? c;
        if (second && second !== dimFirst) store.addDimensionBetween(dimFirst, second);
        setDimFirst(null);
      } else if (pt) setDimFirst(pt);
      else if (c) store.addDimension(c);
      return;
    }
    const pk = pickAt(p);
    const all = [...picks, pk];
    if (tool === 'rect' && all.length === 2) {
      store.addRect(all[0], all[1]);
      setPicks([]);
    } else if (tool === 'circle' && all.length === 2) {
      const c = pickPos(all[0]);
      const q = pickPos(all[1]);
      store.addCircle(all[0], round(Math.hypot(q.x - c.x, q.y - c.y)));
      setPicks([]);
    } else if (tool === 'polygon' && all.length === 2) {
      store.addPolygon(all[0], pickPos(all[1]), useView.getState().polygonSides);
      setPicks([]);
    } else if (tool === 'slot' && all.length === 3) {
      store.addSlot(all[0], all[1], pickPos(all[2]));
      setPicks([]);
    } else if (tool === 'arc' && all.length === 3) {
      store.addArc(all[0], all[1], pickPos(all[2]));
      setPicks([]);
    } else if ((tool === 'line' || tool === 'centerline') && all.length === 2) {
      const lineId = store.addLine(all[0], all[1], { construction: tool === 'centerline' });
      if (!lineId) return;
      const after = getSketch(useDoc.getState().doc, sketchId)!.sketch;
      const line = after.entities.find((x) => x.id === lineId);
      // Lines chain from the end point until you click an existing point. Centerlines don't chain.
      if (tool === 'centerline' || 'id' in pk) setPicks([]);
      else if (line && line.kind === 'line') setPicks([{ id: line.p2 }]);
    } else setPicks(all);
  };

  const colorFor = (id: Id, construction: boolean) => {
    if (selected.includes(id)) return C.selected;
    if (id === hoverId) return C.hover;
    if (construction) return C['sketch-construction'];
    const e = sk.entities.find((x) => x.id === id)!;
    if (solve?.redundant.size && sk.constraints.some((c) => c.entityIds.includes(id) && solve.redundant.has(c.id))) return C['sketch-over'];
    if (sk.dimensions.some((d) => d.entityIds[0] === id && solve?.redundant.has(d.id))) return C['sketch-over'];
    const def = e.kind === 'line' ? solve?.defined.has(e.p1) && solve.defined.has(e.p2) : solve?.defined.has(id);
    return def ? C['sketch-full'] : C['sketch-under'];
  };

  // Rubber band preview and inference guides
  let rubber: Vec3[][] = [];
  let guides: Vec3[][] = [];
  const drawing = tool !== 'select' && tool !== 'dimension' && tool !== 'trim' && tool !== 'extend';
  const snapNow = cursor ? nearestPoint(cursor) : null;
  const inferred = cursor && drawing && !snapNow ? infer(cursor) : null;
  if (inferred) guides = inferred.guides.map(([q, r]) => [toWorld(frame, q, lift), toWorld(frame, r, lift)]);
  if (picks.length && cursor) {
    const a = pickPos(picks[0]);
    const b = snapNow ? pointOf(sk, snapNow) : (inferred?.pt ?? cursor);
    const W = (q: Pt) => toWorld(frame, q, lift);
    if (tool === 'rect') rubber = [[a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a].map(W)];
    else if (tool === 'line' || tool === 'centerline') rubber = [[W(a), W(b)]];
    else if (tool === 'spline') rubber = [sampleSpline([...picks.map(pickPos), b]).map(W)];
    else if (tool === 'polygon') {
      const n = useView.getState().polygonSides;
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      const a0 = Math.atan2(b.y - a.y, b.x - a.x);
      rubber = [[...Array(n + 1).keys()].map((i) => W({ x: a.x + r * Math.cos(a0 + (2 * Math.PI * i) / n), y: a.y + r * Math.sin(a0 + (2 * Math.PI * i) / n) }))];
    } else if (tool === 'slot') {
      if (picks.length === 1) rubber = [[W(a), W(b)]];
      else {
        const c2 = pickPos(picks[1]);
        const len = Math.hypot(c2.x - a.x, c2.y - a.y) || 1;
        const u = { x: (c2.x - a.x) / len, y: (c2.y - a.y) / len };
        const nrm = { x: -u.y, y: u.x };
        const w = Math.abs((b.x - a.x) * nrm.x + (b.y - a.y) * nrm.y);
        // outline: along one long edge, round the far end, back along the other, round the near end
        const at = (c: Pt, t: number) => ({ x: c.x + w * (Math.cos(t) * u.x + Math.sin(t) * nrm.x), y: c.y + w * (Math.cos(t) * u.y + Math.sin(t) * nrm.y) });
        const ring: Pt[] = [];
        for (let i = 0; i <= 16; i++) ring.push(at(c2, Math.PI / 2 - (Math.PI * i) / 16));
        for (let i = 0; i <= 16; i++) ring.push(at(a, -Math.PI / 2 - (Math.PI * i) / 16));
        rubber = [[...ring, ring[0]].map(W)];
      }
    } else if (tool === 'circle') {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      rubber = [[...Array(65).keys()].map((i) => W({ x: a.x + r * Math.cos((i / 64) * 2 * Math.PI), y: a.y + r * Math.sin((i / 64) * 2 * Math.PI) }))];
    } else if (tool === 'arc') {
      if (picks.length === 1) rubber = [[W(a), W(b)]];
      else {
        const end = pickPos(picks[1]);
        const pts = arcThrough(a, end, b);
        rubber = [pts ? pts.map(W) : [W(a), W(b), W(end)]];
      }
    }
  }

  const ps = points.filter((p) => p.kind === 'point' && !p.construction) as { p: Pt }[];
  const centroid = ps.length
    ? { x: ps.reduce((s, q) => s + q.p.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.p.y, 0) / ps.length }
    : { x: 0, y: 0 };

  const pointPositions = new Float32Array(points.flatMap((p) => (p.kind === 'point' ? toWorld(frame, p.p, lift * 2) : [])));
  const pointColors = new Float32Array(
    points.flatMap((p) => {
      const c = new THREE.Color(
        selected.includes(p.id) || p.id === dimFirst ? C.selected : p.id === hoverId ? C.hover : solve?.defined.has(p.id) ? C['sketch-full'] : C['sketch-under'],
      );
      return [c.r, c.g, c.b];
    }),
  );

  return (
    <group>
      {/* Pointer catcher on the sketch plane */}
      <mesh
        position={new THREE.Vector3(...frame.origin)}
        quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...frame.normal))}
        onPointerMove={onMove}
        onPointerOut={() => setCursor(null)}
        onClick={onClick}
      >
        <planeGeometry args={[20000, 20000]} />
        <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
      </mesh>

      {curveList.map((c) => (
        <Line
          key={c.id}
          points={entityPoints(sk, frame, c.id)}
          color={colorFor(c.id, c.construction)}
          lineWidth={c.id === hoverId || selected.includes(c.id) ? 3 : 2}
          dashed={c.construction}
          dashSize={4}
          gapSize={3}
          depthTest={false}
          renderOrder={10}
        />
      ))}

      <points key={points.length} renderOrder={11}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pointPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[pointColors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={7} sizeAttenuation={false} vertexColors depthTest={false} transparent />
      </points>

      {rubber.map((pts, i) => (
        <Line key={i} points={pts} color={C.preview} lineWidth={2} dashed dashSize={3} gapSize={2} depthTest={false} renderOrder={10} />
      ))}
      {guides.map((pts, i) => (
        <Line key={`g${i}`} points={pts} color={C.hover} lineWidth={1} dashed dashSize={2} gapSize={2} depthTest={false} renderOrder={10} />
      ))}

      {sk.dimensions.map((d) => (
        <DimensionLabel key={d.id} sketch={sk} frame={frame} dimId={d.id} centroid={centroid} editing={editingDimId === d.id} units={doc.units} />
      ))}
    </group>
  );
}

function arcThrough(a: Pt, b: Pt, t: Pt): Pt[] | null {
  const d = 2 * (a.x * (b.y - t.y) + b.x * (t.y - a.y) + t.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, t2 = t.x * t.x + t.y * t.y;
  const c = { x: (a2 * (b.y - t.y) + b2 * (t.y - a.y) + t2 * (a.y - b.y)) / d, y: (a2 * (t.x - b.x) + b2 * (a.x - t.x) + t2 * (b.x - a.x)) / d };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  const n = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = n(ang(t) - ang(a)) < n(ang(b) - ang(a));
  const sweep = ccw ? n(ang(b) - ang(a)) : -n(ang(a) - ang(b));
  return [...Array(49).keys()].map((i) => {
    const th = ang(a) + (sweep * i) / 48;
    return { x: c.x + r * Math.cos(th), y: c.y + r * Math.sin(th) };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

function DimensionLabel({ sketch, frame, dimId, centroid, editing, units }: { sketch: Sketch; frame: Frame; dimId: Id; centroid: Pt; editing: boolean; units: Units }) {
  const d = sketch.dimensions.find((x) => x.id === dimId)!;
  const color = d.driving ? C.dimension : C['text-muted'];
  const W = (q: Pt) => toWorld(frame, q, lift);
  let lines: Vec3[][];
  let labelAt: Vec3;
  let prefix = '';
  if (d.kind === 'diameter' || d.kind === 'radius') {
    const e = sketch.entities.find((x) => x.id === d.entityIds[0]);
    if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return null;
    const c = pointOf(sketch, e.center);
    const s0 = e.kind === 'arc' ? pointOf(sketch, e.start) : null;
    const r = e.kind === 'circle' ? e.radius : Math.hypot(s0!.x - c.x, s0!.y - c.y);
    let dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    if (e.kind === 'arc') {
      const m = arcMid(sketch, e);
      const l = Math.hypot(m.x - c.x, m.y - c.y) || 1;
      dir = { x: (m.x - c.x) / l, y: (m.y - c.y) / l };
    }
    const edge = { x: c.x + dir.x * r, y: c.y + dir.y * r };
    const reach = r + Math.max(6, r * 0.4);
    const out = { x: c.x + dir.x * reach, y: c.y + dir.y * reach };
    lines = [[W(d.kind === 'diameter' ? { x: c.x - dir.x * r, y: c.y - dir.y * r } : c), W(edge), W(out)]];
    labelAt = W(out);
    prefix = d.kind === 'diameter' ? '⌀' : 'R';
  } else if (d.kind === 'angle' || d.kind === 'pointLine') {
    const lineEnds = (id: Id): [Pt, Pt] | null => {
      const e = sketch.entities.find((x) => x.id === id);
      return e?.kind === 'line' ? [pointOf(sketch, e.p1), pointOf(sketch, e.p2)] : null;
    };
    if (d.kind === 'angle') {
      const la = lineEnds(d.entityIds[0]);
      const lb = lineEnds(d.entityIds[1]);
      if (!la || !lb) return null;
      const ma = { x: (la[0].x + la[1].x) / 2, y: (la[0].y + la[1].y) / 2 };
      const mb = { x: (lb[0].x + lb[1].x) / 2, y: (lb[0].y + lb[1].y) / 2 };
      const mid = { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 };
      lines = [[W(ma), W(mid), W(mb)]];
      labelAt = W(mid);
      prefix = '∠';
    } else {
      const p = pointOf(sketch, d.entityIds[0]);
      const l = lineEnds(d.entityIds[1]);
      if (!l) return null;
      const [a, b] = l;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
      const foot = { x: a.x + t * dx, y: a.y + t * dy };
      lines = [[W(p), W(foot)]];
      labelAt = W({ x: (p.x + foot.x) / 2, y: (p.y + foot.y) / 2 });
    }
  } else {
    const a = pointOf(sketch, d.entityIds[0]);
    const b = pointOf(sketch, d.entityIds[1]);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((mid.x - centroid.x) * nx + (mid.y - centroid.y) * ny < 0) (nx = -nx), (ny = -ny);
    const off = Math.max(6, len * 0.12);
    const a2 = { x: a.x + nx * off, y: a.y + ny * off };
    const b2 = { x: b.x + nx * off, y: b.y + ny * off };
    lines = [[W(a), W(a2)], [W(b), W(b2)], [W(a2), W(b2)]];
    labelAt = W({ x: mid.x + nx * off, y: mid.y + ny * off });
  }
  const kindWord = prefix === '⌀' ? 'diameter ' : prefix === 'R' ? 'radius ' : prefix === '∠' ? 'angle ' : '';
  const shown = formatDim(d.kind, d.value.value, units);
  const spoken = d.kind === 'angle' ? `${d.value.value.toFixed(1)} degrees` : `${shown} ${unitWord(units)}`;
  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color={color} lineWidth={1} depthTest={false} renderOrder={10} />
      ))}
      <Html position={labelAt} center zIndexRange={[20, 10]}>
        {editing ? (
          <InlineDimEditor dimId={d.id} name={d.name} initial={d.value.expr} angle={d.kind === 'angle'} units={units} />
        ) : (
          <button
            onDoubleClick={() => d.driving && useDoc.getState().setEditingDim(d.id)}
            onKeyDown={(e) => e.key === 'Enter' && d.driving && useDoc.getState().setEditingDim(d.id)}
            title={d.driving ? `${d.name} — double-click to change` : `${d.name} (reference)`}
            aria-label={`Dimension ${d.name}, ${kindWord}${spoken}${d.driving ? '' : ', reference'}`}
            className="px-2 rounded-sm bg-surface-raised/90 font-mono text-xs whitespace-nowrap"
            style={{ color }}
          >
            {d.driving ? '' : '('}
            {prefix === '∠' ? '' : prefix}
            {shown}
            {d.driving ? '' : ')'}
          </button>
        )}
      </Html>
    </group>
  );
}

function InlineDimEditor({ dimId, name, initial, angle, units }: { dimId: Id; name: string; initial: string; angle: boolean; units: Units }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const vars = docVars(useDoc.getState().doc);
  const parsed = angle ? parseValue(text.replace(/°|deg/g, ''), vars) : parseLength(text, units, vars);
  const commit = () => {
    if (parsed.value === undefined) return;
    useDoc.getState().setDimension(dimId, text.trim(), parsed.value);
  };
  return (
    <div
      role="dialog"
      aria-label={`Change ${name}`}
      className="flex items-center gap-2 p-2 rounded-md bg-surface-raised border border-border shadow-pop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="text-2xs text-text-muted font-mono">{name}</label>
      <input
        ref={ref}
        value={text}
        aria-invalid={!!parsed.error}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') useDoc.getState().setEditingDim(null);
        }}
        className={`w-40 h-12 px-2 font-mono text-sm rounded-sm border bg-bg ${parsed.error ? 'border-danger' : 'border-border-input'}`}
      />
      <span className="text-2xs text-text-muted">{angle ? '°' : unitLabel(units)}</span>
      <button className="px-3 h-12 rounded-sm bg-accent text-on-accent text-xs" onClick={commit} disabled={!!parsed.error}>
        OK
      </button>
    </div>
  );
}

/* ---------- axis triad at the origin ---------- */

function Triad() {
  const L = 12;
  return (
    <group>
      <Line points={[[0, 0, 0], [L, 0, 0]]} color={C['axis-x']} lineWidth={2} />
      <Line points={[[0, 0, 0], [0, L, 0]]} color={C['axis-y']} lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 0, L]]} color={C['axis-z']} lineWidth={2} />
    </group>
  );
}

/* ---------- measure ---------- */

function MeasureOverlay() {
  const pts = useView((s) => s.measurePoints);
  const on = useView((s) => s.measuring);
  const units = useDoc((s) => s.doc.units);
  if (!on || !pts.length) return null;
  const k = units === 'in' ? 25.4 : 1;
  const d = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]) : 0;
  const mid: Vec3 = pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, (pts[0][2] + pts[1][2]) / 2] : pts[0];
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={p} renderOrder={13}>
          <sphereGeometry args={[0.8, 12, 12]} />
          <meshBasicMaterial color={C.selected} depthTest={false} />
        </mesh>
      ))}
      {pts.length === 2 && (
        <>
          <Line points={pts} color={C.selected} lineWidth={2} dashed dashSize={2} gapSize={1.5} depthTest={false} renderOrder={12} />
          <Html position={mid} center>
            <div role="status" className="px-3 py-1 rounded-sm bg-surface-raised border border-border shadow-card font-mono text-xs whitespace-nowrap">
              {(d / k).toFixed(units === 'in' ? 4 : 3)} {units}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** Where a hole being placed will start. */
function HoleMarker() {
  const mode = useDoc((s) => s.mode);
  const doc = useDoc((s) => s.doc);
  if (mode.kind !== 'feature' || mode.draft.type !== 'hole' || !mode.draft.at) return null;
  const p = facePointWorld(doc, mode.draft.at);
  if (!p) return null;
  return (
    <mesh position={p} renderOrder={13}>
      <sphereGeometry args={[0.9, 12, 12]} />
      <meshBasicMaterial color={C.preview} depthTest={false} />
    </mesh>
  );
}

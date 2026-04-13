import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellInfo, AxisAssignment, ConceptId } from "./types";
import {
  DIMENSIONS,
  generateCellValue,
  getDimensionById,
  getDimensionDisplayName,
  findCurrentLevel,
} from "./data";
import { CONCEPTS, getConceptById } from "./concepts";
import { OPERATIONS, getOperationById } from "./operations";
import "./OlapCube.css";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */
const CELL_SIZE = 0.8;
const CELL_GAP = 0.4;
const CELL_STRIDE = CELL_SIZE + CELL_GAP;
const AXIS_COLORS: Record<string, { hex: number; css: string }> = {
  x: { hex: 0xc92a2a, css: "#c92a2a" },
  y: { hex: 0x2b8a3e, css: "#2b8a3e" },
  z: { hex: 0x1864ab, css: "#1864ab" },
};
const GREY_COLOR = 0xcccccc;
const GREY_OPACITY = 0.15;

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function valueToColor(v: number, mn: number, mx: number): THREE.Color {
  const t = mx > mn ? (v - mn) / (mx - mn) : 0.5;
  const s: [number, number, number][] = [
    [0.25, 0.55, 0.83],
    [0.18, 0.68, 0.68],
    [0.26, 0.72, 0.45],
    [0.9, 0.72, 0.22],
    [0.85, 0.28, 0.22],
  ];
  const i = t * (s.length - 1);
  const lo = Math.max(0, Math.floor(i));
  const hi = Math.min(s.length - 1, lo + 1);
  const f = i - lo;
  return new THREE.Color(
    s[lo][0] + (s[hi][0] - s[lo][0]) * f,
    s[lo][1] + (s[hi][1] - s[lo][1]) * f,
    s[lo][2] + (s[hi][2] - s[lo][2]) * f,
  );
}

function makeTextSprite(
  text: string,
  opts: { color?: string; size?: number; bold?: boolean; scale?: number } = {},
): THREE.Sprite {
  const { color = "#333", size = 40, bold = false, scale = 1 } = opts;
  const c = document.createElement("canvas");
  const x = c.getContext("2d")!;
  const font = `${bold ? "bold " : ""}${size}px "Segoe UI",Arial,sans-serif`;
  x.font = font;
  const w = x.measureText(text).width;
  const p = 14;
  c.width = Math.ceil(w) + p * 2;
  c.height = Math.ceil(size * 1.35) + p * 2;
  x.font = font;
  x.fillStyle = color;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((c.width / c.height) * scale, scale, 1);
  return sp;
}

function makeBadgeSprite(
  text: string,
  bg: string,
  opts: { scale?: number } = {},
): THREE.Sprite {
  const { scale = 1 } = opts;
  const c = document.createElement("canvas");
  const x = c.getContext("2d")!;
  const fs = 32;
  x.font = `bold ${fs}px "Segoe UI",Arial,sans-serif`;
  const tw = x.measureText(text).width;
  const px = 24;
  const py = 14;
  c.width = Math.ceil(tw) + px * 2;
  c.height = Math.ceil(fs * 1.4) + py * 2;
  x.fillStyle = bg;
  x.beginPath();
  x.roundRect(0, 0, c.width, c.height, c.height / 2);
  x.fill();
  x.font = `bold ${fs}px "Segoe UI",Arial,sans-serif`;
  x.fillStyle = "#fff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((c.width / c.height) * scale, scale, 1);
  return sp;
}

function makeValueLabel(v: number, fc: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.clearRect(0, 0, 128, 128);
  x.font = "bold 42px 'Segoe UI',Arial,sans-serif";
  x.fillStyle = fc;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(v), 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeDashedLine(
  a: THREE.Vector3,
  b: THREE.Vector3,
  col: number,
): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = new THREE.LineDashedMaterial({
    color: col,
    dashSize: 0.15,
    gapSize: 0.08,
    transparent: true,
    opacity: 0.8,
  });
  const l = new THREE.Line(g, m);
  l.computeLineDistances();
  return l;
}

function makeSolidLine(
  a: THREE.Vector3,
  b: THREE.Vector3,
  col: number,
  op = 0.7,
): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = new THREE.LineBasicMaterial({
    color: col,
    transparent: true,
    opacity: op,
  });
  return new THREE.Line(g, m);
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.LineSegments ||
      o instanceof THREE.Line
    ) {
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ("map" in m && (m as any).map) (m as any).map.dispose();
        m.dispose();
      }
    } else if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
  group.clear();
}

function cellKey(c: CellInfo) {
  return `${c.xIndex}-${c.yIndex}-${c.zIndex}`;
}

/* ================================================================== */
/*  Animation types                                                    */
/* ================================================================== */
interface CellAnimTarget {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startScale: number;
  endScale: number;
  startOpacity: number;
  endOpacity: number;
  startColor?: THREE.Color;
  endColor?: THREE.Color;
}

interface OrigState {
  pos: THREE.Vector3;
  scale: number;
  opacity: number;
  color: THREE.Color;
}

interface AnimState {
  opId: string;
  step: number;
  startTime: number;
  duration: number;
  targets: Map<string, CellAnimTarget>;
  originalStates: Map<string, OrigState>;
  tempMeshes: THREE.Mesh[];
  tempMeshMap: Map<string, THREE.Mesh>;
  sceneLabels: THREE.Object3D[];
}

function captureTargets(
  meshMap: Map<string, THREE.Mesh>,
  tempMeshMap: Map<string, THREE.Mesh>,
  endStates: Map<string, Partial<CellAnimTarget>>,
): Map<string, CellAnimTarget> {
  const r = new Map<string, CellAnimTarget>();
  for (const [key, end] of endStates) {
    const mesh = key.startsWith("temp-")
      ? tempMeshMap.get(key)
      : meshMap.get(key);
    if (!mesh) continue;
    const mat = mesh.material as THREE.MeshPhongMaterial;
    r.set(key, {
      startPos: mesh.position.clone(),
      endPos: end.endPos ?? mesh.position.clone(),
      startScale: mesh.scale.x,
      endScale: end.endScale ?? mesh.scale.x,
      startOpacity: mat.opacity,
      endOpacity: end.endOpacity ?? mat.opacity,
      startColor: end.endColor ? mat.color.clone() : undefined,
      endColor: end.endColor,
    });
  }
  return r;
}

function applyProgress(
  meshMap: Map<string, THREE.Mesh>,
  tempMeshMap: Map<string, THREE.Mesh>,
  targets: Map<string, CellAnimTarget>,
  t: number,
) {
  for (const [key, tgt] of targets) {
    const mesh = key.startsWith("temp-")
      ? tempMeshMap.get(key)
      : meshMap.get(key);
    if (!mesh) continue;
    mesh.position.lerpVectors(tgt.startPos, tgt.endPos, t);
    mesh.scale.setScalar(THREE.MathUtils.lerp(tgt.startScale, tgt.endScale, t));
    const mat = mesh.material as THREE.MeshPhongMaterial;
    mat.opacity = THREE.MathUtils.lerp(tgt.startOpacity, tgt.endOpacity, t);
    if (tgt.startColor && tgt.endColor)
      mat.color.copy(tgt.startColor).lerp(tgt.endColor, t);
  }
}

/* ================================================================== */
/*  Scene context                                                      */
/* ================================================================== */
interface CubeMetrics {
  xN: number;
  yN: number;
  zN: number;
  xOff: number;
  yOff: number;
  zOff: number;
  xDimName: string;
  yDimName: string;
  zDimName: string;
  xDimDisplay: string;
  yDimDisplay: string;
  zDimDisplay: string;
  xDimId: string;
  yDimId: string;
  zDimId: string;
  mn: number;
  mx: number;
}

interface SceneCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  cubeGroup: THREE.Group;
  labelGroup: THREE.Group;
  axisGroup: THREE.Group;
  conceptGroup: THREE.Group;
  opGroup: THREE.Group;
  hoveredMesh: THREE.Mesh | null;
  selectedMesh: THREE.Mesh | null;
  animId: number;
  buildTime: number;
  cubeMetrics: CubeMetrics | null;
  meshMap: Map<string, THREE.Mesh>;
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
const OlapCube: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneCtx | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const tableRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const animRef = useRef<AnimState | null>(null);
  const animRafRef = useRef(0);

  const [axes, setAxes] = useState<AxisAssignment>({
    x: "product",
    y: "region",
    z: "time",
  });
  const [selCell, setSelCell] = useState<CellInfo | null>(null);
  const [hoverCell, setHoverCell] = useState<CellInfo | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [conceptMode, setConceptMode] = useState(false);
  const [activeConcepts, setActiveConcepts] = useState<Set<ConceptId>>(
    new Set(),
  );
  const [expandedConcept, setExpandedConcept] = useState<ConceptId | null>(
    null,
  );
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepDone, setStepDone] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);

  const anyConcept = activeConcepts.size > 0;

  /* dimension display names for the current axes */
  const dimDisplayNames = useMemo(
    () => ({
      x: getDimensionDisplayName(getDimensionById(axes.x)!),
      y: getDimensionDisplayName(getDimensionById(axes.y)!),
      z: getDimensionDisplayName(getDimensionById(axes.z)!),
    }),
    [axes],
  );

  /* ================================================================ */
  /*  Cell data                                                        */
  /* ================================================================ */
  const allCells: CellInfo[] = useMemo(() => {
    const xd = getDimensionById(axes.x)!;
    const yd = getDimensionById(axes.y)!;
    const zd = getDimensionById(axes.z)!;
    const cells: CellInfo[] = [];
    for (let xi = 0; xi < xd.members.length; xi++)
      for (let yi = 0; yi < yd.members.length; yi++)
        for (let zi = 0; zi < zd.members.length; zi++)
          cells.push({
            xIndex: xi,
            yIndex: yi,
            zIndex: zi,
            xMember: xd.members[xi],
            yMember: yd.members[yi],
            zMember: zd.members[zi],
            xDimension: xd.name,
            yDimension: yd.name,
            zDimension: zd.name,
            value: generateCellValue([
              xd.members[xi],
              yd.members[yi],
              zd.members[zi],
            ]),
          });
    return cells;
  }, [axes]);

  /* ================================================================ */
  /*  Select cell helper                                               */
  /* ================================================================ */
  const selectCellByInfo = useCallback((cell: CellInfo | null) => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    if (ctx.selectedMesh) {
      const o = ctx.selectedMesh.getObjectByName("sel-outline");
      if (o) {
        ctx.selectedMesh.remove(o);
        (o as THREE.LineSegments).geometry.dispose();
        ((o as THREE.LineSegments).material as THREE.Material).dispose();
      }
      ctx.selectedMesh = null;
    }
    if (!cell) {
      setSelCell(null);
      return;
    }
    const mesh = ctx.meshMap.get(cellKey(cell));
    if (mesh) {
      ctx.selectedMesh = mesh;
      const oG = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12,
        ),
      );
      const oM = new THREE.LineBasicMaterial({ color: 0x222222 });
      const out = new THREE.LineSegments(oG, oM);
      out.name = "sel-outline";
      mesh.add(out);
    }
    setSelCell(cell);
  }, []);

  useEffect(() => {
    if (!selCell) return;
    const row = tableRowRefs.current.get(cellKey(selCell));
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selCell]);

  /* ================================================================ */
  /*  Init Three.js                                                    */
  /* ================================================================ */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(10, 8, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dl1.position.set(8, 12, 8);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xccccff, 0.2);
    dl2.position.set(-6, 4, -6);
    scene.add(dl2);
    const cubeGroup = new THREE.Group();
    const labelGroup = new THREE.Group();
    const axisGroup = new THREE.Group();
    const conceptGroup = new THREE.Group();
    const opGroup = new THREE.Group();
    scene.add(cubeGroup, labelGroup, axisGroup, conceptGroup, opGroup);

    const ctx: SceneCtx = {
      scene,
      camera,
      renderer,
      controls,
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(-999, -999),
      cubeGroup,
      labelGroup,
      axisGroup,
      conceptGroup,
      opGroup,
      hoveredMesh: null,
      selectedMesh: null,
      animId: 0,
      buildTime: 0,
      cubeMetrics: null,
      meshMap: new Map(),
    };
    sceneRef.current = ctx;

    const animate = () => {
      ctx.animId = requestAnimationFrame(animate);
      controls.update();
      const elapsed = performance.now() - ctx.buildTime;
      let idx = 0;
      cubeGroup.children.forEach((c) => {
        if (c instanceof THREE.Mesh && c.userData.cellInfo) {
          if (!c.userData.entryDone) {
            const t = Math.min(1, Math.max(0, (elapsed - idx * 25) / 400));
            if (t >= 1) c.userData.entryDone = true;
            else c.scale.setScalar(1 - Math.pow(1 - t, 3));
          }
          idx++;
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const ww = el.clientWidth;
      const hh = el.clientHeight;
      if (ww === 0 || hh === 0) return;
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(ctx.animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  /* ================================================================ */
  /*  Build cube                                                       */
  /* ================================================================ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    disposeGroup(ctx.cubeGroup);
    disposeGroup(ctx.labelGroup);
    disposeGroup(ctx.axisGroup);
    disposeGroup(ctx.conceptGroup);
    disposeGroup(ctx.opGroup);
    ctx.meshMap.clear();

    const xd = getDimensionById(axes.x)!;
    const yd = getDimensionById(axes.y)!;
    const zd = getDimensionById(axes.z)!;
    const xN = xd.members.length;
    const yN = yd.members.length;
    const zN = zd.members.length;
    const xO = (-(xN - 1) * CELL_STRIDE) / 2;
    const yO = (-(yN - 1) * CELL_STRIDE) / 2;
    const zO = (-(zN - 1) * CELL_STRIDE) / 2;
    const vals = allCells.map((c) => c.value);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);

    ctx.cubeMetrics = {
      xN,
      yN,
      zN,
      xOff: xO,
      yOff: yO,
      zOff: zO,
      xDimName: xd.name,
      yDimName: yd.name,
      zDimName: zd.name,
      xDimDisplay: getDimensionDisplayName(xd),
      yDimDisplay: getDimensionDisplayName(yd),
      zDimDisplay: getDimensionDisplayName(zd),
      xDimId: xd.id,
      yDimId: yd.id,
      zDimId: zd.id,
      mn,
      mx,
    };

    const bG = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const eG = new THREE.EdgesGeometry(bG);
    const eM = new THREE.LineBasicMaterial({
      color: 0x999999,
      transparent: true,
      opacity: 0.35,
    });
    const vpG = new THREE.PlaneGeometry(CELL_SIZE * 0.85, CELL_SIZE * 0.85);

    allCells.forEach((cell) => {
      const col = valueToColor(cell.value, mn, mx);
      const mat = new THREE.MeshPhongMaterial({
        color: col,
        transparent: true,
        opacity: 0.88,
        shininess: 40,
        specular: new THREE.Color(0x222222),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(bG, mat);
      mesh.position.set(
        cell.xIndex * CELL_STRIDE + xO,
        cell.yIndex * CELL_STRIDE + yO,
        cell.zIndex * CELL_STRIDE + zO,
      );
      mesh.userData = { cellInfo: cell, originalColor: col.clone() };
      mesh.scale.setScalar(0);
      mesh.add(new THREE.LineSegments(eG, eM));

      const lum = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
      const tc = lum > 0.52 ? "#1a1a1a" : "#ffffff";
      const addFL = (p: THREE.Vector3, rot: THREE.Euler | null) => {
        const tex = makeValueLabel(cell.value, tc);
        const pm = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
        });
        const pl = new THREE.Mesh(vpG, pm);
        pl.position.copy(p);
        if (rot) pl.rotation.copy(rot);
        mesh.add(pl);
      };
      if (cell.xIndex === xN - 1)
        addFL(
          new THREE.Vector3(CELL_SIZE / 2 + 0.005, 0, 0),
          new THREE.Euler(0, Math.PI / 2, 0),
        );
      if (cell.zIndex === zN - 1)
        addFL(new THREE.Vector3(0, 0, CELL_SIZE / 2 + 0.005), null);
      if (cell.yIndex === yN - 1)
        addFL(
          new THREE.Vector3(0, CELL_SIZE / 2 + 0.005, 0),
          new THREE.Euler(-Math.PI / 2, 0, 0),
        );
      if (cell.xIndex === 0)
        addFL(
          new THREE.Vector3(-CELL_SIZE / 2 - 0.005, 0, 0),
          new THREE.Euler(0, -Math.PI / 2, 0),
        );
      if (cell.zIndex === 0)
        addFL(
          new THREE.Vector3(0, 0, -CELL_SIZE / 2 - 0.005),
          new THREE.Euler(0, Math.PI, 0),
        );
      if (cell.yIndex === 0)
        addFL(
          new THREE.Vector3(0, -CELL_SIZE / 2 - 0.005, 0),
          new THREE.Euler(Math.PI / 2, 0, 0),
        );

      ctx.cubeGroup.add(mesh);
      ctx.meshMap.set(cellKey(cell), mesh);
    });

    /* ---- member labels ---- */
    const lbM = CELL_STRIDE * 0.88;
    xd.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.x.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(i * CELL_STRIDE + xO, yO - lbM, zO - lbM);
      s.userData = { conceptTag: "members" };
      ctx.labelGroup.add(s);
    });
    yd.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.y.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(xO - lbM, i * CELL_STRIDE + yO, zO - lbM);
      s.userData = { conceptTag: "members" };
      ctx.labelGroup.add(s);
    });
    zd.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.z.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(xO - lbM, yO - lbM, i * CELL_STRIDE + zO);
      s.userData = { conceptTag: "members" };
      ctx.labelGroup.add(s);
    });

    /* ---- dimension name labels (with hierarchy level) ---- */
    const nO = CELL_STRIDE * 1.4;
    const dimLabelData: {
      dim: typeof xd;
      axis: "x" | "y" | "z";
      pos: THREE.Vector3;
    }[] = [
      {
        dim: xd,
        axis: "x",
        pos: new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          yO - nO,
          zO - lbM,
        ),
      },
      {
        dim: yd,
        axis: "y",
        pos: new THREE.Vector3(
          xO - nO,
          ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          zO - lbM,
        ),
      },
      {
        dim: zd,
        axis: "z",
        pos: new THREE.Vector3(
          xO - lbM,
          yO - nO,
          ((zN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
        ),
      },
    ];
    dimLabelData.forEach(({ dim, axis, pos }) => {
      const displayName = getDimensionDisplayName(dim);
      const s = makeTextSprite(displayName, {
        color: AXIS_COLORS[axis].css,
        size: 34,
        bold: true,
        scale: 0.65,
      });
      s.position.copy(pos);
      s.userData = { conceptTag: "dimensions" };
      ctx.labelGroup.add(s);
    });

    /* ---- axis lines ---- */
    const base = new THREE.Vector3(
      xO - CELL_STRIDE * 0.5,
      yO - CELL_STRIDE * 0.5,
      zO - CELL_STRIDE * 0.5,
    );
    const addAL = (a: THREE.Vector3, b: THREE.Vector3, c: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const m = new THREE.LineBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.55,
      });
      const l = new THREE.Line(g, m);
      l.userData = { conceptTag: "dimensions" };
      ctx.axisGroup.add(l);
    };
    addAL(
      base.clone(),
      new THREE.Vector3(-base.x + CELL_STRIDE * 0.3, base.y, base.z),
      AXIS_COLORS.x.hex,
    );
    addAL(
      base.clone(),
      new THREE.Vector3(base.x, -base.y + CELL_STRIDE * 0.3, base.z),
      AXIS_COLORS.y.hex,
    );
    addAL(
      base.clone(),
      new THREE.Vector3(base.x, base.y, -base.z + CELL_STRIDE * 0.3),
      AXIS_COLORS.z.hex,
    );

    ctx.buildTime = performance.now();
    ctx.hoveredMesh = null;
    ctx.selectedMesh = null;
    setSelCell(null);
    setHoverCell(null);
  }, [axes, allCells]);

  /* ================================================================ */
  /*  Concept overlay                                                  */
  /* ================================================================ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !ctx.cubeMetrics) return;
    disposeGroup(ctx.conceptGroup);
    const met = ctx.cubeMetrics;
    const { xN, yN, zN, xOff: xO, yOff: yO, zOff: zO } = met;

    /* ---- grey / un-grey ---- */
    ctx.cubeGroup.children.forEach((c) => {
      if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
      const mat = c.material as THREE.MeshPhongMaterial;
      const oc = c.userData.originalColor as THREE.Color;
      if (!anyConcept && !activeOp) {
        mat.color.copy(oc);
        mat.opacity = 0.88;
        return;
      }
      if (activeOp) return;
      const hl =
        activeConcepts.has("cells") ||
        activeConcepts.has("facts") ||
        activeConcepts.has("measures");
      mat.color.setHex(hl ? undefined! : GREY_COLOR);
      if (hl) mat.color.copy(oc);
      else mat.color.setHex(GREY_COLOR);
      mat.opacity = hl ? 0.88 : GREY_OPACITY;
    });

    const uLV = (o: THREE.Object3D) => {
      if (!anyConcept && !activeOp) {
        if (o instanceof THREE.Sprite) o.material.opacity = 1;
        if (o instanceof THREE.Line)
          (o.material as THREE.LineBasicMaterial).opacity = 0.55;
        return;
      }
      if (activeOp) return;
      const tag = o.userData.conceptTag as string | undefined;
      const rel = tag && activeConcepts.has(tag as ConceptId);
      if (o instanceof THREE.Sprite) o.material.opacity = rel ? 1 : 0.15;
      if (o instanceof THREE.Line)
        (o.material as THREE.LineBasicMaterial).opacity = rel ? 0.7 : 0.08;
    };
    ctx.labelGroup.children.forEach(uLV);
    ctx.axisGroup.children.forEach(uLV);

    if (!anyConcept) return;

    const cc = new THREE.Vector3(
      xO + ((xN - 1) * CELL_STRIDE) / 2,
      yO + ((yN - 1) * CELL_STRIDE) / 2,
      zO + ((zN - 1) * CELL_STRIDE) / 2,
    );

    /* ---- DIMENSIONS ---- */
    if (activeConcepts.has("dimensions")) {
      const cd = getConceptById("dimensions");
      (["x", "y", "z"] as const).forEach((ax) => {
        const dn =
          ax === "x"
            ? met.xDimDisplay
            : ax === "y"
              ? met.yDimDisplay
              : met.zDimDisplay;
        const n = ax === "x" ? xN : ax === "y" ? yN : zN;
        const off =
          ax === "x"
            ? new THREE.Vector3(
                ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
                yO - CELL_STRIDE,
                zO - CELL_STRIDE,
              )
            : ax === "y"
              ? new THREE.Vector3(
                  xO - CELL_STRIDE,
                  ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
                  zO - CELL_STRIDE,
                )
              : new THREE.Vector3(
                  xO - CELL_STRIDE,
                  yO - CELL_STRIDE,
                  ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
                );
        const badge = makeBadgeSprite(`DIMENSION: ${dn}`, cd.color, {
          scale: 0.55,
        });
        badge.position.copy(off);
        ctx.conceptGroup.add(badge);
        const ae =
          ax === "x"
            ? new THREE.Vector3(
                ((n - 1) * CELL_STRIDE) / 2 + xO + CELL_STRIDE * 0.6,
                yO - CELL_STRIDE * 0.5,
                zO - CELL_STRIDE * 0.5,
              )
            : ax === "y"
              ? new THREE.Vector3(
                  xO - CELL_STRIDE * 0.5,
                  ((n - 1) * CELL_STRIDE) / 2 + yO + CELL_STRIDE * 0.6,
                  zO - CELL_STRIDE * 0.5,
                )
              : new THREE.Vector3(
                  xO - CELL_STRIDE * 0.5,
                  yO - CELL_STRIDE * 0.5,
                  ((n - 1) * CELL_STRIDE) / 2 + zO + CELL_STRIDE * 0.6,
                );
        ctx.conceptGroup.add(
          makeDashedLine(off, ae, new THREE.Color(cd.color).getHex()),
        );
      });
    }

    /* ---- MEMBERS ---- */
    if (activeConcepts.has("members")) {
      const cd = getConceptById("members");
      const mp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 1.6,
        zO - CELL_STRIDE * 1.6,
      );
      const badge = makeBadgeSprite("MEMBER (value in a dimension)", cd.color, {
        scale: 0.48,
      });
      badge.position.copy(mp);
      ctx.conceptGroup.add(badge);
      const tp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 0.88,
        zO - CELL_STRIDE * 0.88,
      );
      ctx.conceptGroup.add(
        makeDashedLine(mp, tp, new THREE.Color(cd.color).getHex()),
      );
      const rg = new THREE.RingGeometry(0.32, 0.38, 32);
      const rm = new THREE.MeshBasicMaterial({
        color: cd.color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const rr = new THREE.Mesh(rg, rm);
      rr.position.copy(tp);
      ctx.conceptGroup.add(rr);
    }

    /* ---- CELLS ---- */
    if (activeConcepts.has("cells")) {
      const cd = getConceptById("cells");
      const ci = Math.min(1, xN - 1),
        cj = Math.min(1, yN - 1),
        ck = Math.min(1, zN - 1);
      const cp = new THREE.Vector3(
        ci * CELL_STRIDE + xO,
        cj * CELL_STRIDE + yO,
        ck * CELL_STRIDE + zO,
      );
      const hG = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          CELL_SIZE * 1.25,
          CELL_SIZE * 1.25,
          CELL_SIZE * 1.25,
        ),
      );
      const hM = new THREE.LineBasicMaterial({
        color: cd.color,
        transparent: true,
        opacity: 0.9,
      });
      const h = new THREE.LineSegments(hG, hM);
      h.position.copy(cp);
      ctx.conceptGroup.add(h);
      const bp = cp
        .clone()
        .add(new THREE.Vector3(CELL_STRIDE * 1.4, CELL_STRIDE * 1.4, 0));
      const bb = makeBadgeSprite("CELL (intersection)", cd.color, {
        scale: 0.48,
      });
      bb.position.copy(bp);
      ctx.conceptGroup.add(bb);
      ctx.conceptGroup.add(
        makeDashedLine(bp, cp, new THREE.Color(cd.color).getHex()),
      );
    }

    /* ---- MEASURES ---- */
    if (activeConcepts.has("measures")) {
      const cd = getConceptById("measures");
      const fp = new THREE.Vector3(
        Math.min(1, xN - 1) * CELL_STRIDE + xO,
        Math.min(1, yN - 1) * CELL_STRIDE + yO,
        (zN - 1) * CELL_STRIDE + zO + CELL_SIZE / 2 + 0.01,
      );
      const bp = fp.clone().add(new THREE.Vector3(0, 0, CELL_STRIDE * 2));
      const b = makeBadgeSprite("MEASURE (numeric value)", cd.color, {
        scale: 0.48,
      });
      b.position.copy(bp);
      ctx.conceptGroup.add(b);
      ctx.conceptGroup.add(
        makeDashedLine(bp, fp, new THREE.Color(cd.color).getHex()),
      );
    }

    /* ---- FACTS ---- */
    if (activeConcepts.has("facts")) {
      const cd = getConceptById("facts");
      const hx = ((xN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const hy = ((yN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const hz = ((zN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const bG2 = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      );
      const bM2 = new THREE.LineDashedMaterial({
        color: cd.color,
        dashSize: 0.25,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.6,
      });
      const bb2 = new THREE.LineSegments(bG2, bM2);
      bb2.computeLineDistances();
      bb2.position.copy(cc);
      ctx.conceptGroup.add(bb2);
      const bp = cc
        .clone()
        .add(new THREE.Vector3(hx + CELL_STRIDE, hy + CELL_STRIDE, 0));
      const b = makeBadgeSprite("FACT TABLE (all data)", cd.color, {
        scale: 0.52,
      });
      b.position.copy(bp);
      ctx.conceptGroup.add(b);
      ctx.conceptGroup.add(
        makeDashedLine(
          bp,
          cc.clone().add(new THREE.Vector3(hx * 0.5, hy * 0.5, 0)),
          new THREE.Color(cd.color).getHex(),
        ),
      );
    }

    /* ---- GRANULARITY ---- */
    if (activeConcepts.has("granularity")) {
      const cd = getConceptById("granularity");
      const y2 = yO - CELL_STRIDE * 0.5;
      const z2 = zO - CELL_STRIDE * 0.5;
      for (let i = 0; i < xN; i++) {
        const dG = new THREE.SphereGeometry(0.06, 12, 12);
        const dM = new THREE.MeshBasicMaterial({ color: cd.color });
        const d = new THREE.Mesh(dG, dM);
        d.position.set(i * CELL_STRIDE + xO, y2, z2);
        ctx.conceptGroup.add(d);
      }
      if (xN >= 2) {
        const bY = y2 - 0.4;
        ctx.conceptGroup.add(
          makeSolidLine(
            new THREE.Vector3(xO, bY, z2),
            new THREE.Vector3((xN - 1) * CELL_STRIDE + xO, bY, z2),
            new THREE.Color(cd.color).getHex(),
          ),
        );
        for (let i = 0; i < xN; i++) {
          ctx.conceptGroup.add(
            makeSolidLine(
              new THREE.Vector3(i * CELL_STRIDE + xO, y2, z2),
              new THREE.Vector3(i * CELL_STRIDE + xO, bY, z2),
              new THREE.Color(cd.color).getHex(),
              0.4,
            ),
          );
        }
      }
      const granBadge = makeBadgeSprite(
        `GRANULARITY: ${xN} members (${met.xDimDisplay})`,
        cd.color,
        { scale: 0.45 },
      );
      granBadge.position.set(((xN - 1) * CELL_STRIDE) / 2 + xO, y2 - 1.0, z2);
      ctx.conceptGroup.add(granBadge);
    }

    /* ---- ATTRIBUTES ---- */
    if (activeConcepts.has("attributes")) {
      const cd = getConceptById("attributes");
      const tp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 0.88,
        zO - CELL_STRIDE * 0.88,
      );
      const xDim = getDimensionById(met.xDimId)!;
      const attrs = [
        { k: "Name", v: xDim.members[0] },
        { k: "Code", v: "SKU-001" },
        { k: "Color", v: "Silver" },
        { k: "Weight", v: "0.4 kg" },
      ];
      const sy = tp.y;
      const ax = tp.x - CELL_STRIDE * 2.5;
      const az = tp.z - CELL_STRIDE * 0.5;
      attrs.forEach((a, i) => {
        const l = makeBadgeSprite(
          `${a.k}: ${a.v}`,
          i === 0 ? cd.color : "#6366f1",
          { scale: 0.35 },
        );
        l.position.set(ax, sy - i * 0.45, az);
        ctx.conceptGroup.add(l);
      });
      const mb = makeBadgeSprite("ATTRIBUTES (member properties)", cd.color, {
        scale: 0.45,
      });
      mb.position.set(ax, sy + 0.6, az);
      ctx.conceptGroup.add(mb);
      ctx.conceptGroup.add(
        makeDashedLine(
          new THREE.Vector3(ax + 0.8, sy - 0.2, az),
          tp,
          new THREE.Color(cd.color).getHex(),
        ),
      );
    }

    /* ---- HIERARCHIES ---- */
    if (activeConcepts.has("hierarchies")) {
      const cd = getConceptById("hierarchies");
      const xDim = getDimensionById(met.xDimId)!;
      const hier = xDim.hierarchy;

      if (hier && hier.length > 0) {
        const treeBaseX = ((xN - 1) * CELL_STRIDE) / 2 + xO + CELL_STRIDE * 2.5;
        const treeBaseY = yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE;
        const treeBaseZ = zO + ((zN - 1) * CELL_STRIDE) / 2;
        const levelSpacing = 1.6;
        const conceptCol = new THREE.Color(cd.color).getHex();

        /* which level is currently displayed? */
        const currentLevelName = findCurrentLevel(xDim);

        /* title */
        const titleBadge = makeBadgeSprite(
          `HIERARCHY: ${xDim.name}`,
          cd.color,
          { scale: 0.52 },
        );
        titleBadge.position.set(treeBaseX, treeBaseY + 1.0, treeBaseZ);
        ctx.conceptGroup.add(titleBadge);

        /* draw tree */
        interface NodeInfo {
          pos: THREE.Vector3;
        }
        const levelNodes: NodeInfo[][] = [];
        let maxDisplayWidth = 0;

        hier.forEach((level, li) => {
          const yPos = treeBaseY - li * levelSpacing;
          const displayMembers =
            level.members.length > 4
              ? [...level.members.slice(0, 3), "…"]
              : [...level.members];
          const memberSpacing = 1.2;
          const totalWidth = Math.max(
            0,
            (displayMembers.length - 1) * memberSpacing,
          );
          if (totalWidth > maxDisplayWidth) maxDisplayWidth = totalWidth;
          const nodes: NodeInfo[] = [];

          const isCurrent = level.levelName === currentLevelName;

          /* level name label */
          const levelLabel = makeBadgeSprite(
            isCurrent ? `▸ ${level.levelName} (current)` : level.levelName,
            isCurrent ? cd.color : "#777",
            { scale: 0.35 },
          );
          levelLabel.position.set(
            treeBaseX - totalWidth / 2 - 1.8,
            yPos,
            treeBaseZ,
          );
          ctx.conceptGroup.add(levelLabel);

          /* member nodes */
          displayMembers.forEach((member, mi) => {
            const xPos = treeBaseX - totalWidth / 2 + mi * memberSpacing;
            const pos = new THREE.Vector3(xPos, yPos, treeBaseZ);

            const nodeRadius = isCurrent ? 0.22 : 0.16;
            const nodeG = new THREE.CircleGeometry(nodeRadius, 24);
            const nodeM = new THREE.MeshBasicMaterial({
              color: isCurrent ? cd.color : "#999",
              side: THREE.DoubleSide,
              depthTest: false,
              transparent: true,
              opacity: isCurrent ? 0.95 : 0.65,
            });
            const node = new THREE.Mesh(nodeG, nodeM);
            node.position.copy(pos);
            ctx.conceptGroup.add(node);

            const lbl = makeTextSprite(member, {
              color: isCurrent ? "#111" : "#666",
              size: isCurrent ? 28 : 24,
              bold: isCurrent,
              scale: 0.35,
            });
            lbl.position.set(xPos, yPos - 0.4, treeBaseZ);
            ctx.conceptGroup.add(lbl);

            nodes.push({ pos });
          });

          levelNodes.push(nodes);
        });

        /* connecting lines */
        for (let li = 0; li < levelNodes.length - 1; li++) {
          const parents = levelNodes[li];
          const children = levelNodes[li + 1];
          if (parents.length === 0 || children.length === 0) continue;
          const cpp = Math.max(1, Math.ceil(children.length / parents.length));
          children.forEach((child, ci) => {
            const pi = Math.min(Math.floor(ci / cpp), parents.length - 1);
            ctx.conceptGroup.add(
              makeSolidLine(
                parents[pi].pos.clone().add(new THREE.Vector3(0, -0.25, 0)),
                child.pos.clone().add(new THREE.Vector3(0, 0.25, 0)),
                conceptCol,
                0.35,
              ),
            );
          });
        }

        /* connector to the X axis */
        const axisTarget = new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + xO + CELL_STRIDE * 0.6,
          yO - CELL_STRIDE * 0.5,
          zO - CELL_STRIDE * 0.5,
        );
        const treeBottom = new THREE.Vector3(
          treeBaseX,
          treeBaseY - (hier.length - 1) * levelSpacing - 0.8,
          treeBaseZ,
        );
        ctx.conceptGroup.add(
          makeDashedLine(treeBottom, axisTarget, conceptCol),
        );

        /* drill / roll annotation */
        const annotateX = treeBaseX + maxDisplayWidth * 0.5 + 2.2;
        const annotateYTop = treeBaseY - 0.2;
        const annotateYBot = treeBaseY - (hier.length - 1) * levelSpacing + 0.2;

        const arrowLabel = makeBadgeSprite(
          "▼ Drill Down  ▲ Roll Up",
          cd.color,
          { scale: 0.36 },
        );
        arrowLabel.position.set(
          annotateX,
          (annotateYTop + annotateYBot) / 2,
          treeBaseZ,
        );
        ctx.conceptGroup.add(arrowLabel);

        ctx.conceptGroup.add(
          makeSolidLine(
            new THREE.Vector3(annotateX, annotateYTop, treeBaseZ),
            new THREE.Vector3(annotateX, annotateYBot, treeBaseZ),
            conceptCol,
            0.45,
          ),
        );
      }
    }
  }, [activeConcepts, anyConcept, axes, allCells, activeOp]);

  /* ================================================================ */
  /*  Operation step targets                                           */
  /* ================================================================ */
  const getStepEndTargets = useCallback(
    (opId: string, step: number): Map<string, Partial<CellAnimTarget>> => {
      const ctx = sceneRef.current;
      const anim = animRef.current;
      if (!ctx || !ctx.cubeMetrics || !anim) return new Map();
      const met = ctx.cubeMetrics;
      const { xN, yN, zN, xOff: xO, yOff: yO, zOff: zO } = met;
      const ends = new Map<string, Partial<CellAnimTarget>>();
      const sliceZ = Math.min(1, zN - 1);
      const diceXMax = Math.min(1, xN - 1);
      const diceYMax = Math.min(1, yN - 1);

      switch (opId) {
        case "slice": {
          if (step === 0) {
            ctx.meshMap.forEach((m, k) => {
              const info = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: info.zIndex === sliceZ ? 1 : 0.12,
                endColor:
                  info.zIndex === sliceZ
                    ? oc.clone()
                    : new THREE.Color(0xdddddd),
                endScale: info.zIndex === sliceZ ? 1.05 : 0.9,
              });
            });
          } else if (step === 1) {
            ctx.meshMap.forEach((m, k) => {
              const info = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: info.zIndex === sliceZ ? 1 : 0,
                endScale: info.zIndex === sliceZ ? 1 : 0.01,
                endColor:
                  info.zIndex === sliceZ
                    ? oc.clone()
                    : new THREE.Color(0xdddddd),
              });
            });
          } else {
            ctx.meshMap.forEach((m, k) => {
              const info = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              if (info.zIndex === sliceZ) {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    info.xIndex * CELL_STRIDE + xO,
                    info.yIndex * CELL_STRIDE + yO,
                    0,
                  ),
                  endOpacity: 1,
                  endScale: 1.1,
                  endColor: oc.clone(),
                });
              } else {
                ends.set(k, { endOpacity: 0, endScale: 0.01 });
              }
            });
          }
          break;
        }
        case "dice": {
          const inD = (i: CellInfo) =>
            i.xIndex <= diceXMax && i.yIndex <= diceYMax;
          if (step === 0) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: inD(i) ? 1 : 0.1,
                endColor: inD(i) ? oc.clone() : new THREE.Color(0xdddddd),
                endScale: inD(i) ? 1.05 : 0.85,
              });
            });
          } else if (step === 1) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: inD(i) ? 1 : 0,
                endScale: inD(i) ? 1 : 0.01,
                endColor: inD(i) ? oc.clone() : new THREE.Color(0xdddddd),
              });
            });
          } else {
            const cxO = (-diceXMax * CELL_STRIDE) / 2;
            const cyO = (-diceYMax * CELL_STRIDE) / 2;
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              if (inD(i)) {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    i.xIndex * CELL_STRIDE + cxO,
                    i.yIndex * CELL_STRIDE + cyO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 1,
                  endScale: 1.08,
                  endColor: oc.clone(),
                });
              } else {
                ends.set(k, { endOpacity: 0, endScale: 0.01 });
              }
            });
          }
          break;
        }
        case "pivot": {
          if (step === 0) {
            ctx.meshMap.forEach((m, k) => {
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: 0.95,
                endColor: oc.clone().offsetHSL(0, -0.1, 0.05),
              });
            });
          } else {
            const nxO = (-(yN - 1) * CELL_STRIDE) / 2;
            const nyO = (-(xN - 1) * CELL_STRIDE) / 2;
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endPos: new THREE.Vector3(
                  i.yIndex * CELL_STRIDE + nxO,
                  i.xIndex * CELL_STRIDE + nyO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOpacity: 0.88,
                endScale: 1,
                endColor: oc.clone(),
              });
            });
          }
          break;
        }
        case "drilldown": {
          if (step === 0) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              ends.set(k, {
                endOpacity: i.xIndex === 0 ? 1 : 0.5,
                endColor:
                  i.xIndex === 0 ? oc.clone() : new THREE.Color(0xcccccc),
                endScale: i.xIndex === 0 ? 1.08 : 0.92,
              });
            });
          } else if (step === 1) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              if (i.xIndex === 0) {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    xO - CELL_STRIDE * 0.1,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 1,
                  endScale: 1,
                  endColor: oc.clone(),
                });
              } else {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    (i.xIndex + 1) * CELL_STRIDE + xO,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 0.65,
                  endScale: 1,
                  endColor: oc.clone().lerp(new THREE.Color(0xcccccc), 0.3),
                });
              }
            });
            anim.tempMeshMap.forEach((tm, k) => {
              ends.set(k, {
                endPos: new THREE.Vector3(
                  xO + CELL_STRIDE * 0.9,
                  tm.position.y,
                  tm.position.z,
                ),
                endOpacity: 1,
                endScale: 1,
              });
            });
          } else {
            const nxO = (-xN * CELL_STRIDE) / 2;
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              const newX = i.xIndex === 0 ? 0 : i.xIndex + 1;
              ends.set(k, {
                endPos: new THREE.Vector3(
                  newX * CELL_STRIDE + nxO,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOpacity: 0.88,
                endScale: 1,
                endColor: oc.clone(),
              });
            });
            anim.tempMeshMap.forEach((tm, k) => {
              const nxO2 = (-xN * CELL_STRIDE) / 2;
              ends.set(k, {
                endPos: new THREE.Vector3(
                  1 * CELL_STRIDE + nxO2,
                  tm.position.y,
                  tm.position.z,
                ),
                endOpacity: 0.88,
                endScale: 1,
              });
            });
          }
          break;
        }
        case "rollup": {
          if (step === 0) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              const hl = i.xIndex === 0 || i.xIndex === 1;
              ends.set(k, {
                endOpacity: hl ? 1 : 0.45,
                endColor: hl ? oc.clone() : new THREE.Color(0xcccccc),
                endScale: hl ? 1.06 : 0.92,
              });
            });
          } else if (step === 1) {
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              if (i.xIndex === 1) {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    0 * CELL_STRIDE + xO,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 0,
                  endScale: 0.5,
                  endColor: oc.clone(),
                });
              } else if (i.xIndex === 0) {
                ends.set(k, {
                  endOpacity: 1,
                  endScale: 1.2,
                  endColor: oc.clone().offsetHSL(0, 0.1, 0.05),
                });
              } else {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    (i.xIndex - 1) * CELL_STRIDE + xO,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 0.7,
                  endScale: 1,
                  endColor: oc.clone(),
                });
              }
            });
          } else {
            const nxN = xN - 1;
            const nxO2 = (-(nxN - 1) * CELL_STRIDE) / 2;
            ctx.meshMap.forEach((m, k) => {
              const i = m.userData.cellInfo as CellInfo;
              const oc = m.userData.originalColor as THREE.Color;
              if (i.xIndex === 1) {
                ends.set(k, { endOpacity: 0, endScale: 0.01 });
              } else if (i.xIndex === 0) {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    0 * CELL_STRIDE + nxO2,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 1,
                  endScale: 1.15,
                  endColor: oc.clone().offsetHSL(0.02, 0.1, 0.05),
                });
              } else {
                ends.set(k, {
                  endPos: new THREE.Vector3(
                    (i.xIndex - 1) * CELL_STRIDE + nxO2,
                    i.yIndex * CELL_STRIDE + yO,
                    i.zIndex * CELL_STRIDE + zO,
                  ),
                  endOpacity: 0.88,
                  endScale: 1,
                  endColor: oc.clone(),
                });
              }
            });
          }
          break;
        }
      }
      return ends;
    },
    [],
  );

  /* ================================================================ */
  /*  Operation step scene labels                                      */
  /* ================================================================ */
  const createStepLabels = useCallback(
    (opId: string, step: number): THREE.Object3D[] => {
      const ctx = sceneRef.current;
      if (!ctx || !ctx.cubeMetrics) return [];
      const met = ctx.cubeMetrics;
      const { xN, yN, zN, xOff: xO, yOff: yO, zOff: zO } = met;
      const labels: THREE.Object3D[] = [];
      const opDef = getOperationById(opId);
      if (!opDef) return [];
      const color = opDef.color;

      switch (opId) {
        case "slice": {
          const sliceZ = Math.min(1, zN - 1);
          const zd = getDimensionById(met.zDimId)!;
          const memberName = zd.members[sliceZ];
          if (step === 0) {
            const b = makeBadgeSprite(
              `✂️ Slice: ${met.zDimDisplay} = "${memberName}"`,
              color,
              { scale: 0.55 },
            );
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
              sliceZ * CELL_STRIDE + zO,
            );
            labels.push(b);
            const plW = (xN - 1) * CELL_STRIDE + CELL_SIZE * 1.5;
            const plH = (yN - 1) * CELL_STRIDE + CELL_SIZE * 1.5;
            const plG = new THREE.PlaneGeometry(plW, plH);
            const plM = new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.08,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const pl = new THREE.Mesh(plG, plM);
            pl.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2,
              sliceZ * CELL_STRIDE + zO,
            );
            labels.push(pl);
            const plBG = new THREE.EdgesGeometry(plG);
            const plBM = new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.5,
            });
            const plB = new THREE.LineSegments(plBG, plBM);
            plB.position.copy(pl.position);
            labels.push(plB);
          } else if (step === 1) {
            const b = makeBadgeSprite(
              "Removing cells outside the plane…",
              color,
              { scale: 0.5 },
            );
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO - CELL_STRIDE * 2,
              zO - CELL_STRIDE,
            );
            labels.push(b);
          } else {
            const b = makeBadgeSprite(
              `Result: 2D table (${met.xDimDisplay} × ${met.yDimDisplay})`,
              color,
              { scale: 0.55 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
              0,
            );
            labels.push(b);
          }
          break;
        }
        case "dice": {
          const xd = getDimensionById(met.xDimId)!;
          const yd = getDimensionById(met.yDimId)!;
          const dx = Math.min(1, xN - 1);
          const dy = Math.min(1, yN - 1);
          if (step === 0) {
            const b = makeBadgeSprite(
              `🎲 Dice: ${xd.name} ∈ {${xd.members.slice(0, dx + 1).join(", ")}}, ${yd.name} ∈ {${yd.members.slice(0, dy + 1).join(", ")}}`,
              color,
              { scale: 0.48 },
            );
            b.position.set(
              xO + (dx * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
            const bw = (dx + 1) * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4;
            const bh = (dy + 1) * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4;
            const bd = zN * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4;
            const bbG = new THREE.EdgesGeometry(
              new THREE.BoxGeometry(bw, bh, bd),
            );
            const bbM = new THREE.LineDashedMaterial({
              color,
              dashSize: 0.2,
              gapSize: 0.1,
              transparent: true,
              opacity: 0.6,
            });
            const bb = new THREE.LineSegments(bbG, bbM);
            bb.computeLineDistances();
            bb.position.set(
              xO + (dx * CELL_STRIDE) / 2,
              yO + (dy * CELL_STRIDE) / 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(bb);
          } else if (step === 1) {
            const b = makeBadgeSprite("Extracting sub-cube…", color, {
              scale: 0.48,
            });
            b.position.set(xO - CELL_STRIDE * 2, yO, zO);
            labels.push(b);
          } else {
            const b = makeBadgeSprite(
              `Sub-cube: ${dx + 1}×${dy + 1}×${zN} = ${(dx + 1) * (dy + 1) * zN} cells`,
              color,
              { scale: 0.5 },
            );
            b.position.set(
              0,
              yO + (dy * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
          }
          break;
        }
        case "pivot": {
          if (step === 0) {
            const b = makeBadgeSprite(
              `🔄 Pivot: Swap ${met.xDimDisplay} (X) ↔ ${met.yDimDisplay} (Y)`,
              color,
              { scale: 0.52 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            labels.push(b);
          } else if (step === 1) {
            const b = makeBadgeSprite("Rotating cells…", color, {
              scale: 0.48,
            });
            b.position.set(
              0,
              yO + ((Math.max(xN, yN) - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            labels.push(b);
          } else {
            const b = makeBadgeSprite(
              `Done: X = ${met.yDimDisplay}, Y = ${met.xDimDisplay}`,
              color,
              { scale: 0.52 },
            );
            b.position.set(
              0,
              yO + ((Math.max(xN, yN) - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            labels.push(b);
          }
          break;
        }
        case "drilldown": {
          const xd = getDimensionById(met.xDimId)!;
          const hier = xd.hierarchy;
          const parentName = xd.members[0];
          const children =
            hier && hier.length >= 3
              ? hier[2].members.slice(0, 2)
              : ["Child A", "Child B"];
          const curLevel = findCurrentLevel(xd) ?? "Current";
          const nextLevel = hier
            ? (hier.find((_l, i) => i > 0 && hier[i - 1].levelName === curLevel)
                ?.levelName ?? "Detail")
            : "Detail";
          if (step === 0) {
            const b = makeBadgeSprite(`🔍 Current level: ${curLevel}`, color, {
              scale: 0.5,
            });
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
          } else if (step === 1) {
            const b = makeBadgeSprite(
              `Expanding "${parentName}" → ${children.join(", ")}`,
              color,
              { scale: 0.48 },
            );
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
            const a1 = makeBadgeSprite(children[0], "#2d9", { scale: 0.38 });
            a1.position.set(
              xO - CELL_STRIDE * 0.1,
              yO - CELL_STRIDE * 1.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(a1);
            const a2 = makeBadgeSprite(children[1] ?? "…", "#29d", {
              scale: 0.38,
            });
            a2.position.set(
              xO + CELL_STRIDE * 0.9,
              yO - CELL_STRIDE * 1.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(a2);
          } else {
            const b = makeBadgeSprite(
              `Detail: ${nextLevel} level (${xN + 1} positions)`,
              color,
              { scale: 0.5 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
          }
          break;
        }
        case "rollup": {
          const xd = getDimensionById(met.xDimId)!;
          const curLevel = findCurrentLevel(xd) ?? "Detail";
          if (step === 0) {
            const b = makeBadgeSprite(
              `📊 Current: ${curLevel} (${xN} members)`,
              color,
              { scale: 0.5 },
            );
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
          } else if (step === 1) {
            const b = makeBadgeSprite(
              `Merging "${xd.members[0]}" + "${xd.members[Math.min(1, xN - 1)]}" → aggregated`,
              color,
              { scale: 0.48 },
            );
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
            const sb = makeBadgeSprite("Σ Sum", "#d97706", { scale: 0.4 });
            sb.position.set(
              xO + CELL_STRIDE * 0.1,
              yO - CELL_STRIDE * 1.2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(sb);
          } else {
            const b = makeBadgeSprite(
              `Summary: ${xN - 1} members (aggregated)`,
              color,
              { scale: 0.5 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            labels.push(b);
          }
          break;
        }
      }
      return labels;
    },
    [],
  );

  /* ================================================================ */
  /*  Operation lifecycle                                              */
  /* ================================================================ */
  const setupStep = useCallback(
    (opId: string, step: number) => {
      const ctx = sceneRef.current;
      const anim = animRef.current;
      if (!ctx || !anim) return;

      anim.sceneLabels.forEach((l) => {
        ctx.opGroup.remove(l);
        if (l instanceof THREE.Mesh) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
        if (l instanceof THREE.Sprite) {
          l.material.map?.dispose();
          l.material.dispose();
        }
        if (l instanceof THREE.LineSegments) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
      });
      anim.sceneLabels = [];

      if (opId === "drilldown" && step === 1 && anim.tempMeshes.length === 0) {
        let ti = 0;
        ctx.meshMap.forEach((m) => {
          const info = m.userData.cellInfo as CellInfo;
          if (info.xIndex !== 0) return;
          const oc = m.userData.originalColor as THREE.Color;
          const tm = new THREE.Mesh(
            new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE),
            new THREE.MeshPhongMaterial({
              color: oc.clone().offsetHSL(0.08, 0, 0.04),
              transparent: true,
              opacity: 0,
              shininess: 40,
              specular: new THREE.Color(0x222222),
            }),
          );
          tm.position.copy(m.position);
          tm.scale.setScalar(0.01);
          const eG2 = new THREE.EdgesGeometry(tm.geometry);
          const eM2 = new THREE.LineBasicMaterial({
            color: 0x999999,
            transparent: true,
            opacity: 0.35,
          });
          tm.add(new THREE.LineSegments(eG2, eM2));
          ctx.cubeGroup.add(tm);
          anim.tempMeshes.push(tm);
          anim.tempMeshMap.set(`temp-${ti++}`, tm);
        });
      }

      const endTargets = getStepEndTargets(opId, step);
      const targets = captureTargets(ctx.meshMap, anim.tempMeshMap, endTargets);
      const sceneLabels = createStepLabels(opId, step);
      sceneLabels.forEach((l) => ctx.opGroup.add(l));
      anim.sceneLabels = sceneLabels;
      anim.step = step;
      anim.startTime = performance.now();
      const opDef = getOperationById(opId)!;
      anim.duration = opDef.steps[step].duration;
      anim.targets = targets;
    },
    [getStepEndTargets, createStepLabels],
  );

  const startOperation = useCallback(
    (opId: string) => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      const originals = new Map<string, OrigState>();
      ctx.meshMap.forEach((m, k) => {
        const mat = m.material as THREE.MeshPhongMaterial;
        originals.set(k, {
          pos: m.position.clone(),
          scale: m.scale.x,
          opacity: mat.opacity,
          color: mat.color.clone(),
        });
      });
      animRef.current = {
        opId,
        step: 0,
        startTime: 0,
        duration: 0,
        targets: new Map(),
        originalStates: originals,
        tempMeshes: [],
        tempMeshMap: new Map(),
        sceneLabels: [],
      };
      if (conceptMode) {
        setConceptMode(false);
        setActiveConcepts(new Set());
      }
      selectCellByInfo(null);
      setActiveOp(opId);
      setCurrentStep(0);
      setStepDone(false);
      setupStep(opId, 0);
    },
    [conceptMode, setupStep, selectCellByInfo],
  );

  const resetOperation = useCallback(() => {
    const ctx = sceneRef.current;
    const anim = animRef.current;
    if (!ctx || !anim) return;
    cancelAnimationFrame(animRafRef.current);
    anim.tempMeshes.forEach((m) => {
      ctx.cubeGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    anim.sceneLabels.forEach((l) => {
      ctx.opGroup.remove(l);
      if (l instanceof THREE.Mesh) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      if (l instanceof THREE.Sprite) {
        l.material.map?.dispose();
        l.material.dispose();
      }
      if (l instanceof THREE.LineSegments) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    });
    anim.originalStates.forEach((orig, k) => {
      const mesh = ctx.meshMap.get(k);
      if (!mesh) return;
      mesh.position.copy(orig.pos);
      mesh.scale.setScalar(orig.scale);
      const mat = mesh.material as THREE.MeshPhongMaterial;
      mat.opacity = orig.opacity;
      mat.color.copy(orig.color);
      mat.emissive.setHex(0);
    });
    animRef.current = null;
    setActiveOp(null);
    setCurrentStep(0);
    setStepDone(false);
  }, []);

  const goStep = useCallback(
    (dir: 1 | -1) => {
      const anim = animRef.current;
      if (!anim) return;
      const opDef = getOperationById(anim.opId);
      if (!opDef) return;
      const next = anim.step + dir;
      if (next < 0 || next >= opDef.steps.length) return;
      setCurrentStep(next);
      setStepDone(false);
      setupStep(anim.opId, next);
    },
    [setupStep],
  );

  /* ================================================================ */
  /*  Animation loop                                                   */
  /* ================================================================ */
  useEffect(() => {
    const anim = animRef.current;
    const ctx = sceneRef.current;
    if (!anim || !ctx || !activeOp) return;
    let id = 0;
    let done = false;
    const tick = () => {
      const p = Math.min(
        (performance.now() - anim.startTime) / anim.duration,
        1,
      );
      applyProgress(
        ctx.meshMap,
        anim.tempMeshMap,
        anim.targets,
        easeInOutCubic(p),
      );
      if (p < 1) {
        id = requestAnimationFrame(tick);
      } else if (!done) {
        done = true;
        setStepDone(true);
      }
    };
    id = requestAnimationFrame(tick);
    animRafRef.current = id;
    return () => cancelAnimationFrame(id);
  }, [activeOp, currentStep]);

  useEffect(() => {
    if (!stepDone || !autoPlay || !activeOp) return;
    const opDef = getOperationById(activeOp);
    const anim = animRef.current;
    if (!opDef || !anim || anim.step >= opDef.steps.length - 1) return;
    const timer = setTimeout(() => goStep(1), 800);
    return () => clearTimeout(timer);
  }, [stepDone, autoPlay, activeOp, goStep]);

  /* ================================================================ */
  /*  Per-frame styling                                                */
  /* ================================================================ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || activeOp) return;
    let pid = 0;
    const fl = () => {
      pid = requestAnimationFrame(fl);
      const sel = ctx.selectedMesh?.userData.cellInfo as CellInfo | undefined;
      ctx.cubeGroup.children.forEach((c) => {
        if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
        const info = c.userData.cellInfo as CellInfo;
        const mat = c.material as THREE.MeshPhongMaterial;
        const oc = c.userData.originalColor as THREE.Color;
        const isH = c === ctx.hoveredMesh;
        const isS = c === ctx.selectedMesh;
        if (anyConcept) {
          const hl =
            activeConcepts.has("cells") ||
            activeConcepts.has("facts") ||
            activeConcepts.has("measures");
          if (!hl) {
            mat.emissive.setHex(0);
            return;
          }
        }
        if (sel && !anyConcept) {
          const mm =
            (info.xIndex === sel.xIndex ? 1 : 0) +
            (info.yIndex === sel.yIndex ? 1 : 0) +
            (info.zIndex === sel.zIndex ? 1 : 0);
          if (isS) {
            mat.emissive.setHex(0x222222);
            mat.opacity = 1;
            mat.color.copy(oc);
          } else if (isH) {
            mat.emissive.setHex(0x1a1a1a);
            mat.opacity = 0.95;
            mat.color.copy(oc);
          } else if (mm >= 2) {
            mat.emissive.setHex(0x0a0a0a);
            mat.opacity = 0.8;
            mat.color.copy(oc);
          } else if (mm === 1) {
            mat.emissive.setHex(0);
            mat.opacity = 0.55;
            mat.color.copy(oc);
          } else {
            mat.emissive.setHex(0);
            mat.opacity = 0.18;
            mat.color.copy(oc);
          }
        } else if (isH) {
          mat.emissive.setHex(0x1a1a1a);
          mat.opacity = 1;
          mat.color.copy(oc);
        } else if (!anyConcept) {
          mat.emissive.setHex(0);
          mat.opacity = 0.88;
          mat.color.copy(oc);
        } else {
          mat.emissive.setHex(0);
        }
      });
    };
    fl();
    return () => cancelAnimationFrame(pid);
  }, [activeConcepts, anyConcept, activeOp]);

  /* ================================================================ */
  /*  Interaction handlers                                             */
  /* ================================================================ */
  const findCellMesh = useCallback(
    (hits: THREE.Intersection[]): THREE.Mesh | null => {
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) {
          if (o instanceof THREE.Mesh && o.userData.cellInfo) return o;
          o = o.parent;
        }
      }
      return null;
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.MouseEvent) => {
      if (activeOp) return;
      const ctx = sceneRef.current;
      const el = canvasRef.current;
      if (!ctx || !el) return;
      const r = el.getBoundingClientRect();
      ctx.mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
      const hm = findCellMesh(
        ctx.raycaster.intersectObjects(ctx.cubeGroup.children, true),
      );
      if (hm) {
        ctx.hoveredMesh = hm;
        setHoverCell(hm.userData.cellInfo);
        setTipPos({ x: e.clientX, y: e.clientY });
        el.style.cursor = "pointer";
      } else {
        ctx.hoveredMesh = null;
        setHoverCell(null);
        el.style.cursor = "grab";
      }
    },
    [findCellMesh, activeOp],
  );

  const onPointerDown = useCallback((e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: React.MouseEvent) => {
      if (activeOp) return;
      if (mouseDownPos.current) {
        const d =
          (e.clientX - mouseDownPos.current.x) ** 2 +
          (e.clientY - mouseDownPos.current.y) ** 2;
        if (d > 25) return;
      }
      const ctx = sceneRef.current;
      const el = canvasRef.current;
      if (!ctx || !el) return;
      const r = el.getBoundingClientRect();
      ctx.mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
      const hm = findCellMesh(
        ctx.raycaster.intersectObjects(ctx.cubeGroup.children, true),
      );
      selectCellByInfo(hm ? hm.userData.cellInfo : null);
    },
    [findCellMesh, selectCellByInfo, activeOp],
  );

  const onPointerLeave = useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.hoveredMesh = null;
    setHoverCell(null);
  }, []);

  /* ================================================================ */
  /*  Misc handlers                                                    */
  /* ================================================================ */
  const changeAxis = useCallback(
    (axis: keyof AxisAssignment, dimId: string) => {
      if (activeOp) return;
      setAxes((prev) => {
        if (prev[axis] === dimId) return prev;
        const next = { ...prev };
        const c = (["x", "y", "z"] as const).find(
          (a) => a !== axis && prev[a] === dimId,
        );
        if (c) next[c] = prev[axis];
        next[axis] = dimId;
        return next;
      });
    },
    [activeOp],
  );

  const closeDetail = useCallback(
    () => selectCellByInfo(null),
    [selectCellByInfo],
  );

  const toggleConcept = useCallback((id: ConceptId) => {
    setActiveConcepts((p) => {
      const n = new Set(p);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setActiveConcepts((p) =>
      p.size === CONCEPTS.length
        ? new Set()
        : new Set(CONCEPTS.map((c) => c.id)),
    );
  }, []);
  const clearAll = useCallback(() => {
    setActiveConcepts(new Set());
    setExpandedConcept(null);
  }, []);

  const selKey = selCell ? cellKey(selCell) : null;
  const getRowClass = useCallback(
    (cell: CellInfo): string => {
      const k = cellKey(cell);
      if (selKey === k) return "olap-table-row selected";
      if (!selCell) return "olap-table-row";
      const m =
        (cell.xIndex === selCell.xIndex ? 1 : 0) +
        (cell.yIndex === selCell.yIndex ? 1 : 0) +
        (cell.zIndex === selCell.zIndex ? 1 : 0);
      if (m >= 2) return "olap-table-row related-strong";
      if (m === 1) return "olap-table-row related-weak";
      return "olap-table-row dimmed";
    },
    [selCell, selKey],
  );

  const tableStats = useMemo(() => {
    const v = allCells.map((c) => c.value);
    return {
      total: v.reduce((a, b) => a + b, 0),
      avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
      min: Math.min(...v),
      max: Math.max(...v),
      count: v.length,
    };
  }, [allCells]);

  const activeOpDef = activeOp ? getOperationById(activeOp) : null;

  /* ================================================================ */
  /*  JSX                                                              */
  /* ================================================================ */
  return (
    <div className="olap-root">
      {/* Header */}
      <div className="olap-header">
        <h2 className="olap-title">
          <span className="olap-title-icon">◆</span> OLAP Cube Explorer
        </h2>
        <div className="olap-selectors">
          {(["x", "y", "z"] as const).map((ax) => (
            <div key={ax} className="olap-sel">
              <label style={{ color: AXIS_COLORS[ax].css }}>
                {ax.toUpperCase()} Axis
              </label>
              <select
                value={axes[ax]}
                onChange={(e) => changeAxis(ax, e.target.value)}
                style={{ borderColor: AXIS_COLORS[ax].css }}
                disabled={!!activeOp}
              >
                {DIMENSIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {getDimensionDisplayName(d)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="olap-legend">
          <span>Low</span>
          <div className="olap-legend-bar" />
          <span>High</span>
        </div>
        <button
          className={`olap-learn-btn ${conceptMode ? "active" : ""}`}
          onClick={() => {
            if (activeOp) return;
            setConceptMode((p) => !p);
            if (conceptMode) clearAll();
          }}
          disabled={!!activeOp}
        >
          {conceptMode ? "✕ Close Learn" : "📖 Learn"}
        </button>
      </div>

      {/* Main */}
      <div className="olap-main">
        {/* Concept sidebar */}
        {conceptMode && !activeOp && (
          <div className="olap-concept-sidebar">
            <div className="olap-concept-sidebar-header">
              <h3>OLAP Concepts</h3>
              <div className="olap-concept-sidebar-actions">
                <button onClick={toggleAll} className="olap-concept-toggle-all">
                  {activeConcepts.size === CONCEPTS.length
                    ? "Hide All"
                    : "Show All"}
                </button>
                {activeConcepts.size > 0 && (
                  <button onClick={clearAll} className="olap-concept-clear">
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="olap-concept-list">
              {CONCEPTS.map((concept) => {
                const isA = activeConcepts.has(concept.id);
                const isE = expandedConcept === concept.id;
                return (
                  <div
                    key={concept.id}
                    className={`olap-concept-card ${isA ? "active" : ""}`}
                    style={{ borderLeftColor: isA ? concept.color : "#ddd" }}
                  >
                    <div className="olap-concept-card-header">
                      <button
                        className="olap-concept-toggle-btn"
                        style={{
                          backgroundColor: isA ? concept.color : "#eee",
                          color: isA ? "#fff" : "#888",
                        }}
                        onClick={() => toggleConcept(concept.id)}
                      >
                        {concept.icon}
                      </button>
                      <div
                        className="olap-concept-card-text"
                        onClick={() =>
                          setExpandedConcept(isE ? null : concept.id)
                        }
                      >
                        <span className="olap-concept-card-label">
                          {concept.label}
                        </span>
                        <span className="olap-concept-card-short">
                          {concept.shortDesc}
                        </span>
                      </div>
                      <label className="olap-concept-switch">
                        <input
                          type="checkbox"
                          checked={isA}
                          onChange={() => toggleConcept(concept.id)}
                        />
                        <span
                          className="olap-concept-switch-slider"
                          style={
                            isA ? { backgroundColor: concept.color } : undefined
                          }
                        />
                      </label>
                    </div>
                    {isE && (
                      <div className="olap-concept-card-body">
                        <p>{concept.longDesc}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Scene column */}
        <div className="olap-scene-col">
          <div
            className="olap-viewport"
            ref={canvasRef}
            onMouseMove={onPointerMove}
            onMouseDown={onPointerDown}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerLeave}
          />

          {/* Operations panel */}
          <div className="olap-ops-panel">
            <div className="olap-ops-header">
              <span className="olap-ops-title">⚙ OLAP Operations</span>
              {activeOp && (
                <button className="olap-ops-reset-btn" onClick={resetOperation}>
                  ⟲ Reset
                </button>
              )}
            </div>
            {!activeOp && (
              <div className="olap-ops-grid">
                {OPERATIONS.map((op) => (
                  <button
                    key={op.id}
                    className="olap-ops-card"
                    style={{ borderColor: op.color }}
                    onClick={() => startOperation(op.id)}
                  >
                    <span className="olap-ops-card-icon">{op.icon}</span>
                    <span className="olap-ops-card-name">{op.name}</span>
                    <span className="olap-ops-card-desc">{op.description}</span>
                  </button>
                ))}
              </div>
            )}
            {activeOp && activeOpDef && (
              <div className="olap-ops-active">
                <div className="olap-ops-active-title">
                  <span style={{ color: activeOpDef.color }}>
                    {activeOpDef.icon} {activeOpDef.name}
                  </span>
                </div>
                <div className="olap-ops-steps">
                  {activeOpDef.steps.map((_, i) => (
                    <React.Fragment key={i}>
                      <div
                        className={`olap-ops-step-dot ${i < currentStep ? "done" : i === currentStep ? "current" : ""}`}
                        style={
                          i <= currentStep
                            ? {
                                borderColor: activeOpDef.color,
                                background:
                                  i < currentStep ||
                                  (i === currentStep && stepDone)
                                    ? activeOpDef.color
                                    : "#fff",
                              }
                            : {}
                        }
                      >
                        {i < currentStep || (i === currentStep && stepDone)
                          ? "✓"
                          : i + 1}
                      </div>
                      {i < activeOpDef.steps.length - 1 && (
                        <div
                          className={`olap-ops-step-line ${i < currentStep ? "done" : ""}`}
                          style={
                            i < currentStep
                              ? { background: activeOpDef.color }
                              : {}
                          }
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <div className="olap-ops-step-info">
                  <div
                    className="olap-ops-step-label"
                    style={{ color: activeOpDef.color }}
                  >
                    Step {currentStep + 1}:{" "}
                    {activeOpDef.steps[currentStep].label}
                  </div>
                  <p className="olap-ops-step-desc">
                    {activeOpDef.steps[currentStep].description}
                  </p>
                </div>
                <div className="olap-ops-controls">
                  <button
                    className="olap-ops-ctrl-btn"
                    disabled={currentStep === 0}
                    onClick={() => goStep(-1)}
                  >
                    ◀ Prev
                  </button>
                  <label className="olap-ops-auto-label">
                    <input
                      type="checkbox"
                      checked={autoPlay}
                      onChange={(e) => setAutoPlay(e.target.checked)}
                    />
                    Auto-play
                  </label>
                  <button
                    className="olap-ops-ctrl-btn"
                    disabled={
                      currentStep >= activeOpDef.steps.length - 1 || !stepDone
                    }
                    onClick={() => goStep(1)}
                  >
                    Next ▶
                  </button>
                </div>
                <div className="olap-ops-progress-track">
                  <div
                    className="olap-ops-progress-fill"
                    style={{
                      width: `${((currentStep + (stepDone ? 1 : 0.5)) / activeOpDef.steps.length) * 100}%`,
                      background: activeOpDef.color,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Data table */}
          <div
            className={`olap-table-section ${tableCollapsed ? "collapsed" : ""}`}
          >
            <div className="olap-table-header">
              <div className="olap-table-title">
                <span className="olap-table-title-icon">▤</span>
                <h3>Fact Table</h3>
                <span className="olap-table-count">
                  {tableStats.count} cells · Σ{" "}
                  {tableStats.total.toLocaleString()} · μ{" "}
                  {tableStats.avg.toLocaleString()} · ↓ {tableStats.min} · ↑{" "}
                  {tableStats.max}
                </span>
              </div>
              <button
                className="olap-table-collapse-btn"
                onClick={() => setTableCollapsed((p) => !p)}
              >
                {tableCollapsed ? "▲ Show" : "▼ Hide"}
              </button>
            </div>
            {!tableCollapsed && (
              <div className="olap-table-scroll">
                <table className="olap-table">
                  <thead>
                    <tr>
                      <th className="olap-th-idx">#</th>
                      <th style={{ color: AXIS_COLORS.x.css }}>
                        {dimDisplayNames.x}
                        <span className="olap-th-axis">X</span>
                      </th>
                      <th style={{ color: AXIS_COLORS.y.css }}>
                        {dimDisplayNames.y}
                        <span className="olap-th-axis">Y</span>
                      </th>
                      <th style={{ color: AXIS_COLORS.z.css }}>
                        {dimDisplayNames.z}
                        <span className="olap-th-axis">Z</span>
                      </th>
                      <th className="olap-th-value">Value</th>
                      <th className="olap-th-bar">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCells.map((cell, i) => {
                      const k = cellKey(cell);
                      const isSel = selKey === k;
                      const bw =
                        tableStats.max > tableStats.min
                          ? ((cell.value - tableStats.min) /
                              (tableStats.max - tableStats.min)) *
                            100
                          : 50;
                      const col = valueToColor(
                        cell.value,
                        tableStats.min,
                        tableStats.max,
                      );
                      const bc = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
                      return (
                        <tr
                          key={k}
                          ref={(el) => {
                            if (el) tableRowRefs.current.set(k, el);
                            else tableRowRefs.current.delete(k);
                          }}
                          className={getRowClass(cell)}
                          onClick={() => {
                            if (activeOp) return;
                            selectCellByInfo(isSel ? null : cell);
                          }}
                        >
                          <td className="olap-td-idx">{i + 1}</td>
                          <td>{cell.xMember}</td>
                          <td>{cell.yMember}</td>
                          <td>{cell.zMember}</td>
                          <td className="olap-td-value">
                            {cell.value.toLocaleString()}
                          </td>
                          <td className="olap-td-bar">
                            <div className="olap-bar-track">
                              <div
                                className="olap-bar-fill"
                                style={{ width: `${bw}%`, backgroundColor: bc }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="olap-instructions">
            {activeOp
              ? "Operation in progress · Rotate the cube to observe"
              : "Drag to rotate · Scroll to zoom · Click a cell or row to inspect"}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hoverCell && !activeOp && (
        <div
          className="olap-tip"
          style={{ left: tipPos.x + 16, top: tipPos.y - 10 }}
        >
          <p>
            <b>{hoverCell.xDimension}:</b> {hoverCell.xMember}
          </p>
          <p>
            <b>{hoverCell.yDimension}:</b> {hoverCell.yMember}
          </p>
          <p>
            <b>{hoverCell.zDimension}:</b> {hoverCell.zMember}
          </p>
          <p className="olap-tip-val">
            Value: <strong>{hoverCell.value.toLocaleString()}</strong>
          </p>
        </div>
      )}

      {/* Detail panel */}
      {selCell && !activeOp && (
        <div
          className="olap-detail"
          style={conceptMode ? { right: "340px" } : undefined}
        >
          <div className="olap-detail-top">
            <h3>Cell Details</h3>
            <button onClick={closeDetail}>×</button>
          </div>
          <table>
            <tbody>
              <tr>
                <td style={{ color: AXIS_COLORS.x.css }}>
                  {dimDisplayNames.x}
                </td>
                <td>{selCell.xMember}</td>
              </tr>
              <tr>
                <td style={{ color: AXIS_COLORS.y.css }}>
                  {dimDisplayNames.y}
                </td>
                <td>{selCell.yMember}</td>
              </tr>
              <tr>
                <td style={{ color: AXIS_COLORS.z.css }}>
                  {dimDisplayNames.z}
                </td>
                <td>{selCell.zMember}</td>
              </tr>
            </tbody>
          </table>
          <div className="olap-detail-val">
            <span>Measure Value</span>
            <span className="olap-detail-num">
              {selCell.value.toLocaleString()}
            </span>
          </div>
          <div className="olap-detail-pos">
            Cell [{selCell.xIndex}, {selCell.yIndex}, {selCell.zIndex}]
          </div>
        </div>
      )}
    </div>
  );
};

export default OlapCube;

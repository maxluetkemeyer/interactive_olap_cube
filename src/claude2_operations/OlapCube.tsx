/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-expressions */
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
  getDimensionAtLevel,
  getDimensionDisplayName,
  getDefaultLevelIndex,
} from "./data";
import { CONCEPTS, getConceptById } from "./concepts";
import { OPERATIONS, getOperationById } from "./operations";
import "./OlapCube.css";

/* ================================================================== */
const CELL_SIZE = 0.8;
const CELL_GAP = 0.4;
const CELL_STRIDE = CELL_SIZE + CELL_GAP;
const AX: Record<string, { hex: number; css: string }> = {
  x: { hex: 0xc92a2a, css: "#c92a2a" },
  y: { hex: 0x2b8a3e, css: "#2b8a3e" },
  z: { hex: 0x1864ab, css: "#1864ab" },
};
const GREY_HEX = 0xcccccc;
const GREY_OP = 0.15;

/* ================================================================== */
/*  tiny helpers                                                       */
/* ================================================================== */
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function v2c(v: number, mn: number, mx: number): THREE.Color {
  const t = mx > mn ? (v - mn) / (mx - mn) : 0.5;
  const s: [number, number, number][] = [
    [0.25, 0.55, 0.83],
    [0.18, 0.68, 0.68],
    [0.26, 0.72, 0.45],
    [0.9, 0.72, 0.22],
    [0.85, 0.28, 0.22],
  ];
  const i = t * (s.length - 1),
    lo = Math.max(0, Math.floor(i)),
    hi = Math.min(s.length - 1, lo + 1),
    f = i - lo;
  return new THREE.Color(
    s[lo][0] + (s[hi][0] - s[lo][0]) * f,
    s[lo][1] + (s[hi][1] - s[lo][1]) * f,
    s[lo][2] + (s[hi][2] - s[lo][2]) * f,
  );
}
function txtSp(
  text: string,
  o: { color?: string; size?: number; bold?: boolean; scale?: number } = {},
) {
  const { color = "#333", size = 40, bold = false, scale = 1 } = o;
  const c = document.createElement("canvas"),
    x = c.getContext("2d")!;
  const fn = `${bold ? "bold " : ""}${size}px "Segoe UI",Arial,sans-serif`;
  x.font = fn;
  const w = x.measureText(text).width,
    p = 14;
  c.width = Math.ceil(w) + p * 2;
  c.height = Math.ceil(size * 1.35) + p * 2;
  x.font = fn;
  x.fillStyle = color;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, c.width / 2, c.height / 2);
  const tx = new THREE.CanvasTexture(c);
  tx.minFilter = THREE.LinearFilter;
  const mt = new THREE.SpriteMaterial({
    map: tx,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mt);
  sp.scale.set((c.width / c.height) * scale, scale, 1);
  return sp;
}
function badgeSp(text: string, bg: string, o: { scale?: number } = {}) {
  const { scale = 1 } = o;
  const c = document.createElement("canvas"),
    x = c.getContext("2d")!;
  const fs = 32;
  x.font = `bold ${fs}px "Segoe UI",Arial,sans-serif`;
  const tw = x.measureText(text).width,
    px = 24,
    py = 14;
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
  const tx = new THREE.CanvasTexture(c);
  tx.minFilter = THREE.LinearFilter;
  const mt = new THREE.SpriteMaterial({
    map: tx,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mt);
  sp.scale.set((c.width / c.height) * scale, scale, 1);
  return sp;
}
function valTex(v: number, fc: string) {
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
  const tx = new THREE.CanvasTexture(c);
  tx.minFilter = THREE.LinearFilter;
  return tx;
}
function dashLn(a: THREE.Vector3, b: THREE.Vector3, col: number) {
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
function solidLn(a: THREE.Vector3, b: THREE.Vector3, col: number, op = 0.7) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }),
  );
}
function dispGrp(g: THREE.Group) {
  g.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.LineSegments ||
      o instanceof THREE.Line
    ) {
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) {
        if ("map" in m && (m as any).map) (m as any).map.dispose();
        m.dispose();
      }
    } else if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
  g.clear();
}
function ck(c: CellInfo) {
  return `${c.xIndex}-${c.yIndex}-${c.zIndex}`;
}

/* ================================================================== */
interface CellAT {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startScale: number;
  endScale: number;
  startOp: number;
  endOp: number;
  startCol?: THREE.Color;
  endCol?: THREE.Color;
}
interface OrigS {
  pos: THREE.Vector3;
  scale: number;
  op: number;
  col: THREE.Color;
}
interface AnimS {
  opId: string;
  step: number;
  start: number;
  dur: number;
  tgts: Map<string, CellAT>;
  orig: Map<string, OrigS>;
  tmpM: THREE.Mesh[];
  tmpMap: Map<string, THREE.Mesh>;
  lbls: THREE.Object3D[];
}

function capTgts(
  mm: Map<string, THREE.Mesh>,
  tm: Map<string, THREE.Mesh>,
  es: Map<string, Partial<CellAT>>,
) {
  const r = new Map<string, CellAT>();
  for (const [k, e] of es) {
    const m = k.startsWith("temp-") ? tm.get(k) : mm.get(k);
    if (!m) continue;
    const mt = m.material as THREE.MeshPhongMaterial;
    r.set(k, {
      startPos: m.position.clone(),
      endPos: e.endPos ?? m.position.clone(),
      startScale: m.scale.x,
      endScale: e.endScale ?? m.scale.x,
      startOp: mt.opacity,
      endOp: e.endOp ?? mt.opacity,
      startCol: e.endCol ? mt.color.clone() : undefined,
      endCol: e.endCol,
    });
  }
  return r;
}
function applyProg(
  mm: Map<string, THREE.Mesh>,
  tm: Map<string, THREE.Mesh>,
  tgts: Map<string, CellAT>,
  t: number,
) {
  for (const [k, tg] of tgts) {
    const m = k.startsWith("temp-") ? tm.get(k) : mm.get(k);
    if (!m) continue;
    m.position.lerpVectors(tg.startPos, tg.endPos, t);
    m.scale.setScalar(THREE.MathUtils.lerp(tg.startScale, tg.endScale, t));
    const mt = m.material as THREE.MeshPhongMaterial;
    mt.opacity = THREE.MathUtils.lerp(tg.startOp, tg.endOp, t);
    if (tg.startCol && tg.endCol) mt.color.copy(tg.startCol).lerp(tg.endCol, t);
  }
}

/* ================================================================== */
interface CM {
  xN: number;
  yN: number;
  zN: number;
  xO: number;
  yO: number;
  zO: number;
  xName: string;
  yName: string;
  zName: string;
  xDisp: string;
  yDisp: string;
  zDisp: string;
  xId: string;
  yId: string;
  zId: string;
  xLvl: number;
  yLvl: number;
  zLvl: number;
  mn: number;
  mx: number;
}
interface Ctx {
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  rdr: THREE.WebGLRenderer;
  ctrl: OrbitControls;
  rc: THREE.Raycaster;
  ms: THREE.Vector2;
  cubeG: THREE.Group;
  lblG: THREE.Group;
  axG: THREE.Group;
  conG: THREE.Group;
  opG: THREE.Group;
  hovM: THREE.Mesh | null;
  selM: THREE.Mesh | null;
  aId: number;
  bT: number;
  cm: CM | null;
  mm: Map<string, THREE.Mesh>;
}

/* ================================================================== */
const OlapCube: React.FC = () => {
  const cvRef = useRef<HTMLDivElement>(null);
  const sRef = useRef<Ctx | null>(null);
  const mdRef = useRef<{ x: number; y: number } | null>(null);
  const trRef = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const anRef = useRef<AnimS | null>(null);
  const arRef = useRef(0);

  const [axes, setAxes] = useState<AxisAssignment>({
    x: "product",
    y: "region",
    z: "time",
  });
  const [levelOverrides, setLevelOverrides] = useState<Record<string, number>>(
    {},
  );
  const [selCell, setSelCell] = useState<CellInfo | null>(null);
  const [hoverCell, setHoverCell] = useState<CellInfo | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [conceptMode, setConceptMode] = useState(false);
  const [actCon, setActCon] = useState<Set<ConceptId>>(new Set());
  const [expCon, setExpCon] = useState<ConceptId | null>(null);
  const [tblCol, setTblCol] = useState(false);
  const [actOp, setActOp] = useState<string | null>(null);
  const [curStep, setCurStep] = useState(0);
  const [stepDone, setStepDone] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  const anyCon = actCon.size > 0;

  /* ---- effective level for a dimension ---- */
  const effLvl = useCallback(
    (dimId: string) => {
      if (dimId in levelOverrides) return levelOverrides[dimId];
      const dim = getDimensionById(dimId)!;
      return getDefaultLevelIndex(dim);
    },
    [levelOverrides],
  );

  /* ---- effective dimensions (with members for the active level) ---- */
  const effDims = useMemo(
    () => ({
      x: getDimensionAtLevel(axes.x, effLvl(axes.x)),
      y: getDimensionAtLevel(axes.y, effLvl(axes.y)),
      z: getDimensionAtLevel(axes.z, effLvl(axes.z)),
    }),
    [axes, effLvl],
  );

  const dimDisp = useMemo(
    () => ({
      x: getDimensionDisplayName(getDimensionById(axes.x)!, effLvl(axes.x)),
      y: getDimensionDisplayName(getDimensionById(axes.y)!, effLvl(axes.y)),
      z: getDimensionDisplayName(getDimensionById(axes.z)!, effLvl(axes.z)),
    }),
    [axes, effLvl],
  );

  /* ---- all cells ---- */
  const allCells: CellInfo[] = useMemo(() => {
    const xd = effDims.x,
      yd = effDims.y,
      zd = effDims.z;
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
  }, [effDims]);

  /* ---- select cell ---- */
  const selectCell = useCallback((cell: CellInfo | null) => {
    const s = sRef.current;
    if (!s) return;
    if (s.selM) {
      const o = s.selM.getObjectByName("sel-out");
      if (o) {
        s.selM.remove(o);
        (o as THREE.LineSegments).geometry.dispose();
        ((o as THREE.LineSegments).material as THREE.Material).dispose();
      }
      s.selM = null;
    }
    if (!cell) {
      setSelCell(null);
      return;
    }
    const m = s.mm.get(ck(cell));
    if (m) {
      s.selM = m;
      const oG = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12,
        ),
      );
      const oM = new THREE.LineBasicMaterial({ color: 0x222222 });
      const out = new THREE.LineSegments(oG, oM);
      out.name = "sel-out";
      m.add(out);
    }
    setSelCell(cell);
  }, []);

  useEffect(() => {
    if (!selCell) return;
    const r = trRef.current.get(ck(selCell));
    if (r) r.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selCell]);

  /* ================================================================ */
  /*  Init Three.js                                                    */
  /* ================================================================ */
  useEffect(() => {
    const el = cvRef.current;
    if (!el) return;
    const w = el.clientWidth,
      h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    cam.position.set(10, 8, 10);
    const rdr = new THREE.WebGLRenderer({ antialias: true });
    rdr.setSize(w, h);
    rdr.setPixelRatio(Math.min(devicePixelRatio, 2));
    rdr.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(rdr.domElement);
    const ctrl = new OrbitControls(cam, rdr.domElement);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.08;
    ctrl.rotateSpeed = 0.5;
    ctrl.minDistance = 5;
    ctrl.maxDistance = 30;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.6);
    d1.position.set(8, 12, 8);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xccccff, 0.2);
    d2.position.set(-6, 4, -6);
    scene.add(d2);
    const cubeG = new THREE.Group(),
      lblG = new THREE.Group(),
      axG = new THREE.Group(),
      conG = new THREE.Group(),
      opG = new THREE.Group();
    scene.add(cubeG, lblG, axG, conG, opG);
    const ctx: Ctx = {
      scene,
      cam,
      rdr,
      ctrl,
      rc: new THREE.Raycaster(),
      ms: new THREE.Vector2(-999, -999),
      cubeG,
      lblG,
      axG,
      conG,
      opG,
      hovM: null,
      selM: null,
      aId: 0,
      bT: 0,
      cm: null,
      mm: new Map(),
    };
    sRef.current = ctx;
    const anim = () => {
      ctx.aId = requestAnimationFrame(anim);
      ctrl.update();
      const el2 = performance.now() - ctx.bT;
      let i = 0;
      cubeG.children.forEach((c) => {
        if (c instanceof THREE.Mesh && c.userData.cellInfo) {
          if (!c.userData.entryDone) {
            const t = Math.min(1, Math.max(0, (el2 - i * 25) / 400));
            if (t >= 1) c.userData.entryDone = true;
            else c.scale.setScalar(1 - Math.pow(1 - t, 3));
          }
          i++;
        }
      });
      rdr.render(scene, cam);
    };
    anim();
    const ro = new ResizeObserver(() => {
      const ww = el.clientWidth,
        hh = el.clientHeight;
      if (!ww || !hh) return;
      cam.aspect = ww / hh;
      cam.updateProjectionMatrix();
      rdr.setSize(ww, hh);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(ctx.aId);
      ro.disconnect();
      ctrl.dispose();
      rdr.dispose();
      if (el.contains(rdr.domElement)) el.removeChild(rdr.domElement);
    };
  }, []);

  /* ================================================================ */
  /*  Build cube                                                       */
  /* ================================================================ */
  useEffect(() => {
    const s = sRef.current;
    if (!s) return;
    dispGrp(s.cubeG);
    dispGrp(s.lblG);
    dispGrp(s.axG);
    dispGrp(s.conG);
    dispGrp(s.opG);
    s.mm.clear();
    const xd = effDims.x,
      yd = effDims.y,
      zd = effDims.z;
    const xN = xd.members.length,
      yN = yd.members.length,
      zN = zd.members.length;
    const xO = (-(xN - 1) * CELL_STRIDE) / 2,
      yO = (-(yN - 1) * CELL_STRIDE) / 2,
      zO = (-(zN - 1) * CELL_STRIDE) / 2;
    const vs = allCells.map((c) => c.value),
      mn = Math.min(...vs),
      mx = Math.max(...vs);

    s.cm = {
      xN,
      yN,
      zN,
      xO,
      yO,
      zO,
      xName: xd.name,
      yName: yd.name,
      zName: zd.name,
      xDisp: dimDisp.x,
      yDisp: dimDisp.y,
      zDisp: dimDisp.z,
      xId: xd.id,
      yId: yd.id,
      zId: zd.id,
      xLvl: effLvl(axes.x),
      yLvl: effLvl(axes.y),
      zLvl: effLvl(axes.z),
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
      const col = v2c(cell.value, mn, mx);
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
      const lum = col.r * 0.299 + col.g * 0.587 + col.b * 0.114,
        tc = lum > 0.52 ? "#1a1a1a" : "#fff";
      const aFL = (p: THREE.Vector3, r: THREE.Euler | null) => {
        const tx = valTex(cell.value, tc);
        const pm = new THREE.MeshBasicMaterial({
          map: tx,
          transparent: true,
          side: THREE.DoubleSide,
        });
        const pl = new THREE.Mesh(vpG, pm);
        pl.position.copy(p);
        if (r) pl.rotation.copy(r);
        mesh.add(pl);
      };
      if (cell.xIndex === xN - 1)
        aFL(
          new THREE.Vector3(CELL_SIZE / 2 + 0.005, 0, 0),
          new THREE.Euler(0, Math.PI / 2, 0),
        );
      if (cell.zIndex === zN - 1)
        aFL(new THREE.Vector3(0, 0, CELL_SIZE / 2 + 0.005), null);
      if (cell.yIndex === yN - 1)
        aFL(
          new THREE.Vector3(0, CELL_SIZE / 2 + 0.005, 0),
          new THREE.Euler(-Math.PI / 2, 0, 0),
        );
      if (cell.xIndex === 0)
        aFL(
          new THREE.Vector3(-CELL_SIZE / 2 - 0.005, 0, 0),
          new THREE.Euler(0, -Math.PI / 2, 0),
        );
      if (cell.zIndex === 0)
        aFL(
          new THREE.Vector3(0, 0, -CELL_SIZE / 2 - 0.005),
          new THREE.Euler(0, Math.PI, 0),
        );
      if (cell.yIndex === 0)
        aFL(
          new THREE.Vector3(0, -CELL_SIZE / 2 - 0.005, 0),
          new THREE.Euler(Math.PI / 2, 0, 0),
        );
      s.cubeG.add(mesh);
      s.mm.set(ck(cell), mesh);
    });

    const lM = CELL_STRIDE * 0.88;
    const lblScale = (n: number) => (n > 6 ? 0.35 : n > 4 ? 0.42 : 0.5);
    xd.members.forEach((m, i) => {
      const sp = txtSp(m, { color: AX.x.css, size: 30, scale: lblScale(xN) });
      sp.position.set(i * CELL_STRIDE + xO, yO - lM, zO - lM);
      sp.userData = { conceptTag: "members" };
      s.lblG.add(sp);
    });
    yd.members.forEach((m, i) => {
      const sp = txtSp(m, { color: AX.y.css, size: 30, scale: lblScale(yN) });
      sp.position.set(xO - lM, i * CELL_STRIDE + yO, zO - lM);
      sp.userData = { conceptTag: "members" };
      s.lblG.add(sp);
    });
    zd.members.forEach((m, i) => {
      const sp = txtSp(m, { color: AX.z.css, size: 30, scale: lblScale(zN) });
      sp.position.set(xO - lM, yO - lM, i * CELL_STRIDE + zO);
      sp.userData = { conceptTag: "members" };
      s.lblG.add(sp);
    });

    const nO = CELL_STRIDE * 1.4;
    [
      {
        d: xd,
        a: "x" as const,
        p: new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          yO - nO,
          zO - lM,
        ),
      },
      {
        d: yd,
        a: "y" as const,
        p: new THREE.Vector3(
          xO - nO,
          ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          zO - lM,
        ),
      },
      {
        d: zd,
        a: "z" as const,
        p: new THREE.Vector3(
          xO - lM,
          yO - nO,
          ((zN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
        ),
      },
    ].forEach(({ d, a, p }) => {
      const dn = getDimensionDisplayName(d);
      const sp = txtSp(dn, {
        color: AX[a].css,
        size: 34,
        bold: true,
        scale: 0.65,
      });
      sp.position.copy(p);
      sp.userData = { conceptTag: "dimensions" };
      s.lblG.add(sp);
    });

    const bs = new THREE.Vector3(
      xO - CELL_STRIDE * 0.5,
      yO - CELL_STRIDE * 0.5,
      zO - CELL_STRIDE * 0.5,
    );
    const aAL = (a: THREE.Vector3, b: THREE.Vector3, c: number) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({
          color: c,
          transparent: true,
          opacity: 0.55,
        }),
      );
      l.userData = { conceptTag: "dimensions" };
      s.axG.add(l);
    };
    aAL(
      bs.clone(),
      new THREE.Vector3(-bs.x + CELL_STRIDE * 0.3, bs.y, bs.z),
      AX.x.hex,
    );
    aAL(
      bs.clone(),
      new THREE.Vector3(bs.x, -bs.y + CELL_STRIDE * 0.3, bs.z),
      AX.y.hex,
    );
    aAL(
      bs.clone(),
      new THREE.Vector3(bs.x, bs.y, -bs.z + CELL_STRIDE * 0.3),
      AX.z.hex,
    );

    s.bT = performance.now();
    s.hovM = null;
    s.selM = null;
    setSelCell(null);
    setHoverCell(null);
  }, [effDims, allCells, dimDisp, axes, effLvl]);

  /* ================================================================ */
  /*  Concept overlay                                                  */
  /* ================================================================ */
  useEffect(() => {
    const s = sRef.current;
    if (!s || !s.cm) return;
    dispGrp(s.conG);
    const m = s.cm,
      { xN, yN, zN, xO, yO, zO } = m;

    s.cubeG.children.forEach((c) => {
      if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
      const mt = c.material as THREE.MeshPhongMaterial;
      const oc = c.userData.originalColor as THREE.Color;
      if (!anyCon && !actOp) {
        mt.color.copy(oc);
        mt.opacity = 0.88;
        return;
      }
      if (actOp) return;
      const hl =
        actCon.has("cells") || actCon.has("facts") || actCon.has("measures");
      if (hl) {
        mt.color.copy(oc);
        mt.opacity = 0.88;
      } else {
        mt.color.setHex(GREY_HEX);
        mt.opacity = GREY_OP;
      }
    });
    const uLV = (o: THREE.Object3D) => {
      if (!anyCon && !actOp) {
        if (o instanceof THREE.Sprite) o.material.opacity = 1;
        if (o instanceof THREE.Line)
          (o.material as THREE.LineBasicMaterial).opacity = 0.55;
        return;
      }
      if (actOp) return;
      const tg = o.userData.conceptTag as string | undefined;
      const rl = tg && actCon.has(tg as ConceptId);
      if (o instanceof THREE.Sprite) o.material.opacity = rl ? 1 : 0.15;
      if (o instanceof THREE.Line)
        (o.material as THREE.LineBasicMaterial).opacity = rl ? 0.7 : 0.08;
    };
    s.lblG.children.forEach(uLV);
    s.axG.children.forEach(uLV);
    if (!anyCon) return;

    const cc = new THREE.Vector3(
      xO + ((xN - 1) * CELL_STRIDE) / 2,
      yO + ((yN - 1) * CELL_STRIDE) / 2,
      zO + ((zN - 1) * CELL_STRIDE) / 2,
    );

    if (actCon.has("dimensions")) {
      const cd = getConceptById("dimensions");
      (["x", "y", "z"] as const).forEach((ax) => {
        const dn = ax === "x" ? m.xDisp : ax === "y" ? m.yDisp : m.zDisp;
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
        const b = badgeSp(`DIMENSION: ${dn}`, cd.color, { scale: 0.55 });
        b.position.copy(off);
        s.conG.add(b);
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
        s.conG.add(dashLn(off, ae, new THREE.Color(cd.color).getHex()));
      });
    }
    if (actCon.has("members")) {
      const cd = getConceptById("members");
      const mp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 1.6,
        zO - CELL_STRIDE * 1.6,
      );
      const b = badgeSp("MEMBER (value in a dimension)", cd.color, {
        scale: 0.48,
      });
      b.position.copy(mp);
      s.conG.add(b);
      const tp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 0.88,
        zO - CELL_STRIDE * 0.88,
      );
      s.conG.add(dashLn(mp, tp, new THREE.Color(cd.color).getHex()));
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
      s.conG.add(rr);
    }
    if (actCon.has("cells")) {
      const cd = getConceptById("cells");
      const ci = Math.min(1, xN - 1),
        cj = Math.min(1, yN - 1),
        ckk = Math.min(1, zN - 1);
      const cp = new THREE.Vector3(
        ci * CELL_STRIDE + xO,
        cj * CELL_STRIDE + yO,
        ckk * CELL_STRIDE + zO,
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
      s.conG.add(h);
      const bp = cp
        .clone()
        .add(new THREE.Vector3(CELL_STRIDE * 1.4, CELL_STRIDE * 1.4, 0));
      const bb = badgeSp("CELL (intersection)", cd.color, { scale: 0.48 });
      bb.position.copy(bp);
      s.conG.add(bb);
      s.conG.add(dashLn(bp, cp, new THREE.Color(cd.color).getHex()));
    }
    if (actCon.has("measures")) {
      const cd = getConceptById("measures");
      const fp = new THREE.Vector3(
        Math.min(1, xN - 1) * CELL_STRIDE + xO,
        Math.min(1, yN - 1) * CELL_STRIDE + yO,
        (zN - 1) * CELL_STRIDE + zO + CELL_SIZE / 2 + 0.01,
      );
      const bp = fp.clone().add(new THREE.Vector3(0, 0, CELL_STRIDE * 2));
      const b = badgeSp("MEASURE (numeric value)", cd.color, { scale: 0.48 });
      b.position.copy(bp);
      s.conG.add(b);
      s.conG.add(dashLn(bp, fp, new THREE.Color(cd.color).getHex()));
    }
    if (actCon.has("facts")) {
      const cd = getConceptById("facts");
      const hx = ((xN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8,
        hy = ((yN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8,
        hz = ((zN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
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
      s.conG.add(bb2);
      const bp = cc
        .clone()
        .add(new THREE.Vector3(hx + CELL_STRIDE, hy + CELL_STRIDE, 0));
      const b = badgeSp("FACT TABLE (all data)", cd.color, { scale: 0.52 });
      b.position.copy(bp);
      s.conG.add(b);
      s.conG.add(
        dashLn(
          bp,
          cc.clone().add(new THREE.Vector3(hx * 0.5, hy * 0.5, 0)),
          new THREE.Color(cd.color).getHex(),
        ),
      );
    }
    if (actCon.has("granularity")) {
      const cd = getConceptById("granularity");
      const y2 = yO - CELL_STRIDE * 0.5,
        z2 = zO - CELL_STRIDE * 0.5;
      for (let i = 0; i < xN; i++) {
        const dG = new THREE.SphereGeometry(0.06, 12, 12);
        const dM = new THREE.MeshBasicMaterial({ color: cd.color });
        const d = new THREE.Mesh(dG, dM);
        d.position.set(i * CELL_STRIDE + xO, y2, z2);
        s.conG.add(d);
      }
      if (xN >= 2) {
        const bY = y2 - 0.4;
        s.conG.add(
          solidLn(
            new THREE.Vector3(xO, bY, z2),
            new THREE.Vector3((xN - 1) * CELL_STRIDE + xO, bY, z2),
            new THREE.Color(cd.color).getHex(),
          ),
        );
        for (let i = 0; i < xN; i++)
          s.conG.add(
            solidLn(
              new THREE.Vector3(i * CELL_STRIDE + xO, y2, z2),
              new THREE.Vector3(i * CELL_STRIDE + xO, bY, z2),
              new THREE.Color(cd.color).getHex(),
              0.4,
            ),
          );
      }
      const gb = badgeSp(`GRANULARITY: ${xN} members (${m.xDisp})`, cd.color, {
        scale: 0.45,
      });
      gb.position.set(((xN - 1) * CELL_STRIDE) / 2 + xO, y2 - 1.0, z2);
      s.conG.add(gb);
    }
    if (actCon.has("attributes")) {
      const cd = getConceptById("attributes");
      const tp = new THREE.Vector3(
        xO,
        yO - CELL_STRIDE * 0.88,
        zO - CELL_STRIDE * 0.88,
      );
      //const xDim = getDimensionById(m.xId)!;
      const attrs = [
        { k: "Name", v: effDims.x.members[0] },
        { k: "Code", v: "SKU-001" },
        { k: "Color", v: "Silver" },
        { k: "Weight", v: "0.4 kg" },
      ];
      const sy = tp.y,
        ax2 = tp.x - CELL_STRIDE * 2.5,
        az = tp.z - CELL_STRIDE * 0.5;
      attrs.forEach((a, i) => {
        const l = badgeSp(`${a.k}: ${a.v}`, i === 0 ? cd.color : "#6366f1", {
          scale: 0.35,
        });
        l.position.set(ax2, sy - i * 0.45, az);
        s.conG.add(l);
      });
      const mb = badgeSp("ATTRIBUTES (member properties)", cd.color, {
        scale: 0.45,
      });
      mb.position.set(ax2, sy + 0.6, az);
      s.conG.add(mb);
      s.conG.add(
        dashLn(
          new THREE.Vector3(ax2 + 0.8, sy - 0.2, az),
          tp,
          new THREE.Color(cd.color).getHex(),
        ),
      );
    }

    /* ---- HIERARCHIES ---- */
    if (actCon.has("hierarchies")) {
      const cd = getConceptById("hierarchies");
      const xDim = getDimensionById(m.xId)!;
      const hier = xDim.hierarchy;
      if (hier && hier.length > 0) {
        const bx = ((xN - 1) * CELL_STRIDE) / 2 + xO + CELL_STRIDE * 2.5;
        const by = yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE;
        const bz = zO + ((zN - 1) * CELL_STRIDE) / 2;
        const ls = 1.6;
        const hc = new THREE.Color(cd.color).getHex();
        const curLvlIdx = m.xLvl;

        const tb = badgeSp(`HIERARCHY: ${xDim.name}`, cd.color, {
          scale: 0.52,
        });
        tb.position.set(bx, by + 1.0, bz);
        s.conG.add(tb);

        interface NI {
          pos: THREE.Vector3;
        }
        const ln: NI[][] = [];
        let mxW = 0;

        hier.forEach((lv, li) => {
          const yp = by - li * ls;
          const dm =
            lv.members.length > 4
              ? [...lv.members.slice(0, 3), "…"]
              : [...lv.members];
          const ms2 = 1.2;
          const tw = Math.max(0, (dm.length - 1) * ms2);
          if (tw > mxW) mxW = tw;
          const ns: NI[] = [];
          const isCur = li === curLvlIdx;

          const ll = badgeSp(
            isCur ? `▸ ${lv.levelName} (current)` : lv.levelName,
            isCur ? cd.color : "#777",
            { scale: 0.35 },
          );
          ll.position.set(bx - tw / 2 - 1.8, yp, bz);
          s.conG.add(ll);

          dm.forEach((mem, mi) => {
            const xp = bx - tw / 2 + mi * ms2;
            const pos = new THREE.Vector3(xp, yp, bz);
            const nr = isCur ? 0.22 : 0.16;
            const ng = new THREE.CircleGeometry(nr, 24);
            const nm = new THREE.MeshBasicMaterial({
              color: isCur ? cd.color : "#999",
              side: THREE.DoubleSide,
              depthTest: false,
              transparent: true,
              opacity: isCur ? 0.95 : 0.65,
            });
            const nd = new THREE.Mesh(ng, nm);
            nd.position.copy(pos);
            s.conG.add(nd);
            const lb = txtSp(mem, {
              color: isCur ? "#111" : "#666",
              size: isCur ? 28 : 24,
              bold: isCur,
              scale: 0.35,
            });
            lb.position.set(xp, yp - 0.4, bz);
            s.conG.add(lb);
            ns.push({ pos });
          });
          ln.push(ns);
        });

        for (let li = 0; li < ln.length - 1; li++) {
          const ps = ln[li],
            cs = ln[li + 1];
          if (!ps.length || !cs.length) continue;
          const cpp = Math.max(1, Math.ceil(cs.length / ps.length));
          cs.forEach((ch, ci) => {
            const pi = Math.min(Math.floor(ci / cpp), ps.length - 1);
            s.conG.add(
              solidLn(
                ps[pi].pos.clone().add(new THREE.Vector3(0, -0.25, 0)),
                ch.pos.clone().add(new THREE.Vector3(0, 0.25, 0)),
                hc,
                0.35,
              ),
            );
          });
        }

        const at = new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + xO + CELL_STRIDE * 0.6,
          yO - CELL_STRIDE * 0.5,
          zO - CELL_STRIDE * 0.5,
        );
        const tBot = new THREE.Vector3(
          bx,
          by - (hier.length - 1) * ls - 0.8,
          bz,
        );
        s.conG.add(dashLn(tBot, at, hc));

        const anX = bx + mxW * 0.5 + 2.2;
        const anYT = by - 0.2,
          anYB = by - (hier.length - 1) * ls + 0.2;
        const al = badgeSp("▼ Drill Down  ▲ Roll Up", cd.color, {
          scale: 0.36,
        });
        al.position.set(anX, (anYT + anYB) / 2, bz);
        s.conG.add(al);
        s.conG.add(
          solidLn(
            new THREE.Vector3(anX, anYT, bz),
            new THREE.Vector3(anX, anYB, bz),
            hc,
            0.45,
          ),
        );
      }
    }
  }, [actCon, anyCon, axes, allCells, actOp, effDims, dimDisp, effLvl]);

  /* ================================================================ */
  /*  Operation step targets                                           */
  /* ================================================================ */
  const getTargets = useCallback((opId: string, step: number) => {
    const s = sRef.current,
      an = anRef.current;
    if (!s || !s.cm || !an) return new Map<string, Partial<CellAT>>();
    const { xN, yN, zN, xO, yO, zO } = s.cm;
    const ends = new Map<string, Partial<CellAT>>();
    const sZ = Math.min(1, zN - 1),
      dXM = Math.min(1, xN - 1),
      dYM = Math.min(1, yN - 1);

    switch (opId) {
      case "slice": {
        if (step === 0) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: i.zIndex === sZ ? 1 : 0.12,
              endCol: i.zIndex === sZ ? oc.clone() : new THREE.Color(0xdddddd),
              endScale: i.zIndex === sZ ? 1.05 : 0.9,
            });
          });
        } else if (step === 1) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: i.zIndex === sZ ? 1 : 0,
              endScale: i.zIndex === sZ ? 1 : 0.01,
              endCol: i.zIndex === sZ ? oc.clone() : new THREE.Color(0xdddddd),
            });
          });
        } else {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            if (i.zIndex === sZ)
              ends.set(k, {
                endPos: new THREE.Vector3(
                  i.xIndex * CELL_STRIDE + xO,
                  i.yIndex * CELL_STRIDE + yO,
                  0,
                ),
                endOp: 1,
                endScale: 1.1,
                endCol: oc.clone(),
              });
            else ends.set(k, { endOp: 0, endScale: 0.01 });
          });
        }
        break;
      }
      case "dice": {
        const inD = (i: CellInfo) => i.xIndex <= dXM && i.yIndex <= dYM;
        if (step === 0) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: inD(i) ? 1 : 0.1,
              endCol: inD(i) ? oc.clone() : new THREE.Color(0xdddddd),
              endScale: inD(i) ? 1.05 : 0.85,
            });
          });
        } else if (step === 1) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: inD(i) ? 1 : 0,
              endScale: inD(i) ? 1 : 0.01,
              endCol: inD(i) ? oc.clone() : new THREE.Color(0xdddddd),
            });
          });
        } else {
          const cxO = (-dXM * CELL_STRIDE) / 2,
            cyO = (-dYM * CELL_STRIDE) / 2;
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            if (inD(i))
              ends.set(k, {
                endPos: new THREE.Vector3(
                  i.xIndex * CELL_STRIDE + cxO,
                  i.yIndex * CELL_STRIDE + cyO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 1,
                endScale: 1.08,
                endCol: oc.clone(),
              });
            else ends.set(k, { endOp: 0, endScale: 0.01 });
          });
        }
        break;
      }
      case "pivot": {
        if (step === 0) {
          s.mm.forEach((m, k) => {
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: 0.95,
              endCol: oc.clone().offsetHSL(0, -0.1, 0.05),
            });
          });
        } else {
          const nxO = (-(yN - 1) * CELL_STRIDE) / 2,
            nyO = (-(xN - 1) * CELL_STRIDE) / 2;
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endPos: new THREE.Vector3(
                i.yIndex * CELL_STRIDE + nxO,
                i.xIndex * CELL_STRIDE + nyO,
                i.zIndex * CELL_STRIDE + zO,
              ),
              endOp: 0.88,
              endScale: 1,
              endCol: oc.clone(),
            });
          });
        }
        break;
      }
      case "drilldown": {
        if (step === 0) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            ends.set(k, {
              endOp: i.xIndex === 0 ? 1 : 0.5,
              endCol: i.xIndex === 0 ? oc.clone() : new THREE.Color(0xcccccc),
              endScale: i.xIndex === 0 ? 1.08 : 0.92,
            });
          });
        } else if (step === 1) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            if (i.xIndex === 0)
              ends.set(k, {
                endPos: new THREE.Vector3(
                  xO - CELL_STRIDE * 0.1,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 1,
                endScale: 1,
                endCol: oc.clone(),
              });
            else
              ends.set(k, {
                endPos: new THREE.Vector3(
                  (i.xIndex + 1) * CELL_STRIDE + xO,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 0.65,
                endScale: 1,
                endCol: oc.clone().lerp(new THREE.Color(0xcccccc), 0.3),
              });
          });
          an.tmpMap.forEach((tm, k) => {
            ends.set(k, {
              endPos: new THREE.Vector3(
                xO + CELL_STRIDE * 0.9,
                tm.position.y,
                tm.position.z,
              ),
              endOp: 1,
              endScale: 1,
            });
          });
        } else {
          const nxO2 = (-xN * CELL_STRIDE) / 2;
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            const nx = i.xIndex === 0 ? 0 : i.xIndex + 1;
            ends.set(k, {
              endPos: new THREE.Vector3(
                nx * CELL_STRIDE + nxO2,
                i.yIndex * CELL_STRIDE + yO,
                i.zIndex * CELL_STRIDE + zO,
              ),
              endOp: 0.88,
              endScale: 1,
              endCol: oc.clone(),
            });
          });
          an.tmpMap.forEach((tm, k) => {
            const nxO2 = (-xN * CELL_STRIDE) / 2;
            ends.set(k, {
              endPos: new THREE.Vector3(
                1 * CELL_STRIDE + nxO2,
                tm.position.y,
                tm.position.z,
              ),
              endOp: 0.88,
              endScale: 1,
            });
          });
        }
        break;
      }
      case "rollup": {
        if (step === 0) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            const hl = i.xIndex <= 1;
            ends.set(k, {
              endOp: hl ? 1 : 0.45,
              endCol: hl ? oc.clone() : new THREE.Color(0xcccccc),
              endScale: hl ? 1.06 : 0.92,
            });
          });
        } else if (step === 1) {
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            if (i.xIndex === 1)
              ends.set(k, {
                endPos: new THREE.Vector3(
                  0 * CELL_STRIDE + xO,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 0,
                endScale: 0.5,
                endCol: oc.clone(),
              });
            else if (i.xIndex === 0)
              ends.set(k, {
                endOp: 1,
                endScale: 1.2,
                endCol: oc.clone().offsetHSL(0, 0.1, 0.05),
              });
            else
              ends.set(k, {
                endPos: new THREE.Vector3(
                  (i.xIndex - 1) * CELL_STRIDE + xO,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 0.7,
                endScale: 1,
                endCol: oc.clone(),
              });
          });
        } else {
          const nxN = xN - 1,
            nxO2 = (-(nxN - 1) * CELL_STRIDE) / 2;
          s.mm.forEach((m, k) => {
            const i = m.userData.cellInfo as CellInfo;
            const oc = m.userData.originalColor as THREE.Color;
            if (i.xIndex === 1) ends.set(k, { endOp: 0, endScale: 0.01 });
            else if (i.xIndex === 0)
              ends.set(k, {
                endPos: new THREE.Vector3(
                  0 + nxO2,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 1,
                endScale: 1.15,
                endCol: oc.clone().offsetHSL(0.02, 0.1, 0.05),
              });
            else
              ends.set(k, {
                endPos: new THREE.Vector3(
                  (i.xIndex - 1) * CELL_STRIDE + nxO2,
                  i.yIndex * CELL_STRIDE + yO,
                  i.zIndex * CELL_STRIDE + zO,
                ),
                endOp: 0.88,
                endScale: 1,
                endCol: oc.clone(),
              });
          });
        }
        break;
      }
    }
    return ends;
  }, []);

  /* ---- operation labels ---- */
  const mkLabels = useCallback(
    (opId: string, step: number) => {
      const s = sRef.current;
      if (!s || !s.cm) return [] as THREE.Object3D[];
      const cm = s.cm,
        { xN, yN, zN, xO, yO, zO } = cm;
      const ls: THREE.Object3D[] = [];
      const op = getOperationById(opId);
      if (!op) return ls;
      const col = op.color;
      const xDim = getDimensionById(cm.xId)!,
        hier = xDim.hierarchy;
      const curLvlName =
        hier && cm.xLvl >= 0 && cm.xLvl < hier.length
          ? hier[cm.xLvl].levelName
          : "Current";
      const nextLvlName =
        hier && cm.xLvl + 1 < hier.length
          ? hier[cm.xLvl + 1].levelName
          : "Detail";

      switch (opId) {
        case "slice": {
          const sZ = Math.min(1, zN - 1);
          //const zd = getDimensionById(cm.zId)!;
          const zmem = effDims.z.members[sZ] ?? "?";
          if (step === 0) {
            const b = badgeSp(`✂️ Slice: ${cm.zDisp} = "${zmem}"`, col, {
              scale: 0.55,
            });
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
              sZ * CELL_STRIDE + zO,
            );
            ls.push(b);
            const plW = (xN - 1) * CELL_STRIDE + CELL_SIZE * 1.5,
              plH = (yN - 1) * CELL_STRIDE + CELL_SIZE * 1.5;
            const plG = new THREE.PlaneGeometry(plW, plH);
            const plM = new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.08,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const pl = new THREE.Mesh(plG, plM);
            pl.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2,
              sZ * CELL_STRIDE + zO,
            );
            ls.push(pl);
            const plBG = new THREE.EdgesGeometry(plG);
            const plBM = new THREE.LineBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.5,
            });
            const plB = new THREE.LineSegments(plBG, plBM);
            plB.position.copy(pl.position);
            ls.push(plB);
          } else if (step === 1) {
            const b = badgeSp("Removing cells outside the plane…", col, {
              scale: 0.5,
            });
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO - CELL_STRIDE * 2,
              zO - CELL_STRIDE,
            );
            ls.push(b);
          } else {
            const b = badgeSp(
              `Result: 2D table (${cm.xDisp} × ${cm.yDisp})`,
              col,
              { scale: 0.55 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
              0,
            );
            ls.push(b);
          }
          break;
        }
        case "dice": {
          const dx = Math.min(1, xN - 1),
            dy = Math.min(1, yN - 1);
          if (step === 0) {
            const b = badgeSp(
              `🎲 Dice: ${cm.xName} ∈ {${effDims.x.members.slice(0, dx + 1).join(", ")}}, ${cm.yName} ∈ {${effDims.y.members.slice(0, dy + 1).join(", ")}}`,
              col,
              { scale: 0.48 },
            );
            b.position.set(
              xO + (dx * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
            const bw = (dx + 1) * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4,
              bh = (dy + 1) * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4,
              bd = zN * CELL_STRIDE - CELL_GAP + CELL_SIZE * 0.4;
            const bbG = new THREE.EdgesGeometry(
              new THREE.BoxGeometry(bw, bh, bd),
            );
            const bbM = new THREE.LineDashedMaterial({
              color: col,
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
            ls.push(bb);
          } else if (step === 1) {
            const b = badgeSp("Extracting sub-cube…", col, { scale: 0.48 });
            b.position.set(xO - CELL_STRIDE * 2, yO, zO);
            ls.push(b);
          } else {
            const b = badgeSp(
              `Sub-cube: ${Math.min(2, xN)}×${Math.min(2, yN)}×${zN} = ${Math.min(2, xN) * Math.min(2, yN) * zN} cells`,
              col,
              { scale: 0.5 },
            );
            b.position.set(
              0,
              yO + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
          }
          break;
        }
        case "pivot": {
          if (step === 0) {
            const b = badgeSp(
              `🔄 Pivot: Swap ${cm.xDisp} (X) ↔ ${cm.yDisp} (Y)`,
              col,
              { scale: 0.52 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            ls.push(b);
          } else if (step === 1) {
            const b = badgeSp("Rotating cells…", col, { scale: 0.48 });
            b.position.set(
              0,
              yO + ((Math.max(xN, yN) - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            ls.push(b);
          } else {
            const b = badgeSp(`Done: X = ${cm.yDisp}, Y = ${cm.xDisp}`, col, {
              scale: 0.52,
            });
            b.position.set(
              0,
              yO + ((Math.max(xN, yN) - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              0,
            );
            ls.push(b);
          }
          break;
        }
        case "drilldown": {
          const parent = effDims.x.members[0];
          const children =
            hier && hier.length >= 3
              ? hier[Math.min(cm.xLvl + 1, hier.length - 1)].members.slice(0, 2)
              : ["Child A", "Child B"];
          if (step === 0) {
            const b = badgeSp(`🔍 Current level: ${curLvlName}`, col, {
              scale: 0.5,
            });
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
          } else if (step === 1) {
            const b = badgeSp(
              `Expanding "${parent}" → ${children.join(", ")}`,
              col,
              { scale: 0.48 },
            );
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
            const a1 = badgeSp(children[0], "#2d9", { scale: 0.38 });
            a1.position.set(
              xO - CELL_STRIDE * 0.1,
              yO - CELL_STRIDE * 1.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(a1);
            if (children[1]) {
              const a2 = badgeSp(children[1], "#29d", { scale: 0.38 });
              a2.position.set(
                xO + CELL_STRIDE * 0.9,
                yO - CELL_STRIDE * 1.5,
                zO + ((zN - 1) * CELL_STRIDE) / 2,
              );
              ls.push(a2);
            }
          } else {
            const b = badgeSp(
              `Detail: ${nextLvlName} level (${xN + 1} positions)`,
              col,
              { scale: 0.5 },
            );
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
          }
          break;
        }
        case "rollup": {
          if (step === 0) {
            const b = badgeSp(
              `📊 Current: ${curLvlName} (${xN} members)`,
              col,
              { scale: 0.5 },
            );
            b.position.set(
              xO + ((xN - 1) * CELL_STRIDE) / 2,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
          } else if (step === 1) {
            const b = badgeSp(
              `Merging "${effDims.x.members[0]}" + "${effDims.x.members[Math.min(1, xN - 1)]}" → aggregated`,
              col,
              { scale: 0.48 },
            );
            b.position.set(
              xO,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2.5,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
            const sb = badgeSp("Σ Sum", "#d97706", { scale: 0.4 });
            sb.position.set(
              xO + CELL_STRIDE * 0.1,
              yO - CELL_STRIDE * 1.2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(sb);
          } else {
            const b = badgeSp(`Summary: ${xN - 1} members (aggregated)`, col, {
              scale: 0.5,
            });
            b.position.set(
              0,
              yO + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 2,
              zO + ((zN - 1) * CELL_STRIDE) / 2,
            );
            ls.push(b);
          }
          break;
        }
      }
      return ls;
    },
    [effDims],
  );

  /* ---- operation lifecycle ---- */
  const setupStep = useCallback(
    (opId: string, step: number) => {
      const s = sRef.current,
        an = anRef.current;
      if (!s || !an) return;
      an.lbls.forEach((l) => {
        s.opG.remove(l);
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
      an.lbls = [];
      if (opId === "drilldown" && step === 1 && an.tmpM.length === 0) {
        let ti = 0;
        s.mm.forEach((m2) => {
          const i = m2.userData.cellInfo as CellInfo;
          if (i.xIndex !== 0) return;
          const oc = m2.userData.originalColor as THREE.Color;
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
          tm.position.copy(m2.position);
          tm.scale.setScalar(0.01);
          tm.add(
            new THREE.LineSegments(
              new THREE.EdgesGeometry(tm.geometry),
              new THREE.LineBasicMaterial({
                color: 0x999999,
                transparent: true,
                opacity: 0.35,
              }),
            ),
          );
          s.cubeG.add(tm);
          an.tmpM.push(tm);
          an.tmpMap.set(`temp-${ti++}`, tm);
        });
      }
      const ends = getTargets(opId, step);
      const tgts = capTgts(s.mm, an.tmpMap, ends);
      const lbls = mkLabels(opId, step);
      lbls.forEach((l) => s.opG.add(l));
      an.lbls = lbls;
      an.step = step;
      an.start = performance.now();
      const opDef = getOperationById(opId)!;
      an.dur = opDef.steps[step].duration;
      an.tgts = tgts;
    },
    [getTargets, mkLabels],
  );

  const startOp = useCallback(
    (opId: string) => {
      const s = sRef.current;
      if (!s) return;
      const orig = new Map<string, OrigS>();
      s.mm.forEach((m, k) => {
        const mt = m.material as THREE.MeshPhongMaterial;
        orig.set(k, {
          pos: m.position.clone(),
          scale: m.scale.x,
          op: mt.opacity,
          col: mt.color.clone(),
        });
      });
      anRef.current = {
        opId,
        step: 0,
        start: 0,
        dur: 0,
        tgts: new Map(),
        orig,
        tmpM: [],
        tmpMap: new Map(),
        lbls: [],
      };
      if (conceptMode) {
        setConceptMode(false);
        setActCon(new Set());
      }
      selectCell(null);
      setActOp(opId);
      setCurStep(0);
      setStepDone(false);
      setupStep(opId, 0);
    },
    [conceptMode, setupStep, selectCell],
  );

  const resetOp = useCallback(() => {
    const s = sRef.current,
      an = anRef.current;
    if (!s || !an) return;
    cancelAnimationFrame(arRef.current);
    an.tmpM.forEach((m) => {
      s.cubeG.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    an.lbls.forEach((l) => {
      s.opG.remove(l);
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
    an.orig.forEach((o, k) => {
      const m = s.mm.get(k);
      if (!m) return;
      m.position.copy(o.pos);
      m.scale.setScalar(o.scale);
      const mt = m.material as THREE.MeshPhongMaterial;
      mt.opacity = o.op;
      mt.color.copy(o.col);
      mt.emissive.setHex(0);
    });
    anRef.current = null;
    setActOp(null);
    setCurStep(0);
    setStepDone(false);
  }, []);

  const goStep = useCallback(
    (d: 1 | -1) => {
      const an = anRef.current;
      if (!an) return;
      const op = getOperationById(an.opId);
      if (!op) return;
      const n = an.step + d;
      if (n < 0 || n >= op.steps.length) return;
      setCurStep(n);
      setStepDone(false);
      setupStep(an.opId, n);
    },
    [setupStep],
  );

  /* ---- animation loop ---- */
  useEffect(() => {
    const an = anRef.current,
      s = sRef.current;
    if (!an || !s || !actOp) return;
    let id = 0;
    let done = false;
    const tick = () => {
      const p = Math.min((performance.now() - an.start) / an.dur, 1);
      applyProg(s.mm, an.tmpMap, an.tgts, ease(p));
      if (p < 1) id = requestAnimationFrame(tick);
      else if (!done) {
        done = true;
        setStepDone(true);
      }
    };
    id = requestAnimationFrame(tick);
    arRef.current = id;
    return () => cancelAnimationFrame(id);
  }, [actOp, curStep]);

  useEffect(() => {
    if (!stepDone || !autoPlay || !actOp) return;
    const op = getOperationById(actOp),
      an = anRef.current;
    if (!op || !an || an.step >= op.steps.length - 1) return;
    const t = setTimeout(() => goStep(1), 800);
    return () => clearTimeout(t);
  }, [stepDone, autoPlay, actOp, goStep]);

  /* ---- per-frame styling ---- */
  useEffect(() => {
    const s = sRef.current;
    if (!s || actOp) return;
    let pid = 0;
    const fl = () => {
      pid = requestAnimationFrame(fl);
      const sel = s.selM?.userData.cellInfo as CellInfo | undefined;
      s.cubeG.children.forEach((c) => {
        if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
        const i = c.userData.cellInfo as CellInfo;
        const mt = c.material as THREE.MeshPhongMaterial;
        const oc = c.userData.originalColor as THREE.Color;
        const isH = c === s.hovM,
          isS = c === s.selM;
        if (anyCon) {
          const hl =
            actCon.has("cells") ||
            actCon.has("facts") ||
            actCon.has("measures");
          if (!hl) {
            mt.emissive.setHex(0);
            return;
          }
        }
        if (sel && !anyCon) {
          const mm =
            (i.xIndex === sel.xIndex ? 1 : 0) +
            (i.yIndex === sel.yIndex ? 1 : 0) +
            (i.zIndex === sel.zIndex ? 1 : 0);
          if (isS) {
            mt.emissive.setHex(0x222222);
            mt.opacity = 1;
            mt.color.copy(oc);
          } else if (isH) {
            mt.emissive.setHex(0x1a1a1a);
            mt.opacity = 0.95;
            mt.color.copy(oc);
          } else if (mm >= 2) {
            mt.emissive.setHex(0x0a0a0a);
            mt.opacity = 0.8;
            mt.color.copy(oc);
          } else if (mm === 1) {
            mt.emissive.setHex(0);
            mt.opacity = 0.55;
            mt.color.copy(oc);
          } else {
            mt.emissive.setHex(0);
            mt.opacity = 0.18;
            mt.color.copy(oc);
          }
        } else if (isH) {
          mt.emissive.setHex(0x1a1a1a);
          mt.opacity = 1;
          mt.color.copy(oc);
        } else if (!anyCon) {
          mt.emissive.setHex(0);
          mt.opacity = 0.88;
          mt.color.copy(oc);
        } else {
          mt.emissive.setHex(0);
        }
      });
    };
    fl();
    return () => cancelAnimationFrame(pid);
  }, [actCon, anyCon, actOp]);

  /* ---- interaction ---- */
  const fCM = useCallback((h: THREE.Intersection[]) => {
    for (const hh of h) {
      let o: THREE.Object3D | null = hh.object;
      while (o) {
        if (o instanceof THREE.Mesh && o.userData.cellInfo) return o;
        o = o.parent;
      }
    }
    return null;
  }, []);
  const onPM = useCallback(
    (e: React.MouseEvent) => {
      if (actOp) return;
      const s = sRef.current,
        el = cvRef.current;
      if (!s || !el) return;
      const r = el.getBoundingClientRect();
      s.ms.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      s.rc.setFromCamera(s.ms, s.cam);
      const hm = fCM(s.rc.intersectObjects(s.cubeG.children, true));
      if (hm) {
        s.hovM = hm;
        setHoverCell(hm.userData.cellInfo);
        setTipPos({ x: e.clientX, y: e.clientY });
        el.style.cursor = "pointer";
      } else {
        s.hovM = null;
        setHoverCell(null);
        el.style.cursor = "grab";
      }
    },
    [fCM, actOp],
  );
  const onPD = useCallback((e: React.MouseEvent) => {
    mdRef.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPU = useCallback(
    (e: React.MouseEvent) => {
      if (actOp) return;
      if (mdRef.current) {
        const d =
          (e.clientX - mdRef.current.x) ** 2 +
          (e.clientY - mdRef.current.y) ** 2;
        if (d > 25) return;
      }
      const s = sRef.current,
        el = cvRef.current;
      if (!s || !el) return;
      const r = el.getBoundingClientRect();
      s.ms.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      s.rc.setFromCamera(s.ms, s.cam);
      const hm = fCM(s.rc.intersectObjects(s.cubeG.children, true));
      selectCell(hm ? hm.userData.cellInfo : null);
    },
    [fCM, selectCell, actOp],
  );
  const onPL = useCallback(() => {
    const s = sRef.current;
    if (s) s.hovM = null;
    setHoverCell(null);
  }, []);

  const chAx = useCallback(
    (a: keyof AxisAssignment, v: string) => {
      if (actOp) return;
      setAxes((p) => {
        if (p[a] === v) return p;
        const n = { ...p };
        const c = (["x", "y", "z"] as const).find((x) => x !== a && p[x] === v);
        if (c) n[c] = p[a];
        n[a] = v;
        return n;
      });
    },
    [actOp],
  );
  const chLvl = useCallback(
    (dimId: string, lvl: number) => {
      if (actOp) return;
      setLevelOverrides((p) => ({ ...p, [dimId]: lvl }));
    },
    [actOp],
  );
  const closeDet = useCallback(() => selectCell(null), [selectCell]);
  const togCon = useCallback((id: ConceptId) => {
    setActCon((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const togAll = useCallback(() => {
    setActCon((p) =>
      p.size === CONCEPTS.length
        ? new Set()
        : new Set(CONCEPTS.map((c) => c.id)),
    );
  }, []);
  const clrAll = useCallback(() => {
    setActCon(new Set());
    setExpCon(null);
  }, []);

  const selKey = selCell ? ck(selCell) : null;
  const getRC = useCallback(
    (cell: CellInfo) => {
      const k = ck(cell);
      if (selKey === k) return "olap-table-row selected";
      if (!selCell) return "olap-table-row";
      const mm =
        (cell.xIndex === selCell.xIndex ? 1 : 0) +
        (cell.yIndex === selCell.yIndex ? 1 : 0) +
        (cell.zIndex === selCell.zIndex ? 1 : 0);
      if (mm >= 2) return "olap-table-row related-strong";
      if (mm === 1) return "olap-table-row related-weak";
      return "olap-table-row dimmed";
    },
    [selCell, selKey],
  );
  const tS = useMemo(() => {
    const v = allCells.map((c) => c.value);
    return {
      total: v.reduce((a, b) => a + b, 0),
      avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
      min: Math.min(...v),
      max: Math.max(...v),
      count: v.length,
    };
  }, [allCells]);
  const aOD = actOp ? getOperationById(actOp) : null;

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
          {(["x", "y", "z"] as const).map((ax) => {
            const dimId = axes[ax];
            const baseDim = getDimensionById(dimId)!;
            const curLvl = effLvl(dimId);
            return (
              <div key={ax} className="olap-sel">
                <label style={{ color: AX[ax].css }}>
                  {ax.toUpperCase()} Axis
                </label>
                <select
                  value={dimId}
                  onChange={(e) => chAx(ax, e.target.value)}
                  style={{ borderColor: AX[ax].css }}
                  disabled={!!actOp}
                >
                  {DIMENSIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {baseDim.hierarchy && baseDim.hierarchy.length > 1 && (
                  <div className="olap-level-pills">
                    {baseDim.hierarchy.map((lv, li) => {
                      const isAct = li === curLvl;
                      return (
                        <button
                          key={li}
                          className={`olap-level-pill ${isAct ? "active" : ""}`}
                          style={
                            isAct
                              ? {
                                  backgroundColor: AX[ax].css,
                                  borderColor: AX[ax].css,
                                  color: "#fff",
                                }
                              : undefined
                          }
                          onClick={() => chLvl(dimId, li)}
                          disabled={!!actOp}
                          title={`${lv.members.length} member${lv.members.length !== 1 ? "s" : ""}`}
                        >
                          {lv.levelName}
                          <span className="olap-level-count">
                            {lv.members.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="olap-header-right">
          <div className="olap-cell-counter">{tS.count} cells</div>
          <div className="olap-legend">
            <span>Low</span>
            <div className="olap-legend-bar" />
            <span>High</span>
          </div>
          <button
            className={`olap-learn-btn ${conceptMode ? "active" : ""}`}
            onClick={() => {
              if (actOp) return;
              setConceptMode((p) => !p);
              if (conceptMode) clrAll();
            }}
            disabled={!!actOp}
          >
            {conceptMode ? "✕ Close Learn" : "📖 Learn"}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="olap-main">
        {conceptMode && !actOp && (
          <div className="olap-concept-sidebar">
            <div className="olap-concept-sidebar-header">
              <h3>OLAP Concepts</h3>
              <div className="olap-concept-sidebar-actions">
                <button onClick={togAll} className="olap-concept-toggle-all">
                  {actCon.size === CONCEPTS.length ? "Hide All" : "Show All"}
                </button>
                {actCon.size > 0 && (
                  <button onClick={clrAll} className="olap-concept-clear">
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="olap-concept-list">
              {CONCEPTS.map((c) => {
                const isA = actCon.has(c.id),
                  isE = expCon === c.id;
                return (
                  <div
                    key={c.id}
                    className={`olap-concept-card ${isA ? "active" : ""}`}
                    style={{ borderLeftColor: isA ? c.color : "#ddd" }}
                  >
                    <div className="olap-concept-card-header">
                      <button
                        className="olap-concept-toggle-btn"
                        style={{
                          backgroundColor: isA ? c.color : "#eee",
                          color: isA ? "#fff" : "#888",
                        }}
                        onClick={() => togCon(c.id)}
                      >
                        {c.icon}
                      </button>
                      <div
                        className="olap-concept-card-text"
                        onClick={() => setExpCon(isE ? null : c.id)}
                      >
                        <span className="olap-concept-card-label">
                          {c.label}
                        </span>
                        <span className="olap-concept-card-short">
                          {c.shortDesc}
                        </span>
                      </div>
                      <label className="olap-concept-switch">
                        <input
                          type="checkbox"
                          checked={isA}
                          onChange={() => togCon(c.id)}
                        />
                        <span
                          className="olap-concept-switch-slider"
                          style={isA ? { backgroundColor: c.color } : undefined}
                        />
                      </label>
                    </div>
                    {isE && (
                      <div className="olap-concept-card-body">
                        <p>{c.longDesc}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="olap-scene-col">
          <div
            className="olap-viewport"
            ref={cvRef}
            onMouseMove={onPM}
            onMouseDown={onPD}
            onMouseUp={onPU}
            onMouseLeave={onPL}
          />

          {/* Ops panel */}
          <div className="olap-ops-panel">
            <div className="olap-ops-header">
              <span className="olap-ops-title">⚙ OLAP Operations</span>
              {actOp && (
                <button className="olap-ops-reset-btn" onClick={resetOp}>
                  ⟲ Reset
                </button>
              )}
            </div>
            {!actOp && (
              <div className="olap-ops-grid">
                {OPERATIONS.map((op) => (
                  <button
                    key={op.id}
                    className="olap-ops-card"
                    style={{ borderColor: op.color }}
                    onClick={() => startOp(op.id)}
                  >
                    <span className="olap-ops-card-icon">{op.icon}</span>
                    <span className="olap-ops-card-name">{op.name}</span>
                    <span className="olap-ops-card-desc">{op.description}</span>
                  </button>
                ))}
              </div>
            )}
            {actOp && aOD && (
              <div className="olap-ops-active">
                <div className="olap-ops-active-title">
                  <span style={{ color: aOD.color }}>
                    {aOD.icon} {aOD.name}
                  </span>
                </div>
                <div className="olap-ops-steps">
                  {aOD.steps.map((_, i) => (
                    <React.Fragment key={i}>
                      <div
                        className={`olap-ops-step-dot ${i < curStep ? "done" : i === curStep ? "current" : ""}`}
                        style={
                          i <= curStep
                            ? {
                                borderColor: aOD.color,
                                background:
                                  i < curStep || (i === curStep && stepDone)
                                    ? aOD.color
                                    : "#fff",
                              }
                            : {}
                        }
                      >
                        {i < curStep || (i === curStep && stepDone)
                          ? "✓"
                          : i + 1}
                      </div>
                      {i < aOD.steps.length - 1 && (
                        <div
                          className={`olap-ops-step-line ${i < curStep ? "done" : ""}`}
                          style={i < curStep ? { background: aOD.color } : {}}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <div className="olap-ops-step-info">
                  <div
                    className="olap-ops-step-label"
                    style={{ color: aOD.color }}
                  >
                    Step {curStep + 1}: {aOD.steps[curStep].label}
                  </div>
                  <p className="olap-ops-step-desc">
                    {aOD.steps[curStep].description}
                  </p>
                </div>
                <div className="olap-ops-controls">
                  <button
                    className="olap-ops-ctrl-btn"
                    disabled={curStep === 0}
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
                    disabled={curStep >= aOD.steps.length - 1 || !stepDone}
                    onClick={() => goStep(1)}
                  >
                    Next ▶
                  </button>
                </div>
                <div className="olap-ops-progress-track">
                  <div
                    className="olap-ops-progress-fill"
                    style={{
                      width: `${((curStep + (stepDone ? 1 : 0.5)) / aOD.steps.length) * 100}%`,
                      background: aOD.color,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Table */}
          <div className={`olap-table-section ${tblCol ? "collapsed" : ""}`}>
            <div className="olap-table-header">
              <div className="olap-table-title">
                <span className="olap-table-title-icon">▤</span>
                <h3>Fact Table</h3>
                <span className="olap-table-count">
                  {tS.count} cells · Σ {tS.total.toLocaleString()} · μ{" "}
                  {tS.avg.toLocaleString()} · ↓ {tS.min} · ↑ {tS.max}
                </span>
              </div>
              <button
                className="olap-table-collapse-btn"
                onClick={() => setTblCol((p) => !p)}
              >
                {tblCol ? "▲ Show" : "▼ Hide"}
              </button>
            </div>
            {!tblCol && (
              <div className="olap-table-scroll">
                <table className="olap-table">
                  <thead>
                    <tr>
                      <th className="olap-th-idx">#</th>
                      <th style={{ color: AX.x.css }}>
                        {dimDisp.x}
                        <span className="olap-th-axis">X</span>
                      </th>
                      <th style={{ color: AX.y.css }}>
                        {dimDisp.y}
                        <span className="olap-th-axis">Y</span>
                      </th>
                      <th style={{ color: AX.z.css }}>
                        {dimDisp.z}
                        <span className="olap-th-axis">Z</span>
                      </th>
                      <th className="olap-th-value">Value</th>
                      <th className="olap-th-bar">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCells.map((cell, i) => {
                      const k = ck(cell),
                        isSel = selKey === k,
                        bw =
                          tS.max > tS.min
                            ? ((cell.value - tS.min) / (tS.max - tS.min)) * 100
                            : 50;
                      const col = v2c(cell.value, tS.min, tS.max);
                      const bc = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
                      return (
                        <tr
                          key={k}
                          ref={(el) => {
                            if (el) trRef.current.set(k, el);
                            else trRef.current.delete(k);
                          }}
                          className={getRC(cell)}
                          onClick={() => {
                            if (actOp) return;
                            selectCell(isSel ? null : cell);
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
            {actOp
              ? "Operation in progress · Rotate the cube to observe"
              : "Drag to rotate · Scroll to zoom · Click a cell or row to inspect"}
          </div>
        </div>
      </div>

      {hoverCell && !actOp && (
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

      {selCell && !actOp && (
        <div
          className="olap-detail"
          style={conceptMode ? { right: "340px" } : undefined}
        >
          <div className="olap-detail-top">
            <h3>Cell Details</h3>
            <button onClick={closeDet}>×</button>
          </div>
          <table>
            <tbody>
              <tr>
                <td style={{ color: AX.x.css }}>{dimDisp.x}</td>
                <td>{selCell.xMember}</td>
              </tr>
              <tr>
                <td style={{ color: AX.y.css }}>{dimDisp.y}</td>
                <td>{selCell.yMember}</td>
              </tr>
              <tr>
                <td style={{ color: AX.z.css }}>{dimDisp.z}</td>
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

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellInfo, AxisAssignment, ConceptId } from "./types";
import { DIMENSIONS, generateCellValue, getDimensionById } from "./data";
import { CONCEPTS, getConceptById } from "./concepts";
import "./OlapCube.css";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function valueToColor(value: number, min: number, max: number): THREE.Color {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const stops: [number, number, number][] = [
    [0.25, 0.55, 0.83],
    [0.18, 0.68, 0.68],
    [0.26, 0.72, 0.45],
    [0.9, 0.72, 0.22],
    [0.85, 0.28, 0.22],
  ];
  const idx = t * (stops.length - 1);
  const lo = Math.max(0, Math.floor(idx));
  const hi = Math.min(stops.length - 1, lo + 1);
  const f = idx - lo;
  return new THREE.Color(
    stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f,
    stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f,
    stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f
  );
}

function makeTextSprite(
  text: string,
  opts: { color?: string; size?: number; bold?: boolean; scale?: number } = {}
): THREE.Sprite {
  const { color = "#333", size = 40, bold = false, scale = 1 } = opts;
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d")!;
  const font = `${bold ? "bold " : ""}${size}px "Segoe UI",Arial,sans-serif`;
  c.font = font;
  const w = c.measureText(text).width;
  const pad = 14;
  canvas.width = Math.ceil(w) + pad * 2;
  canvas.height = Math.ceil(size * 1.35) + pad * 2;
  c.font = font;
  c.fillStyle = color;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(aspect * scale, scale, 1);
  return sprite;
}

function makeBadgeSprite(
  text: string,
  bgColor: string,
  opts: { scale?: number; maxWidth?: number } = {}
): THREE.Sprite {
  const { scale = 1, maxWidth = 500 } = opts;
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d")!;
  const fontSize = 32;
  const font = `bold ${fontSize}px "Segoe UI",Arial,sans-serif`;
  c.font = font;
  const tw = Math.min(c.measureText(text).width, maxWidth);
  const padX = 24;
  const padY = 14;
  canvas.width = Math.ceil(tw) + padX * 2;
  canvas.height = Math.ceil(fontSize * 1.4) + padY * 2;
  const r = canvas.height / 2;
  c.fillStyle = bgColor;
  c.beginPath();
  c.roundRect(0, 0, canvas.width, canvas.height, r);
  c.fill();
  c.font = font;
  c.fillStyle = "#fff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, canvas.width / 2, canvas.height / 2, maxWidth);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(aspect * scale, scale, 1);
  return sprite;
}

function makeValueLabel(value: number, faceColor: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, 128, 128);
  c.font = "bold 42px 'Segoe UI', Arial, sans-serif";
  c.fillStyle = faceColor;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(String(value), 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeDashedLine(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: number
): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const m = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.15,
    gapSize: 0.08,
    transparent: true,
    opacity: 0.8,
  });
  const line = new THREE.Line(g, m);
  line.computeLineDistances();
  return line;
}

function makeSolidLine(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: number,
  opacity = 0.7
): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(g, m);
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.Line
    ) {
      obj.geometry?.dispose();
      const m = obj.material;
      if (Array.isArray(m))
        m.forEach((x) => {
          if ("map" in x && x.map) x.map.dispose();
          x.dispose();
        });
      else if (m) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ("map" in m && (m as any).map) (m as any).map.dispose();
        m.dispose();
      }
    } else if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
  group.clear();
}

/* ------------------------------------------------------------------ */
/*  Scene context ref                                                  */
/* ------------------------------------------------------------------ */
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
  hoveredMesh: THREE.Mesh | null;
  selectedMesh: THREE.Mesh | null;
  animId: number;
  buildTime: number;
  /** data needed by concept overlay builder */
  cubeMetrics: {
    xN: number;
    yN: number;
    zN: number;
    xOff: number;
    yOff: number;
    zOff: number;
    xDimName: string;
    yDimName: string;
    zDimName: string;
    xDimId: string;
    yDimId: string;
    zDimId: string;
    mn: number;
    mx: number;
  } | null;
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
const OlapCube: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneCtx | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  const [axes, setAxes] = useState<AxisAssignment>({
    x: "product",
    y: "region",
    z: "time",
  });
  const [selCell, setSelCell] = useState<CellInfo | null>(null);
  const [hoverCell, setHoverCell] = useState<CellInfo | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  // concept mode
  const [conceptMode, setConceptMode] = useState(false);
  const [activeConcepts, setActiveConcepts] = useState<Set<ConceptId>>(
    new Set()
  );
  const [expandedConcept, setExpandedConcept] = useState<ConceptId | null>(
    null
  );

  const anyConcept = activeConcepts.size > 0;

  /* ---------------------------------------------------------------- */
  /*  Init Three.js scene                                              */
  /* ---------------------------------------------------------------- */
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
    scene.add(cubeGroup, labelGroup, axisGroup, conceptGroup);

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
      hoveredMesh: null,
      selectedMesh: null,
      animId: 0,
      buildTime: 0,
      cubeMetrics: null,
    };
    sceneRef.current = ctx;

    const animate = () => {
      ctx.animId = requestAnimationFrame(animate);
      controls.update();
      const elapsed = performance.now() - ctx.buildTime;
      let idx = 0;
      cubeGroup.children.forEach((c) => {
        if (c instanceof THREE.Mesh && c.userData.cellInfo) {
          const t = Math.min(1, Math.max(0, (elapsed - idx * 25) / 400));
          c.scale.setScalar(1 - Math.pow(1 - t, 3));
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

  /* ---------------------------------------------------------------- */
  /*  Build cube                                                       */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    disposeGroup(ctx.cubeGroup);
    disposeGroup(ctx.labelGroup);
    disposeGroup(ctx.axisGroup);
    disposeGroup(ctx.conceptGroup);

    const xDim = getDimensionById(axes.x)!;
    const yDim = getDimensionById(axes.y)!;
    const zDim = getDimensionById(axes.z)!;
    const xN = xDim.members.length;
    const yN = yDim.members.length;
    const zN = zDim.members.length;
    const xOff = (-(xN - 1) * CELL_STRIDE) / 2;
    const yOff = (-(yN - 1) * CELL_STRIDE) / 2;
    const zOff = (-(zN - 1) * CELL_STRIDE) / 2;

    const cells: CellInfo[] = [];
    for (let xi = 0; xi < xN; xi++)
      for (let yi = 0; yi < yN; yi++)
        for (let zi = 0; zi < zN; zi++) {
          cells.push({
            xIndex: xi,
            yIndex: yi,
            zIndex: zi,
            xMember: xDim.members[xi],
            yMember: yDim.members[yi],
            zMember: zDim.members[zi],
            xDimension: xDim.name,
            yDimension: yDim.name,
            zDimension: zDim.name,
            value: generateCellValue([
              xDim.members[xi],
              yDim.members[yi],
              zDim.members[zi],
            ]),
          });
        }
    const vals = cells.map((c) => c.value);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);

    ctx.cubeMetrics = {
      xN,
      yN,
      zN,
      xOff,
      yOff,
      zOff,
      xDimName: xDim.name,
      yDimName: yDim.name,
      zDimName: zDim.name,
      xDimId: xDim.id,
      yDimId: yDim.id,
      zDimId: zDim.id,
      mn,
      mx,
    };

    const boxG = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const edgeG = new THREE.EdgesGeometry(boxG);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x999999,
      transparent: true,
      opacity: 0.35,
    });
    const valuePlaneG = new THREE.PlaneGeometry(
      CELL_SIZE * 0.85,
      CELL_SIZE * 0.85
    );

    cells.forEach((cell) => {
      const col = valueToColor(cell.value, mn, mx);
      const mat = new THREE.MeshPhongMaterial({
        color: col,
        transparent: true,
        opacity: 0.88,
        shininess: 40,
        specular: new THREE.Color(0x222222),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(boxG, mat);
      mesh.position.set(
        cell.xIndex * CELL_STRIDE + xOff,
        cell.yIndex * CELL_STRIDE + yOff,
        cell.zIndex * CELL_STRIDE + zOff
      );
      mesh.userData = {
        cellInfo: cell,
        originalColor: col.clone(),
      };
      mesh.scale.setScalar(0);
      mesh.add(new THREE.LineSegments(edgeG, edgeMat));

      const luminance = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
      const textColor = luminance > 0.52 ? "#1a1a1a" : "#ffffff";

      const addFaceLabel = (
        pos: THREE.Vector3,
        rot: THREE.Euler | null
      ) => {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.copy(pos);
        if (rot) plane.rotation.copy(rot);
        mesh.add(plane);
      };

      if (cell.xIndex === xN - 1)
        addFaceLabel(
          new THREE.Vector3(CELL_SIZE / 2 + 0.005, 0, 0),
          new THREE.Euler(0, Math.PI / 2, 0)
        );
      if (cell.zIndex === zN - 1)
        addFaceLabel(new THREE.Vector3(0, 0, CELL_SIZE / 2 + 0.005), null);
      if (cell.yIndex === yN - 1)
        addFaceLabel(
          new THREE.Vector3(0, CELL_SIZE / 2 + 0.005, 0),
          new THREE.Euler(-Math.PI / 2, 0, 0)
        );
      if (cell.xIndex === 0)
        addFaceLabel(
          new THREE.Vector3(-CELL_SIZE / 2 - 0.005, 0, 0),
          new THREE.Euler(0, -Math.PI / 2, 0)
        );
      if (cell.zIndex === 0)
        addFaceLabel(
          new THREE.Vector3(0, 0, -CELL_SIZE / 2 - 0.005),
          new THREE.Euler(0, Math.PI, 0)
        );
      if (cell.yIndex === 0)
        addFaceLabel(
          new THREE.Vector3(0, -CELL_SIZE / 2 - 0.005, 0),
          new THREE.Euler(Math.PI / 2, 0, 0)
        );

      ctx.cubeGroup.add(mesh);
    });

    // member labels
    const lblMargin = CELL_STRIDE * 0.88;
    xDim.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.x.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(
        i * CELL_STRIDE + xOff,
        yOff - lblMargin,
        zOff - lblMargin
      );
      s.userData = { conceptTag: "members", axis: "x", memberIndex: i };
      ctx.labelGroup.add(s);
    });
    yDim.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.y.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(
        xOff - lblMargin,
        i * CELL_STRIDE + yOff,
        zOff - lblMargin
      );
      s.userData = { conceptTag: "members", axis: "y", memberIndex: i };
      ctx.labelGroup.add(s);
    });
    zDim.members.forEach((m, i) => {
      const s = makeTextSprite(m, {
        color: AXIS_COLORS.z.css,
        size: 30,
        scale: 0.5,
      });
      s.position.set(
        xOff - lblMargin,
        yOff - lblMargin,
        i * CELL_STRIDE + zOff
      );
      s.userData = { conceptTag: "members", axis: "z", memberIndex: i };
      ctx.labelGroup.add(s);
    });

    // dim name labels
    const nameOff = CELL_STRIDE * 1.4;
    [
      {
        dim: xDim,
        axis: "x" as const,
        pos: new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          yOff - nameOff,
          zOff - lblMargin
        ),
      },
      {
        dim: yDim,
        axis: "y" as const,
        pos: new THREE.Vector3(
          xOff - nameOff,
          ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
          zOff - lblMargin
        ),
      },
      {
        dim: zDim,
        axis: "z" as const,
        pos: new THREE.Vector3(
          xOff - lblMargin,
          yOff - nameOff,
          ((zN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE
        ),
      },
    ].forEach(({ dim, axis, pos }) => {
      const s = makeTextSprite(dim.name, {
        color: AXIS_COLORS[axis].css,
        size: 34,
        bold: true,
        scale: 0.65,
      });
      s.position.copy(pos);
      s.userData = { conceptTag: "dimensions", axis };
      ctx.labelGroup.add(s);
    });

    // axis lines
    const base = new THREE.Vector3(
      xOff - CELL_STRIDE * 0.5,
      yOff - CELL_STRIDE * 0.5,
      zOff - CELL_STRIDE * 0.5
    );
    const addLine = (
      from: THREE.Vector3,
      to: THREE.Vector3,
      color: number
    ) => {
      const g = new THREE.BufferGeometry().setFromPoints([from, to]);
      const m = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
      });
      const l = new THREE.Line(g, m);
      l.userData = { conceptTag: "dimensions" };
      ctx.axisGroup.add(l);
    };
    addLine(
      base.clone(),
      new THREE.Vector3(-base.x + CELL_STRIDE * 0.3, base.y, base.z),
      AXIS_COLORS.x.hex
    );
    addLine(
      base.clone(),
      new THREE.Vector3(base.x, -base.y + CELL_STRIDE * 0.3, base.z),
      AXIS_COLORS.y.hex
    );
    addLine(
      base.clone(),
      new THREE.Vector3(base.x, base.y, -base.z + CELL_STRIDE * 0.3),
      AXIS_COLORS.z.hex
    );

    ctx.buildTime = performance.now();
    ctx.hoveredMesh = null;
    ctx.selectedMesh = null;
    setSelCell(null);
    setHoverCell(null);
  }, [axes]);

  /* ---------------------------------------------------------------- */
  /*  Concept overlay builder                                          */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !ctx.cubeMetrics) return;

    disposeGroup(ctx.conceptGroup);

    const met = ctx.cubeMetrics;
    const { xN, yN, zN, xOff, yOff, zOff } = met;

    // ---- apply greying to non-highlighted elements ----
    ctx.cubeGroup.children.forEach((c) => {
      if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
      const mat = c.material as THREE.MeshPhongMaterial;
      const origCol = c.userData.originalColor as THREE.Color;

      if (!anyConcept) {
        mat.color.copy(origCol);
        mat.opacity = 0.88;
        return;
      }

      // decide if this cell is "relevant"
      const isCellHighlighted =
        activeConcepts.has("cells") ||
        activeConcepts.has("facts") ||
        activeConcepts.has("measures");

      if (isCellHighlighted) {
        mat.color.copy(origCol);
        mat.opacity = 0.88;
      } else {
        mat.color.setHex(GREY_COLOR);
        mat.opacity = GREY_OPACITY;
      }
    });

    // grey/un-grey label & axis groups
    const updateLabelVis = (obj: THREE.Object3D) => {
      if (!anyConcept) {
        if (obj instanceof THREE.Sprite) obj.material.opacity = 1;
        if (obj instanceof THREE.Line) {
          (obj.material as THREE.LineBasicMaterial).opacity = 0.55;
        }
        return;
      }
      const tag = obj.userData.conceptTag as string | undefined;
      const relevant = tag && activeConcepts.has(tag as ConceptId);
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = relevant ? 1 : 0.15;
      }
      if (obj instanceof THREE.Line) {
        (obj.material as THREE.LineBasicMaterial).opacity = relevant
          ? 0.7
          : 0.08;
      }
    };
    ctx.labelGroup.children.forEach(updateLabelVis);
    ctx.axisGroup.children.forEach(updateLabelVis);

    if (!anyConcept) return;

    // ---- build concept annotations ----

    // helper positions
    const cubeCenter = new THREE.Vector3(
      xOff + ((xN - 1) * CELL_STRIDE) / 2,
      yOff + ((yN - 1) * CELL_STRIDE) / 2,
      zOff + ((zN - 1) * CELL_STRIDE) / 2
    );

    /* --- DIMENSIONS --- */
    if (activeConcepts.has("dimensions")) {
      const conceptDef = getConceptById("dimensions");
      // highlight axis lines are already un-greyed above
      // add dimension badges near the end of each axis
      (["x", "y", "z"] as const).forEach((axis) => {
        const dimName =
          axis === "x"
            ? met.xDimName
            : axis === "y"
              ? met.yDimName
              : met.zDimName;
        const n = axis === "x" ? xN : axis === "y" ? yN : zN;
        const offset =
          axis === "x"
            ? new THREE.Vector3(
                ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
                yOff - CELL_STRIDE,
                zOff - CELL_STRIDE
              )
            : axis === "y"
              ? new THREE.Vector3(
                  xOff - CELL_STRIDE,
                  ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8,
                  zOff - CELL_STRIDE
                )
              : new THREE.Vector3(
                  xOff - CELL_STRIDE,
                  yOff - CELL_STRIDE,
                  ((n - 1) * CELL_STRIDE) / 2 + CELL_STRIDE * 1.8
                );

        const badge = makeBadgeSprite(`DIMENSION: ${dimName}`, conceptDef.color, {
          scale: 0.55,
        });
        badge.position.copy(offset);
        ctx.conceptGroup.add(badge);

        // connector
        const axisEnd =
          axis === "x"
            ? new THREE.Vector3(
                ((n - 1) * CELL_STRIDE) / 2 + xOff + CELL_STRIDE * 0.6,
                yOff - CELL_STRIDE * 0.5,
                zOff - CELL_STRIDE * 0.5
              )
            : axis === "y"
              ? new THREE.Vector3(
                  xOff - CELL_STRIDE * 0.5,
                  ((n - 1) * CELL_STRIDE) / 2 + yOff + CELL_STRIDE * 0.6,
                  zOff - CELL_STRIDE * 0.5
                )
              : new THREE.Vector3(
                  xOff - CELL_STRIDE * 0.5,
                  yOff - CELL_STRIDE * 0.5,
                  ((n - 1) * CELL_STRIDE) / 2 + zOff + CELL_STRIDE * 0.6
                );
        ctx.conceptGroup.add(
          makeDashedLine(
            offset,
            axisEnd,
            new THREE.Color(conceptDef.color).getHex()
          )
        );
      });
    }

    /* --- MEMBERS --- */
    if (activeConcepts.has("members")) {
      const conceptDef = getConceptById("members");
      // highlight a specific row – first X-member
      const memberPos = new THREE.Vector3(
        0 * CELL_STRIDE + xOff,
        yOff - CELL_STRIDE * 1.6,
        zOff - CELL_STRIDE * 1.6
      );
      const badge = makeBadgeSprite("MEMBER (one value in a dimension)", conceptDef.color, {
        scale: 0.48,
      });
      badge.position.copy(memberPos);
      ctx.conceptGroup.add(badge);

      const targetPos = new THREE.Vector3(
        0 * CELL_STRIDE + xOff,
        yOff - CELL_STRIDE * 0.88,
        zOff - CELL_STRIDE * 0.88
      );
      ctx.conceptGroup.add(
        makeDashedLine(
          memberPos,
          targetPos,
          new THREE.Color(conceptDef.color).getHex()
        )
      );

      // circle/ring around first member label
      const ringG = new THREE.RingGeometry(0.32, 0.38, 32);
      const ringM = new THREE.MeshBasicMaterial({
        color: conceptDef.color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(ringG, ringM);
      ring.position.copy(targetPos);
      ctx.conceptGroup.add(ring);
    }

    /* --- CELLS --- */
    if (activeConcepts.has("cells")) {
      const conceptDef = getConceptById("cells");
      // highlight one specific cell (1,1,1)
      const ci = Math.min(1, xN - 1);
      const cj = Math.min(1, yN - 1);
      const ck = Math.min(1, zN - 1);
      const cellPos = new THREE.Vector3(
        ci * CELL_STRIDE + xOff,
        cj * CELL_STRIDE + yOff,
        ck * CELL_STRIDE + zOff
      );
      // wireframe highlight
      const hlG = new THREE.BoxGeometry(
        CELL_SIZE * 1.25,
        CELL_SIZE * 1.25,
        CELL_SIZE * 1.25
      );
      const hlEdge = new THREE.EdgesGeometry(hlG);
      const hlMat = new THREE.LineBasicMaterial({
        color: conceptDef.color,
        transparent: true,
        opacity: 0.9,
      });
      const hlMesh = new THREE.LineSegments(hlEdge, hlMat);
      hlMesh.position.copy(cellPos);
      ctx.conceptGroup.add(hlMesh);

      const badgePos = cellPos
        .clone()
        .add(new THREE.Vector3(CELL_STRIDE * 1.4, CELL_STRIDE * 1.4, 0));
      const badge = makeBadgeSprite("CELL (intersection of members)", conceptDef.color, {
        scale: 0.48,
      });
      badge.position.copy(badgePos);
      ctx.conceptGroup.add(badge);
      ctx.conceptGroup.add(
        makeDashedLine(
          badgePos,
          cellPos,
          new THREE.Color(conceptDef.color).getHex()
        )
      );
    }

    /* --- MEASURES --- */
    if (activeConcepts.has("measures")) {
      const conceptDef = getConceptById("measures");
      // point to a value label on the front face
      const ci = Math.min(1, xN - 1);
      const cj = Math.min(1, yN - 1);
      const facePos = new THREE.Vector3(
        ci * CELL_STRIDE + xOff,
        cj * CELL_STRIDE + yOff,
        (zN - 1) * CELL_STRIDE + zOff + CELL_SIZE / 2 + 0.01
      );
      const badgePos = facePos
        .clone()
        .add(new THREE.Vector3(0, 0, CELL_STRIDE * 2));
      const badge = makeBadgeSprite("MEASURE (numeric value)", conceptDef.color, {
        scale: 0.48,
      });
      badge.position.copy(badgePos);
      ctx.conceptGroup.add(badge);
      ctx.conceptGroup.add(
        makeDashedLine(
          badgePos,
          facePos,
          new THREE.Color(conceptDef.color).getHex()
        )
      );
    }

    /* --- FACTS --- */
    if (activeConcepts.has("facts")) {
      const conceptDef = getConceptById("facts");
      // bounding box around entire cube
      const halfX = ((xN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const halfY = ((yN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const halfZ = ((zN - 1) * CELL_STRIDE) / 2 + CELL_SIZE * 0.8;
      const bbG = new THREE.BoxGeometry(halfX * 2, halfY * 2, halfZ * 2);
      const bbEdge = new THREE.EdgesGeometry(bbG);
      const bbMat = new THREE.LineDashedMaterial({
        color: conceptDef.color,
        dashSize: 0.25,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.6,
      });
      const bb = new THREE.LineSegments(bbEdge, bbMat);
      bb.computeLineDistances();
      bb.position.copy(cubeCenter);
      ctx.conceptGroup.add(bb);

      const badgePos = cubeCenter
        .clone()
        .add(new THREE.Vector3(halfX + CELL_STRIDE, halfY + CELL_STRIDE, 0));
      const badge = makeBadgeSprite("FACT TABLE (all data)", conceptDef.color, {
        scale: 0.52,
      });
      badge.position.copy(badgePos);
      ctx.conceptGroup.add(badge);
      ctx.conceptGroup.add(
        makeDashedLine(
          badgePos,
          cubeCenter
            .clone()
            .add(new THREE.Vector3(halfX * 0.5, halfY * 0.5, 0)),
          new THREE.Color(conceptDef.color).getHex()
        )
      );
    }

    /* --- GRANULARITY --- */
    if (activeConcepts.has("granularity")) {
      const conceptDef = getConceptById("granularity");
      // show the spacing between cells along X axis
      const y = yOff - CELL_STRIDE * 0.5;
      const z = zOff - CELL_STRIDE * 0.5;
      for (let i = 0; i < xN; i++) {
        const x = i * CELL_STRIDE + xOff;
        const dotG = new THREE.SphereGeometry(0.06, 12, 12);
        const dotM = new THREE.MeshBasicMaterial({ color: conceptDef.color });
        const dot = new THREE.Mesh(dotG, dotM);
        dot.position.set(x, y, z);
        ctx.conceptGroup.add(dot);
      }
      // bracket lines
      if (xN >= 2) {
        const bracketY = y - 0.4;
        ctx.conceptGroup.add(
          makeSolidLine(
            new THREE.Vector3(xOff, bracketY, z),
            new THREE.Vector3(
              (xN - 1) * CELL_STRIDE + xOff,
              bracketY,
              z
            ),
            new THREE.Color(conceptDef.color).getHex()
          )
        );
        for (let i = 0; i < xN; i++) {
          ctx.conceptGroup.add(
            makeSolidLine(
              new THREE.Vector3(i * CELL_STRIDE + xOff, y, z),
              new THREE.Vector3(i * CELL_STRIDE + xOff, bracketY, z),
              new THREE.Color(conceptDef.color).getHex(),
              0.4
            )
          );
        }
      }

      const badgePos = new THREE.Vector3(
        ((xN - 1) * CELL_STRIDE) / 2 + xOff,
        y - 1.0,
        z
      );
      const badge = makeBadgeSprite(
        `GRANULARITY: ${xN} members (${met.xDimName})`,
        conceptDef.color,
        { scale: 0.45 }
      );
      badge.position.copy(badgePos);
      ctx.conceptGroup.add(badge);
    }

    /* --- ATTRIBUTES --- */
    if (activeConcepts.has("attributes")) {
      const conceptDef = getConceptById("attributes");
      // show example attributes floating next to first member label
      const targetPos = new THREE.Vector3(
        0 * CELL_STRIDE + xOff,
        yOff - CELL_STRIDE * 0.88,
        zOff - CELL_STRIDE * 0.88
      );
      const xDim = getDimensionById(met.xDimId)!;
      const memberName = xDim.members[0];

      const attrs = [
        { key: "Name", val: memberName },
        { key: "Code", val: "SKU-001" },
        { key: "Color", val: "Silver" },
        { key: "Weight", val: "0.4 kg" },
      ];

      const startY = targetPos.y;
      const attrX = targetPos.x - CELL_STRIDE * 2.5;
      const attrZ = targetPos.z - CELL_STRIDE * 0.5;

      attrs.forEach((attr, i) => {
        const ay = startY - i * 0.45;
        const label = makeBadgeSprite(
          `${attr.key}: ${attr.val}`,
          i === 0 ? conceptDef.color : "#6366f1",
          { scale: 0.35 }
        );
        label.position.set(attrX, ay, attrZ);
        ctx.conceptGroup.add(label);
      });

      const mainBadge = makeBadgeSprite("ATTRIBUTES (properties of a member)", conceptDef.color, {
        scale: 0.45,
      });
      mainBadge.position.set(attrX, startY + 0.6, attrZ);
      ctx.conceptGroup.add(mainBadge);

      ctx.conceptGroup.add(
        makeDashedLine(
          new THREE.Vector3(attrX + 0.8, startY - 0.2, attrZ),
          targetPos,
          new THREE.Color(conceptDef.color).getHex()
        )
      );
    }

    /* --- HIERARCHIES --- */
    if (activeConcepts.has("hierarchies")) {
      const conceptDef = getConceptById("hierarchies");
      const xDim = getDimensionById(met.xDimId)!;
      const hier = xDim.hierarchy;

      if (hier && hier.length > 0) {
        const treeBaseX =
          ((xN - 1) * CELL_STRIDE) / 2 + xOff + CELL_STRIDE * 2.5;
        const treeBaseY = yOff + ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE;
        const treeBaseZ = zOff + ((zN - 1) * CELL_STRIDE) / 2;

        const levelSpacing = 1.6;
        const conceptCol = new THREE.Color(conceptDef.color).getHex();

        // Title
        const titleBadge = makeBadgeSprite(
          `HIERARCHY: ${xDim.name}`,
          conceptDef.color,
          { scale: 0.52 }
        );
        titleBadge.position.set(treeBaseX, treeBaseY + 1.0, treeBaseZ);
        ctx.conceptGroup.add(titleBadge);

        // Draw tree levels
        interface NodeInfo {
          pos: THREE.Vector3;
          label: string;
        }

        const levelNodes: NodeInfo[][] = [];

        hier.forEach((level, li) => {
          const yPos = treeBaseY - li * levelSpacing;
          const members =
            level.members.length > 4
              ? [...level.members.slice(0, 3), "..."]
              : level.members;
          const totalWidth = (members.length - 1) * 1.2;
          const nodes: NodeInfo[] = [];

          // level name on the left
          const levelLabel = makeBadgeSprite(level.levelName, "#555", {
            scale: 0.35,
          });
          levelLabel.position.set(
            treeBaseX - totalWidth / 2 - 1.6,
            yPos,
            treeBaseZ
          );
          ctx.conceptGroup.add(levelLabel);

          members.forEach((member, mi) => {
            const xPos = treeBaseX - totalWidth / 2 + mi * 1.2;
            const pos = new THREE.Vector3(xPos, yPos, treeBaseZ);

            // node circle
            const nodeG = new THREE.CircleGeometry(0.18, 24);
            const nodeM = new THREE.MeshBasicMaterial({
              color: conceptDef.color,
              side: THREE.DoubleSide,
              depthTest: false,
              transparent: true,
              opacity: 0.85,
            });
            const node = new THREE.Mesh(nodeG, nodeM);
            node.position.copy(pos);
            ctx.conceptGroup.add(node);

            // node label
            const lbl = makeTextSprite(member, {
              color: "#333",
              size: 26,
              scale: 0.35,
            });
            lbl.position.set(xPos, yPos - 0.35, treeBaseZ);
            ctx.conceptGroup.add(lbl);

            nodes.push({ pos, label: member });
          });

          levelNodes.push(nodes);
        });

        // Draw connecting lines between levels
        for (let li = 0; li < levelNodes.length - 1; li++) {
          const parents = levelNodes[li];
          const children = levelNodes[li + 1];
          const childrenPerParent = Math.ceil(
            children.length / parents.length
          );

          children.forEach((child, ci) => {
            const pi = Math.min(
              Math.floor(ci / childrenPerParent),
              parents.length - 1
            );
            ctx.conceptGroup.add(
              makeSolidLine(
                parents[pi].pos.clone().add(new THREE.Vector3(0, -0.2, 0)),
                child.pos.clone().add(new THREE.Vector3(0, 0.2, 0)),
                conceptCol,
                0.4
              )
            );
          });
        }

        // Arrow/line from hierarchy tree to the X-axis
        const axisTarget = new THREE.Vector3(
          ((xN - 1) * CELL_STRIDE) / 2 + xOff + CELL_STRIDE * 0.6,
          yOff - CELL_STRIDE * 0.5,
          zOff - CELL_STRIDE * 0.5
        );
        const treeBottom = new THREE.Vector3(
          treeBaseX,
          treeBaseY - (hier.length - 1) * levelSpacing - 0.8,
          treeBaseZ
        );
        ctx.conceptGroup.add(
          makeDashedLine(treeBottom, axisTarget, conceptCol)
        );

        // drill-down arrow annotation
        const arrowLabel = makeBadgeSprite("▼ Drill Down   ▲ Roll Up", conceptDef.color, {
          scale: 0.38,
        });
        arrowLabel.position.set(
          treeBaseX + totalTreeWidth(hier) * 0.5 + 2.0,
          treeBaseY - ((hier.length - 1) * levelSpacing) / 2,
          treeBaseZ
        );
        ctx.conceptGroup.add(arrowLabel);

        // vertical arrow line for drill-down indication
        ctx.conceptGroup.add(
          makeSolidLine(
            new THREE.Vector3(
              treeBaseX + totalTreeWidth(hier) * 0.5 + 2.0,
              treeBaseY - 0.2,
              treeBaseZ
            ),
            new THREE.Vector3(
              treeBaseX + totalTreeWidth(hier) * 0.5 + 2.0,
              treeBaseY - (hier.length - 1) * levelSpacing + 0.2,
              treeBaseZ
            ),
            conceptCol,
            0.5
          )
        );
      }
    }

    function totalTreeWidth(
      hier: { levelName: string; members: string[] }[]
    ): number {
      const maxMembers = Math.max(
        ...hier.map((l) => Math.min(l.members.length, 4))
      );
      return (maxMembers - 1) * 1.2;
    }
  }, [activeConcepts, anyConcept, axes]);

  /* ---------------------------------------------------------------- */
  /*  Per-frame styling (hover / selection + concept grey-out)         */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    let prevAnimId = 0;

    const frameLoop = () => {
      prevAnimId = requestAnimationFrame(frameLoop);

      const sel = ctx.selectedMesh?.userData.cellInfo as
        | CellInfo
        | undefined;

      ctx.cubeGroup.children.forEach((c) => {
        if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
        const info = c.userData.cellInfo as CellInfo;
        const mat = c.material as THREE.MeshPhongMaterial;
        const origCol = c.userData.originalColor as THREE.Color;
        const isHov = c === ctx.hoveredMesh;
        const isSel = c === ctx.selectedMesh;

        // If concept mode with relevant concepts, some cells are already greyed
        if (anyConcept) {
          const isCellHighlighted =
            activeConcepts.has("cells") ||
            activeConcepts.has("facts") ||
            activeConcepts.has("measures");
          if (!isCellHighlighted) {
            mat.emissive.setHex(0x000000);
            return; // keep grey
          }
        }

        if (sel && !anyConcept) {
          const mx = info.xIndex === sel.xIndex ? 1 : 0;
          const my = info.yIndex === sel.yIndex ? 1 : 0;
          const mz = info.zIndex === sel.zIndex ? 1 : 0;
          const matches = mx + my + mz;
          if (isSel) {
            mat.emissive.setHex(0x222222);
            mat.opacity = 1;
            mat.color.copy(origCol);
          } else if (isHov) {
            mat.emissive.setHex(0x1a1a1a);
            mat.opacity = 0.95;
            mat.color.copy(origCol);
          } else if (matches >= 2) {
            mat.emissive.setHex(0x0a0a0a);
            mat.opacity = 0.8;
            mat.color.copy(origCol);
          } else if (matches === 1) {
            mat.emissive.setHex(0x000000);
            mat.opacity = 0.55;
            mat.color.copy(origCol);
          } else {
            mat.emissive.setHex(0x000000);
            mat.opacity = 0.18;
            mat.color.copy(origCol);
          }
        } else if (isHov) {
          mat.emissive.setHex(0x1a1a1a);
          mat.opacity = 1;
          mat.color.copy(origCol);
        } else if (!anyConcept) {
          mat.emissive.setHex(0x000000);
          mat.opacity = 0.88;
          mat.color.copy(origCol);
        } else {
          mat.emissive.setHex(0x000000);
        }
      });
    };
    frameLoop();
    return () => cancelAnimationFrame(prevAnimId);
  }, [activeConcepts, anyConcept]);

  /* ---------------------------------------------------------------- */
  /*  Interaction handlers                                             */
  /* ---------------------------------------------------------------- */
  const findCellMesh = useCallback(
    (hits: THREE.Intersection[]): THREE.Mesh | null => {
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj instanceof THREE.Mesh && obj.userData.cellInfo) return obj;
          obj = obj.parent;
        }
      }
      return null;
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.MouseEvent) => {
      const ctx = sceneRef.current;
      const el = canvasRef.current;
      if (!ctx || !el) return;
      const r = el.getBoundingClientRect();
      ctx.mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
      const hits = ctx.raycaster.intersectObjects(
        ctx.cubeGroup.children,
        true
      );
      const hitMesh = findCellMesh(hits);
      if (hitMesh) {
        ctx.hoveredMesh = hitMesh;
        setHoverCell(hitMesh.userData.cellInfo);
        setTipPos({ x: e.clientX, y: e.clientY });
        el.style.cursor = "pointer";
      } else {
        ctx.hoveredMesh = null;
        setHoverCell(null);
        el.style.cursor = "grab";
      }
    },
    [findCellMesh]
  );

  const onPointerDown = useCallback((e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: React.MouseEvent) => {
      if (mouseDownPos.current) {
        const dx = e.clientX - mouseDownPos.current.x;
        const dy = e.clientY - mouseDownPos.current.y;
        if (dx * dx + dy * dy > 25) return;
      }
      const ctx = sceneRef.current;
      const el = canvasRef.current;
      if (!ctx || !el) return;

      if (ctx.selectedMesh) {
        const old = ctx.selectedMesh.getObjectByName("sel-outline");
        if (old) {
          ctx.selectedMesh.remove(old);
          (old as THREE.LineSegments).geometry.dispose();
          ((old as THREE.LineSegments).material as THREE.Material).dispose();
        }
      }

      const r = el.getBoundingClientRect();
      ctx.mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      ctx.raycaster.setFromCamera(ctx.mouse, ctx.camera);
      const hits = ctx.raycaster.intersectObjects(
        ctx.cubeGroup.children,
        true
      );
      const hitMesh = findCellMesh(hits);

      if (hitMesh) {
        ctx.selectedMesh = hitMesh;
        const oG = new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            CELL_SIZE * 1.12,
            CELL_SIZE * 1.12,
            CELL_SIZE * 1.12
          )
        );
        const oM = new THREE.LineBasicMaterial({ color: 0x222222 });
        const outline = new THREE.LineSegments(oG, oM);
        outline.name = "sel-outline";
        hitMesh.add(outline);
        setSelCell(hitMesh.userData.cellInfo);
      } else {
        ctx.selectedMesh = null;
        setSelCell(null);
      }
    },
    [findCellMesh]
  );

  const onPointerLeave = useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.hoveredMesh = null;
    setHoverCell(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Dimension swap                                                   */
  /* ---------------------------------------------------------------- */
  const changeAxis = useCallback(
    (axis: keyof AxisAssignment, dimId: string) => {
      setAxes((prev) => {
        if (prev[axis] === dimId) return prev;
        const next = { ...prev };
        const conflict = (["x", "y", "z"] as const).find(
          (a) => a !== axis && prev[a] === dimId
        );
        if (conflict) next[conflict] = prev[axis];
        next[axis] = dimId;
        return next;
      });
    },
    []
  );

  const closeDetail = useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx?.selectedMesh) {
      const o = ctx.selectedMesh.getObjectByName("sel-outline");
      if (o) {
        ctx.selectedMesh.remove(o);
        (o as THREE.LineSegments).geometry.dispose();
        ((o as THREE.LineSegments).material as THREE.Material).dispose();
      }
      ctx.selectedMesh = null;
    }
    setSelCell(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Concept toggles                                                  */
  /* ---------------------------------------------------------------- */
  const toggleConcept = useCallback((id: ConceptId) => {
    setActiveConcepts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setActiveConcepts((prev) => {
      if (prev.size === CONCEPTS.length) return new Set();
      return new Set(CONCEPTS.map((c) => c.id));
    });
  }, []);

  const clearAll = useCallback(() => {
    setActiveConcepts(new Set());
    setExpandedConcept(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="olap-root">
      {/* ---- Header ---- */}
      <div className="olap-header">
        <h2 className="olap-title">
          <span className="olap-title-icon">◆</span> OLAP Cube Explorer
        </h2>

        <div className="olap-selectors">
          {(["x", "y", "z"] as const).map((axis) => (
            <div key={axis} className="olap-sel">
              <label style={{ color: AXIS_COLORS[axis].css }}>
                {axis.toUpperCase()} Axis
              </label>
              <select
                value={axes[axis]}
                onChange={(e) => changeAxis(axis, e.target.value)}
                style={{ borderColor: AXIS_COLORS[axis].css }}
              >
                {DIMENSIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
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
            setConceptMode((p) => !p);
            if (conceptMode) clearAll();
          }}
        >
          {conceptMode ? "✕ Close Learn" : "📖 Learn OLAP"}
        </button>
      </div>

      {/* ---- Concept Sidebar ---- */}
      {conceptMode && (
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
              const isActive = activeConcepts.has(concept.id);
              const isExpanded = expandedConcept === concept.id;

              return (
                <div
                  key={concept.id}
                  className={`olap-concept-card ${isActive ? "active" : ""}`}
                  style={{
                    borderLeftColor: isActive ? concept.color : "#ddd",
                  }}
                >
                  <div className="olap-concept-card-header">
                    <button
                      className="olap-concept-toggle-btn"
                      style={{
                        backgroundColor: isActive ? concept.color : "#eee",
                        color: isActive ? "#fff" : "#888",
                      }}
                      onClick={() => toggleConcept(concept.id)}
                    >
                      {concept.icon}
                    </button>
                    <div
                      className="olap-concept-card-text"
                      onClick={() =>
                        setExpandedConcept(isExpanded ? null : concept.id)
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
                        checked={isActive}
                        onChange={() => toggleConcept(concept.id)}
                      />
                      <span
                        className="olap-concept-switch-slider"
                        style={
                          isActive
                            ? { backgroundColor: concept.color }
                            : undefined
                        }
                      />
                    </label>
                  </div>

                  {isExpanded && (
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

      {/* ---- 3D Viewport ---- */}
      <div className="olap-viewport-wrapper">
        <div
          className={`olap-viewport ${conceptMode ? "with-sidebar" : ""}`}
          ref={canvasRef}
          onMouseMove={onPointerMove}
          onMouseDown={onPointerDown}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerLeave}
        />
      </div>

      {/* ---- Hover tooltip ---- */}
      {hoverCell && (
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

      {/* ---- Detail panel ---- */}
      {selCell && (
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
                  {selCell.xDimension}
                </td>
                <td>{selCell.xMember}</td>
              </tr>
              <tr>
                <td style={{ color: AXIS_COLORS.y.css }}>
                  {selCell.yDimension}
                </td>
                <td>{selCell.yMember}</td>
              </tr>
              <tr>
                <td style={{ color: AXIS_COLORS.z.css }}>
                  {selCell.zDimension}
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

      <div className="olap-instructions">
        Drag to rotate · Scroll to zoom · Click a cell to inspect
        {conceptMode && " · Toggle concepts in the sidebar"}
      </div>
    </div>
  );
};

export default OlapCube;
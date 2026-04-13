import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellInfo, AxisAssignment } from "./types";
import { DIMENSIONS, generateCellValue, getDimensionById } from "./data";
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Map a 0-1 t value to a nice blue→teal→green→amber→red colour ramp */
function valueToColor(value: number, min: number, max: number): THREE.Color {
  const t = max > min ? (value - min) / (max - min) : 0.5;

  // multi-stop ramp
  const stops: [number, number, number][] = [
    [0.25, 0.55, 0.83], // cool blue
    [0.18, 0.68, 0.68], // teal
    [0.26, 0.72, 0.45], // green
    [0.90, 0.72, 0.22], // amber
    [0.85, 0.28, 0.22], // warm red
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
  opts: {
    color?: string;
    size?: number;
    bold?: boolean;
    scale?: number;
  } = {}
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

/**
 * Create a small canvas texture with the value text, then place it as a plane
 * on the outside faces of the outermost cells.
 */
function makeValueLabel(
  value: number,
  faceColor: string
): THREE.CanvasTexture {
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
/*  Scene context stored in a ref                                      */
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
  hoveredMesh: THREE.Mesh | null;
  selectedMesh: THREE.Mesh | null;
  animId: number;
  buildTime: number;
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

  /* ---------------------------------------------------------------- */
  /*  1 · Initialise Three.js scene (runs once)                       */
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
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 5;
    controls.maxDistance = 30;

    // Lights – tuned for white background
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
    scene.add(cubeGroup, labelGroup, axisGroup);

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
      hoveredMesh: null,
      selectedMesh: null,
      animId: 0,
      buildTime: 0,
    };
    sceneRef.current = ctx;

    const animate = () => {
      ctx.animId = requestAnimationFrame(animate);
      controls.update();

      // entrance animation
      const elapsed = performance.now() - ctx.buildTime;
      let idx = 0;
      cubeGroup.children.forEach((c) => {
        if (c instanceof THREE.Mesh && c.userData.cellInfo) {
          const t = Math.min(1, Math.max(0, (elapsed - idx * 25) / 400));
          c.scale.setScalar(1 - Math.pow(1 - t, 3));
          idx++;
        }
      });

      // per-frame hover / selection styling
      const sel = ctx.selectedMesh?.userData.cellInfo as
        | CellInfo
        | undefined;

      cubeGroup.children.forEach((c) => {
        if (!(c instanceof THREE.Mesh) || !c.userData.cellInfo) return;
        const info = c.userData.cellInfo as CellInfo;
        const mat = c.material as THREE.MeshPhongMaterial;
        const isHov = c === ctx.hoveredMesh;
        const isSel = c === ctx.selectedMesh;

        if (sel) {
          const mx = info.xIndex === sel.xIndex ? 1 : 0;
          const my = info.yIndex === sel.yIndex ? 1 : 0;
          const mz = info.zIndex === sel.zIndex ? 1 : 0;
          const matches = mx + my + mz;

          if (isSel) {
            mat.emissive.setHex(0x222222);
            mat.opacity = 1;
          } else if (isHov) {
            mat.emissive.setHex(0x1a1a1a);
            mat.opacity = 0.95;
          } else if (matches >= 2) {
            mat.emissive.setHex(0x0a0a0a);
            mat.opacity = 0.8;
          } else if (matches === 1) {
            mat.emissive.setHex(0x000000);
            mat.opacity = 0.55;
          } else {
            mat.emissive.setHex(0x000000);
            mat.opacity = 0.18;
          }
        } else if (isHov) {
          mat.emissive.setHex(0x1a1a1a);
          mat.opacity = 1;
        } else {
          mat.emissive.setHex(0x000000);
          mat.opacity = 0.88;
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
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.material instanceof THREE.Material) o.material.dispose();
        }
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
      if (el.contains(renderer.domElement))
        el.removeChild(renderer.domElement);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  2 · Build / rebuild cube whenever axis assignment changes        */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    disposeGroup(ctx.cubeGroup);
    disposeGroup(ctx.labelGroup);
    disposeGroup(ctx.axisGroup);

    const xDim = getDimensionById(axes.x)!;
    const yDim = getDimensionById(axes.y)!;
    const zDim = getDimensionById(axes.z)!;

    const xN = xDim.members.length;
    const yN = yDim.members.length;
    const zN = zDim.members.length;

    const xOff = (-(xN - 1) * CELL_STRIDE) / 2;
    const yOff = (-(yN - 1) * CELL_STRIDE) / 2;
    const zOff = (-(zN - 1) * CELL_STRIDE) / 2;

    // generate all cells
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
      mesh.userData = { cellInfo: cell };
      mesh.scale.setScalar(0);
      mesh.add(new THREE.LineSegments(edgeG, edgeMat));

      // ------- value labels on outer faces -------
      // Determine a readable text colour: dark text on light cells, white on dark
      const luminance = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
      const textColor = luminance > 0.52 ? "#1a1a1a" : "#ffffff";

      // +X face (right side of cube, xi === xN-1)
      if (cell.xIndex === xN - 1) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(CELL_SIZE / 2 + 0.005, 0, 0);
        plane.rotation.y = Math.PI / 2;
        mesh.add(plane);
      }

      // +Z face (front, zi === zN-1)
      if (cell.zIndex === zN - 1) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(0, 0, CELL_SIZE / 2 + 0.005);
        mesh.add(plane);
      }

      // +Y face (top, yi === yN-1)
      if (cell.yIndex === yN - 1) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(0, CELL_SIZE / 2 + 0.005, 0);
        plane.rotation.x = -Math.PI / 2;
        mesh.add(plane);
      }

      // -X face (left, xi === 0)
      if (cell.xIndex === 0) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(-CELL_SIZE / 2 - 0.005, 0, 0);
        plane.rotation.y = -Math.PI / 2;
        mesh.add(plane);
      }

      // -Z face (back, zi === 0)
      if (cell.zIndex === 0) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(0, 0, -CELL_SIZE / 2 - 0.005);
        plane.rotation.y = Math.PI;
        mesh.add(plane);
      }

      // -Y face (bottom, yi === 0)
      if (cell.yIndex === 0) {
        const tex = makeValueLabel(cell.value, textColor);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(valuePlaneG, planeMat);
        plane.position.set(0, -CELL_SIZE / 2 - 0.005, 0);
        plane.rotation.x = Math.PI / 2;
        mesh.add(plane);
      }

      ctx.cubeGroup.add(mesh);
    });

    // --- member labels ---------------------------------------------
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
      ctx.labelGroup.add(s);
    });

    // --- dimension name labels -------------------------------------
    const nameOff = CELL_STRIDE * 1.4;

    const xNameSpr = makeTextSprite(xDim.name, {
      color: AXIS_COLORS.x.css,
      size: 34,
      bold: true,
      scale: 0.65,
    });
    xNameSpr.position.set(
      ((xN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
      yOff - nameOff,
      zOff - lblMargin
    );
    ctx.labelGroup.add(xNameSpr);

    const yNameSpr = makeTextSprite(yDim.name, {
      color: AXIS_COLORS.y.css,
      size: 34,
      bold: true,
      scale: 0.65,
    });
    yNameSpr.position.set(
      xOff - nameOff,
      ((yN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE,
      zOff - lblMargin
    );
    ctx.labelGroup.add(yNameSpr);

    const zNameSpr = makeTextSprite(zDim.name, {
      color: AXIS_COLORS.z.css,
      size: 34,
      bold: true,
      scale: 0.65,
    });
    zNameSpr.position.set(
      xOff - lblMargin,
      yOff - nameOff,
      ((zN - 1) * CELL_STRIDE) / 2 + CELL_STRIDE
    );
    ctx.labelGroup.add(zNameSpr);

    // --- axis lines ------------------------------------------------
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
      ctx.axisGroup.add(new THREE.Line(g, m));
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
  /*  3 · Interaction handlers                                         */
  /* ---------------------------------------------------------------- */
  const onPointerMove = useCallback((e: React.MouseEvent) => {
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

    // find the first hit that has cellInfo (walk up parents)
    let hitMesh: THREE.Mesh | null = null;
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj instanceof THREE.Mesh && obj.userData.cellInfo) {
          hitMesh = obj;
          break;
        }
        obj = obj.parent;
      }
      if (hitMesh) break;
    }

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
  }, []);

  const onPointerDown = useCallback((e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback((e: React.MouseEvent) => {
    if (mouseDownPos.current) {
      const dx = e.clientX - mouseDownPos.current.x;
      const dy = e.clientY - mouseDownPos.current.y;
      if (dx * dx + dy * dy > 25) return;
    }

    const ctx = sceneRef.current;
    const el = canvasRef.current;
    if (!ctx || !el) return;

    // remove old outline
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

    let hitMesh: THREE.Mesh | null = null;
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj instanceof THREE.Mesh && obj.userData.cellInfo) {
          hitMesh = obj;
          break;
        }
        obj = obj.parent;
      }
      if (hitMesh) break;
    }

    if (hitMesh) {
      ctx.selectedMesh = hitMesh;

      const oG = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12,
          CELL_SIZE * 1.12
        )
      );
      const oM = new THREE.LineBasicMaterial({
        color: 0x222222,
        linewidth: 2,
      });
      const outline = new THREE.LineSegments(oG, oM);
      outline.name = "sel-outline";
      hitMesh.add(outline);

      setSelCell(hitMesh.userData.cellInfo);
    } else {
      ctx.selectedMesh = null;
      setSelCell(null);
    }
  }, []);

  const onPointerLeave = useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.hoveredMesh = null;
    setHoverCell(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  4 · Dimension swap logic                                         */
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

  /* ---------------------------------------------------------------- */
  /*  5 · Close detail panel                                           */
  /* ---------------------------------------------------------------- */
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
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="olap-root">
      {/* header */}
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
      </div>

      {/* viewport */}
      <div
        className="olap-viewport"
        ref={canvasRef}
        onMouseMove={onPointerMove}
        onMouseDown={onPointerDown}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerLeave}
      />

      {/* hover tooltip */}
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

      {/* detail panel */}
      {selCell && (
        <div className="olap-detail">
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

      {/* instructions */}
      <div className="olap-instructions">
        Drag to rotate · Scroll to zoom · Click a cell to inspect
      </div>
    </div>
  );
};

export default OlapCube;
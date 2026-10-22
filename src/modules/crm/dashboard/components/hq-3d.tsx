"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as Three from "three";
import type { HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import styles from "@/modules/crm/dashboard/components/hq.module.css";
import type { People } from "@/modules/crm/dashboard/components/hq-3d-people";
import type { RoomKey, World } from "@/modules/crm/dashboard/components/hq-3d-world";

// HireX HQ, mức 3: the office in real 3D — a high floor of a tower over a lit city, with furniture and people from
// CC0 model kits (public/hq3d). Three.js and the models load only when this view opens.
// Drag to turn, scroll to zoom, right-drag to move; hover shows who / what, a click opens the room's screen.
// The building is built once; each data refresh (every minute) only updates numbers, screens and people.

type Props = { rooms: HqRoom[]; team: HqMember[]; stats: HqStats; floor: HqFloor; onUnsupported: () => void };
type Hover = { x: number; y: number; title: string; sub: string } | null;
type Pick = { title: string; sub: string; href: string | null };
type Data = Omit<Props, "onUnsupported">;

interface Engine {
  camera: Three.PerspectiveCamera;
  controls: { update: () => void; dispose: () => void; autoRotate: boolean; target: Three.Vector3; reset: () => void };
  world: World; people: People; started: number;
}

const CAMERA_START = { x: -640, y: 860, z: 1060 };
const TARGET = { x: 0, y: 0, z: 30 };

export function HqScene3D({ rooms, team, stats, floor, onUnsupported }: Props) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const dataRef = useRef<Data>({ rooms, team, stats, floor });
  const [hover, setHover] = useState<Hover>(null);
  const [spinning, setSpinning] = useState(false);
  const [progress, setProgress] = useState<string | null>("Đang tải văn phòng 3D…");
  const fallback = useRef(onUnsupported);
  const navigate = useRef(router.push);
  useEffect(() => { fallback.current = onUnsupported; navigate.current = router.push; });

  useEffect(() => {
    dataRef.current = { rooms, team, stats, floor };
    const engine = engineRef.current;
    if (engine) { engine.world.update(dataRef.current); engine.people.sync(team, (performance.now() - engine.started) / 1000); }
  }, [rooms, team, stats, floor]);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let stopped = false, frame = 0, visible = true;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const [THREE, { OrbitControls }, SkeletonUtils, worldModule, peopleModule] = await Promise.all([
        import("three"), import("three/examples/jsm/controls/OrbitControls.js"), import("three/examples/jsm/utils/SkeletonUtils.js"),
        import("@/modules/crm/dashboard/components/hq-3d-world"), import("@/modules/crm/dashboard/components/hq-3d-people"),
      ]);
      if (stopped) return;
      let renderer: Three.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
      catch { fallback.current(); return; }
      renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.domElement.style.display = "block";
      element.appendChild(renderer.domElement);
      cleanups.push(() => { renderer.dispose(); renderer.domElement.remove(); });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 2, 16000);
      camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(TARGET.x, TARGET.y, TARGET.z);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 220; controls.maxDistance = 2600; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.15;
      controls.autoRotateSpeed = 0.5;
      // The wheel keeps scrolling the page; Ctrl + wheel zooms the office (and not the browser).
      controls.enableZoom = false;
      controls.saveState();
      cleanups.push(() => controls.dispose());

      const hemi = new THREE.HemisphereLight(0xa8c4ff, 0x1a1530, 0.6);
      const sun = new THREE.DirectionalLight(0xbfd2ff, 0.8);
      sun.position.set(-500, 900, 600); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -750, right: 750, top: 650, bottom: -650, near: 100, far: 2500 });
      sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
      const fill = new THREE.DirectionalLight(0x22d3ee, 0.25); fill.position.set(700, 300, -600);
      scene.add(hemi, sun, fill);

      const kit = await worldModule.loadKit(THREE, (done, total) => { if (!stopped) setProgress(`Đang tải mô hình 3D… ${Math.round((done / total) * 100)}%`); });
      if (stopped) return;
      const world = worldModule.buildWorld(THREE, scene, kit, sun, hemi);
      const people = peopleModule.createPeople(THREE, scene, kit, world, (object) => SkeletonUtils.clone(object));
      const started = performance.now();
      const engine: Engine = { camera, controls, world, people, started };
      engineRef.current = engine;
      world.update(dataRef.current);
      people.sync(dataRef.current.team, 0);
      setProgress(null);
      cleanups.push(() => { people.dispose(); engineRef.current = null; scene.traverse((child) => { const mesh = child as Three.Mesh; mesh.geometry?.dispose?.(); const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; for (const material of list) { (material as Three.MeshStandardMaterial).map?.dispose(); material.dispose(); } }); });

      const resize = () => {
        const width = element.clientWidth, height = element.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        renderer.domElement.style.width = `${width}px`; renderer.domElement.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      const seen = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
      seen.observe(element);
      cleanups.push(() => { observer.disconnect(); seen.disconnect(); });

      // Hover / click on rooms, people, Soda and the robot.
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let down: { x: number; y: number } | null = null;
      let current: RoomKey | null = null, shown = false;
      const pickAt = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const heads = raycaster.intersectObjects(people.pickables(), false);
        const hits = heads.length ? heads : raycaster.intersectObjects(world.pickables, false);
        const hit = hits.find((item) => item.object.userData.pick);
        return hit ? { pick: hit.object.userData.pick as Pick, room: (hit.object.userData.room as RoomKey | undefined) ?? null, rect } : null;
      };
      const onMove = (event: PointerEvent) => {
        if (down) return;
        const found = pickAt(event);
        if (!found) { if (shown || current) { shown = false; current = null; world.highlight(null); setHover(null); renderer.domElement.style.cursor = ""; } return; }
        if (current !== found.room) { current = found.room; world.highlight(found.room); }
        shown = true;
        renderer.domElement.style.cursor = found.pick.href ? "pointer" : "default";
        setHover({ x: event.clientX - found.rect.left, y: event.clientY - found.rect.top, title: found.pick.title, sub: found.pick.sub });
      };
      const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; setHover(null); };
      const onUp = (event: PointerEvent) => {
        const start = down; down = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || event.button !== 0) return;
        const found = pickAt(event);
        if (found?.pick.href) navigate.current(found.pick.href);
      };
      const onLeave = () => { current = null; shown = false; world.highlight(null); setHover(null); };
      const canvas = renderer.domElement;
      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(Math.exp(event.deltaY * 0.0015));
        camera.position.copy(controls.target).add(offset.setLength(Math.min(2600, Math.max(220, offset.length()))));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => canvas.removeEventListener("wheel", onWheel));
      canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", onLeave);
      cleanups.push(() => { canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave); });

      let previous = performance.now();
      const loop = () => {
        frame = requestAnimationFrame(loop);
        const nowMs = performance.now();
        const delta = Math.min(0.1, (nowMs - previous) / 1000);
        previous = nowMs;
        if (!visible || document.visibilityState !== "visible") return;
        const time = (nowMs - started) / 1000;
        world.tick(time, camera);
        world.robot?.mixer?.update(delta);
        people.tick(time, delta);
        controls.update();
        renderer.render(scene, camera);
      };
      loop();
      cleanups.push(() => cancelAnimationFrame(frame));
    })().catch(() => { if (!stopped) fallback.current(); });
    return () => { stopped = true; for (const cleanup of cleanups.reverse()) cleanup(); };
  }, []);

  const zoom = (factor: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const { camera, controls } = engine;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    camera.position.copy(controls.target).add(offset.setLength(Math.min(2600, Math.max(220, offset.length()))));
  };
  const toggleSpin = () => setSpinning((value) => { if (engineRef.current) engineRef.current.controls.autoRotate = !value; return !value; });
  const reset = () => { const engine = engineRef.current; if (!engine) return; engine.controls.autoRotate = false; setSpinning(false); engine.controls.reset(); };

  return (
    <div className={styles.scene3dWrap}>
      <div className={styles.mapTools3d}>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Phóng to">+</button>
        <button type="button" onClick={() => zoom(1.25)} aria-label="Thu nhỏ">−</button>
        <button type="button" onClick={toggleSpin} aria-pressed={spinning} aria-label="Tự xoay" className={spinning ? styles.toolOn : undefined}>⟳</button>
        <button type="button" onClick={reset} aria-label="Về góc nhìn ban đầu">⌂</button>
      </div>
      <div ref={holder} className={styles.scene3d} />
      {progress ? <div className={styles.scene3dLoading}>{progress}</div> : null}
      {hover ? <div className={styles.tooltip3d} style={{ left: hover.x + 14, top: hover.y + 14 }}><strong>{hover.title}</strong><span>{hover.sub}</span></div> : null}
      <p className={styles.hint3d}>Kéo chuột trái để xoay · Ctrl + lăn chuột (hoặc nút +/−) để phóng to · kéo chuột phải để di chuyển · bấm vào phòng để mở · mô hình: Kenney &amp; Quaternius (CC0)</p>
    </div>
  );
}

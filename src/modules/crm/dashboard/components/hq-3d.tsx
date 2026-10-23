"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import type { HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import type { HqSelection } from "@/modules/crm/dashboard/components/hq-map";
import styles from "@/modules/crm/dashboard/components/hq.module.css";
import type { People } from "@/modules/crm/dashboard/components/hq-3d-people";
import type { Kit, World } from "@/modules/crm/dashboard/components/hq-3d-world";
import type { HqLayout } from "@/modules/crm/dashboard/core/hq-layout";
import type { Effects } from "@/modules/crm/dashboard/components/hq-3d-effects";

// HireX HQ, mức 3: the office in real 3D — a high floor of a tower over a lit city, with furniture and people from
// CC0 model kits (public/hq3d). Three.js and the models load only when this view opens. The plan comes from the team
// (core/hq-layout.ts): when someone joins or a bộ phận is added, the floor is built again with the new desk or room.
// Drag to turn, scroll to zoom, right-drag to move; hover shows who / what, a click opens the room's screen.
// The building is built once; each data refresh (every minute) only updates numbers, screens and people.

type Props = { rooms: HqRoom[]; team: HqMember[]; stats: HqStats; floor: HqFloor; layout: HqLayout; level: number; selected: HqSelection; onSelect: (selection: HqSelection) => void; onUnsupported: () => void };
type Hover = { x: number; y: number; title: string; sub: string } | null;
type Pick = { title: string; sub: string; href: string | null; personId?: string };
type LogLine = { id: number; at: string; text: string; tone: "alert" | "ok" | "info" };
type Data = Omit<Props, "selected" | "onSelect" | "onUnsupported">;
type Builders = { world: typeof import("@/modules/crm/dashboard/components/hq-3d-world"); people: typeof import("@/modules/crm/dashboard/components/hq-3d-people"); clone: (object: Three.Object3D) => Three.Object3D };

interface Engine {
  camera: Three.PerspectiveCamera;
  controls: { update: () => void; dispose: () => void; autoRotate: boolean; target: Three.Vector3; reset: () => void; saveState: () => void; maxDistance: number };
  world: World; people: People; effects: Effects; started: number;
  /** Build (or build again) the floor on screen for this plan; the models stay loaded. */
  build: (layout: HqLayout, level: number) => void; built: string;
  /** Camera flight (click on a person) and the member it follows. */
  flight: { from: Three.Vector3; to: Three.Vector3; fromTarget: Three.Vector3; toTarget: Three.Vector3; start: number; follow: string | null } | null;
  home: { camera: Three.Vector3; target: Three.Vector3 } | null;
  fly: (to: { x: number; y: number; z: number } | null, follow: string | null, far?: number) => void;
}

const clock = () => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const spread = () => 1 + Math.random() * 35; // play a minute's events over the next ~35 seconds

/** Compares two refreshes and plays what changed (see hq-3d-effects.ts). Returns lines for the event log. */
function playChanges(engine: Engine, before: Data, after: Data): Array<Omit<LogLine, "id">> {
  const lines: Array<Omit<LogLine, "id">> = [];
  const was = new Map(before.team.map((person) => [person.id, person.waiting]));
  let envelopes = 0, ticks = 0;
  for (const person of after.team) {
    const previous = was.get(person.id);
    if (previous === undefined) {
      engine.effects.welcome(() => engine.people.positionOf(person.id), person.name, spread());
      lines.push({ at: clock(), text: `Chào mừng ${person.name} vào ${person.department ?? "công ty"}`, tone: "info" });
      continue;
    }
    const change = person.waiting - previous;
    const at = () => engine.people.positionOf(person.id);
    if (change > 0) {
      for (let index = 0; index < Math.min(change, 3) && envelopes < 14; index += 1, envelopes += 1) engine.effects.envelope(at, spread());
      lines.push({ at: clock(), text: `+${change} tin chưa trả lời · ${person.name}`, tone: "alert" });
    } else if (change < 0) {
      for (let index = 0; index < Math.min(-change, 2) && ticks < 10; index += 1, ticks += 1) engine.effects.reply(at, spread());
      lines.push({ at: clock(), text: `${person.name} đã trả lời ${-change} hội thoại`, tone: "ok" });
    }
  }
  const cvs = (after.stats.cvToday ?? 0) - (before.stats.cvToday ?? 0);
  if (cvs > 0 && before.stats.cvToday !== null) { for (let index = 0; index < Math.min(cvs, 5); index += 1) engine.effects.cv(spread()); lines.push({ at: clock(), text: `+${cvs} CV mới vào Kho CV`, tone: "info" }); }
  const replies = (after.stats.replies ?? 0) - (before.stats.replies ?? 0);
  if (replies > 0 && before.stats.replies !== null) { for (let index = 0; index < Math.min(replies, 4); index += 1) engine.effects.firework(spread()); lines.push({ at: clock(), text: `+${replies} phản hồi chiến dịch Zalo`, tone: "info" }); }
  return lines;
}

// Camera at home, for a floor of the old size (z −490…490); bigger floors move it back proportionally.
const CAMERA_OFFSET = { x: -640, y: 860, z: 1030 };

export function HqScene3D({ rooms, team, stats, floor, layout, level, selected, onSelect, onUnsupported }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const dataRef = useRef<Data>({ rooms, team, stats, floor, layout, level });
  const [hover, setHover] = useState<Hover>(null);
  const [spinning, setSpinning] = useState(false);
  const [progress, setProgress] = useState<string | null>("Đang tải văn phòng 3D…");
  const [log, setLog] = useState<LogLine[]>([]);
  const logId = useRef(0);
  const fallback = useRef(onUnsupported);
  const select = useRef(onSelect);
  const [ready, setReady] = useState(false);
  useEffect(() => { fallback.current = onUnsupported; select.current = onSelect; });

  useEffect(() => {
    const before = dataRef.current;
    dataRef.current = { rooms, team, stats, floor, layout, level };
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.built !== `${layout.key}#${level}`) engine.build(layout, level);
    engine.world.update(dataRef.current);
    engine.people.sync(team, (performance.now() - engine.started) / 1000);
    const lines = playChanges(engine, before, dataRef.current);
    if (lines.length) setLog((current) => [...lines.map((line) => ({ ...line, id: ++logId.current })), ...current].slice(0, 5));
  }, [rooms, team, stats, floor, layout, level]);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let stopped = false, frame = 0, visible = true;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const [THREE, { OrbitControls }, SkeletonUtils, worldModule, peopleModule, effectsModule] = await Promise.all([
        import("three"), import("three/examples/jsm/controls/OrbitControls.js"), import("three/examples/jsm/utils/SkeletonUtils.js"),
        import("@/modules/crm/dashboard/components/hq-3d-world"), import("@/modules/crm/dashboard/components/hq-3d-people"),
        import("@/modules/crm/dashboard/components/hq-3d-effects"),
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
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 220; controls.maxDistance = 2600; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.15;
      controls.autoRotateSpeed = 0.5;
      // The wheel keeps scrolling the page; Ctrl + wheel zooms the office (and not the browser).
      controls.enableZoom = false;
      cleanups.push(() => controls.dispose());

      const hemi = new THREE.HemisphereLight(0xa8c4ff, 0x1a1530, 0.6);
      const sun = new THREE.DirectionalLight(0xbfd2ff, 0.8);
      sun.position.set(-500, 900, 600); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -750, right: 750, top: 650, bottom: -650, near: 100, far: 2500 });
      sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
      const fill = new THREE.DirectionalLight(0x22d3ee, 0.25); fill.position.set(700, 300, -600);
      scene.add(hemi, sun, fill);

      scene.add(sun.target);
      const kit: Kit = await worldModule.loadKit(THREE, (done, total) => { if (!stopped) setProgress(`Đang tải mô hình 3D… ${Math.round((done / total) * 100)}%`); });
      if (stopped) return;
      const builders: Builders = { world: worldModule, people: peopleModule, clone: (object) => SkeletonUtils.clone(object) };
      const effects = effectsModule.createEffects(THREE, scene);
      const started = performance.now();
      const welcomed = new Set<string>();
      const engine: Engine = {
        camera, controls, world: null as unknown as World, people: null as unknown as People, effects, started, flight: null, home: null, built: "",
        build: (plan, floorLevel) => {
          engine.people?.dispose(); engine.world?.dispose();
          const level = Math.min(floorLevel, plan.floors.length - 1);
          const world = builders.world.buildWorld(THREE, scene, kit, sun, hemi, plan, level);
          engine.world = world;
          engine.people = builders.people.createPeople(THREE, scene, kit, world, plan, builders.clone);
          engine.built = `${plan.key}#${floorLevel}`;
          engine.flight = null; engine.home = null;
          // Light, shadows and the home view follow the size of this floor.
          const plate = world.plate, centreZ = (plate.z0 + plate.z1) / 2, size = Math.max(1, (plate.z1 - plate.z0) / 980);
          sun.target.position.set(0, 0, centreZ); sun.position.set(-500, 900, centreZ + 600);
          const half = Math.max(plate.x1 - plate.x0, plate.z1 - plate.z0) / 2 + 120;
          Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 2500 + half });
          sun.shadow.camera.updateProjectionMatrix();
          controls.target.set(0, 0, centreZ + 30);
          camera.position.set(CAMERA_OFFSET.x * size, CAMERA_OFFSET.y * size, centreZ + CAMERA_OFFSET.z * size);
          controls.maxDistance = 2600 * size;
          controls.update(); controls.saveState();
          const data = dataRef.current;
          world.update(data);
          engine.people.sync(data.team, (performance.now() - started) / 1000);
          // New members (joined in the last days) get a welcome the first time their floor is shown.
          data.team.filter((person) => person.isNew && !welcomed.has(person.id) && engine.people.positionOf(person.id)).forEach((person, index) => {
            welcomed.add(person.id);
            effects.welcome(() => engine.people.positionOf(person.id), person.name, 2 + index * 2.5);
          });
        },
        fly: (to, follow, far = 1) => {
          const fromTarget = controls.target.clone(), from = camera.position.clone();
          if (to) {
            if (!engine.home) engine.home = { camera: from.clone(), target: fromTarget.clone() };
            const toTarget = new THREE.Vector3(to.x, 30, to.z);
            engine.flight = { from, to: toTarget.clone().add(new THREE.Vector3(-150, 190, 230).multiplyScalar(far)), fromTarget, toTarget, start: performance.now(), follow };
          } else if (engine.home) {
            engine.flight = { from, to: engine.home.camera.clone(), fromTarget, toTarget: engine.home.target.clone(), start: performance.now(), follow: null };
            engine.home = null;
          }
        },
      };
      engineRef.current = engine;
      engine.build(dataRef.current.layout, dataRef.current.level);
      setProgress(null);
      setReady(true);
      cleanups.push(() => { effects.dispose(); engine.people.dispose(); engine.world.dispose(); engineRef.current = null; scene.traverse((child) => { const mesh = child as Three.Mesh; mesh.geometry?.dispose?.(); const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; for (const material of list) { (material as Three.MeshStandardMaterial).map?.dispose(); material.dispose(); } }); });

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
      const projected = new THREE.Vector3();
      let down: { x: number; y: number } | null = null;
      let current: string | null = null, shown = false;
      const pickAt = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        // People are small on screen: take the nearest head within 28 px instead of an exact hit.
        const mouseX = event.clientX - rect.left, mouseY = event.clientY - rect.top;
        let nearest: Three.Object3D | null = null, nearestDistance = 28;
        for (const head of engine.people.pickables()) {
          head.getWorldPosition(projected).project(camera);
          if (projected.z > 1) continue;
          const distance = Math.hypot(((projected.x + 1) / 2) * rect.width - mouseX, ((1 - projected.y) / 2) * rect.height - mouseY);
          if (distance < nearestDistance) { nearestDistance = distance; nearest = head; }
        }
        if (nearest) return { pick: nearest.userData.pick as Pick, room: null, rect };
        const hits = raycaster.intersectObjects(engine.world.pickables, false);
        const hit = hits.find((item) => item.object.userData.pick);
        return hit ? { pick: hit.object.userData.pick as Pick, room: (hit.object.userData.room as string | undefined) ?? null, rect } : null;
      };
      const onMove = (event: PointerEvent) => {
        if (down) return;
        const found = pickAt(event);
        if (!found) { if (shown || current) { shown = false; current = null; engine.world.highlight(null); setHover(null); renderer.domElement.style.cursor = ""; } return; }
        if (current !== found.room) { current = found.room; engine.world.highlight(found.room); }
        shown = true;
        renderer.domElement.style.cursor = found.pick.personId || found.room ? "pointer" : "default";
        setHover({ x: event.clientX - found.rect.left, y: event.clientY - found.rect.top, title: found.pick.title, sub: found.pick.sub });
      };
      const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; setHover(null); };
      const onUp = (event: PointerEvent) => {
        const start = down; down = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || event.button !== 0) return;
        const found = pickAt(event);
        if (found?.pick.personId) { setHover(null); select.current({ type: "person", id: found.pick.personId }); return; }
        if (found?.room) { setHover(null); select.current({ type: "room", key: found.room }); }
      };
      const onLeave = () => { current = null; shown = false; engine.world.highlight(null); setHover(null); };
      const canvas = renderer.domElement;
      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(Math.exp(event.deltaY * 0.0015));
        const limit = 2600 * Math.max(1, (engine.world.plate.z1 - engine.world.plate.z0) / 980);
        camera.position.copy(controls.target).add(offset.setLength(Math.min(limit, Math.max(220, offset.length()))));
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
        engine.world.tick(time, camera);
        engine.world.robot?.mixer?.update(delta);
        engine.people.tick(time, delta);
        effects.tick(time, delta);
        const flight = engine.flight;
        if (flight) {
          const t = Math.min(1, (nowMs - flight.start) / 1100), ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          if (flight.follow) { const spot = engine.people.positionOf(flight.follow); if (spot) { const moved = new THREE.Vector3(spot.x, 30, spot.z).sub(flight.toTarget); flight.toTarget.add(moved); flight.to.add(moved); } }
          camera.position.lerpVectors(flight.from, flight.to, ease);
          controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
          if (t >= 1) {
            if (flight.follow) { flight.from.copy(flight.to); flight.fromTarget.copy(flight.toTarget); flight.start = nowMs - 1100; } // keep following a walking member
            else engine.flight = null;
          }
        }
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
    camera.position.copy(controls.target).add(offset.setLength(Math.min(engine.controls.maxDistance, Math.max(220, offset.length()))));
  };
  const toggleSpin = () => setSpinning((value) => { if (engineRef.current) engineRef.current.controls.autoRotate = !value; return !value; });
  const reset = () => { const engine = engineRef.current; if (!engine) return; engine.controls.autoRotate = false; setSpinning(false); engine.flight = null; engine.home = null; select.current(null); engine.controls.reset(); };

  // The camera follows what is picked: a member (and keeps following if they walk), a room, or back home.
  const selectionKey = selected ? (selected.type === "person" ? `p:${selected.id}` : `r:${selected.key}`) : "";
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    if (!selectionKey) { engine.fly(null, null); return; }
    if (selectionKey.startsWith("p:")) { const id = selectionKey.slice(2); engine.fly(engine.people.positionOf(id), id, 1.4); return; }
    const spot = engine.world.centreOf(selectionKey.slice(2));
    if (spot) engine.fly({ x: spot.x, y: 0, z: spot.z }, null, Math.max(2.2, spot.span / 170));
  }, [selectionKey, ready]);

  return (
    <div className={styles.scene3dWrap}>
      <div className={styles.stageTools}>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Phóng to">+</button>
        <button type="button" onClick={() => zoom(1.25)} aria-label="Thu nhỏ">−</button>
        <button type="button" onClick={toggleSpin} aria-pressed={spinning} aria-label="Tự xoay" className={spinning ? styles.toolOn : undefined}>⟳</button>
        <button type="button" onClick={reset} aria-label="Về góc nhìn ban đầu">⌂</button>
        <button type="button" aria-label="Cách dùng" title="Kéo chuột trái: xoay · Ctrl + lăn chuột hoặc +/−: phóng to · chuột phải: di chuyển · bấm phòng hoặc người để xem tóm tắt · Esc: đóng">?</button>
      </div>
      <div ref={holder} className={styles.scene3d} />
      {progress ? <div className={styles.scene3dLoading}>{progress}</div> : null}
      {log.length ? (
        <ul className={styles.log3d} aria-label="Vừa xảy ra">
          {log.map((line) => <li key={line.id} className={styles[`log3d_${line.tone}`]}><span>{line.at}</span>{line.text}</li>)}
        </ul>
      ) : null}
      {hover ? <div className={styles.tooltip3d} style={{ left: hover.x + 14, top: hover.y + 14 }}><strong>{hover.title}</strong><span>{hover.sub}</span></div> : null}
      <p className={styles.hint3d}>Kéo chuột trái: xoay · Ctrl + lăn chuột hoặc +/−: phóng to · chuột phải: di chuyển · bấm phòng / người để xem tóm tắt · mô hình: Kenney &amp; Quaternius (CC0)</p>
    </div>
  );
}

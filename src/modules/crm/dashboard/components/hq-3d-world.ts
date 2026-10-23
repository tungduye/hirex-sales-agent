import type * as Three from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HqFeedItem, HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import { addSeason } from "@/modules/crm/dashboard/components/hq-3d-season";
import { COFFEE, FIRST_CORRIDOR, NORTH_STRIP, seasonOf, type HqLayout, type LayoutRoom } from "@/modules/crm/dashboard/core/hq-layout";
import {
  carpetTexture, concreteTexture, floorText, FONT, glow, label, marbleTexture, screen, seeded, skyTexture, techTexture, windowsTexture, woodTexture, type T,
} from "@/modules/crm/dashboard/components/hq-3d-draw";

// The building of HireX HQ mức 3: a floor of an office tower at night (or day, by Vietnam time), rooms with glass
// walls, real furniture (Kenney Furniture Kit, CC0) and a lit city around it. The plan comes from the people in it
// (core/hq-layout.ts): one room per bộ phận, desks in pods of four, more floors when it gets crowded. One floor is
// built at a time; update() only changes numbers, screens, highlights and effects.

export const S = 72; // model units → world units
export type P = { x: number; z: number };
export { COFFEE, CONNECTOR_X } from "@/modules/crm/dashboard/core/hq-layout";
export const CORRIDOR_A = FIRST_CORRIDOR;
type Box = { x0: number; z0: number; x1: number; z1: number };
const TONE = { cyan: 0x22d3ee, red: 0xfb7185, violet: 0x818cf8, green: 0x34d399 } as const;
const MARKET_TINT: Record<string, number> = { IT: 0x0891b2, IT_JP: 0xdb2777, OTHER: 0x64748b };
const PEOPLE_ROOMS = new Set(["dept", "boss", "common"]);

/** A seat: where the person sits, which way they face, and the walk from the chair out to the corridor. */
/** facing = rotation.y of a character (the models look along +z, so Math.PI = facing north, to the screens). */
export interface Slot { key: string; room: string; sit: P; facing: number; toCorridor: P[]; corridorZ: number; screenGlow: Three.Mesh | null }

export const FURNITURE = ["desk", "chairDesk", "computerScreen", "computerKeyboard", "computerMouse", "laptop", "tableRound", "chairModernCushion", "loungeDesignSofa", "loungeSofa",
  "tableCoffeeGlass", "rugRectangle", "rugRound", "pottedPlant", "plantSmall1", "plantSmall2", "lampSquareFloor", "kitchenBar", "kitchenBarEnd", "kitchenCoffeeMachine",
  "kitchenFridgeLarge", "stoolBar", "bookcaseClosedWide", "bookcaseOpen", "cardboardBoxClosed", "cardboardBoxOpen", "speaker", "televisionModern", "coatRackStanding", "trashcan", "bench"] as const;
export const CHARACTERS = ["male-a", "male-b", "male-c", "male-d", "female-a", "female-b", "female-c", "female-d"] as const;

export interface Kit { furniture: Map<string, Three.Object3D>; characters: Map<string, GLTF>; robot: GLTF | null }

/** Loads every model once (≈3 MB, cached by the browser afterwards). Missing files fall back to simple shapes. */
export async function loadKit(THREE: T, onProgress: (done: number, total: number) => void): Promise<Kit> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const furniture = new Map<string, Three.Object3D>();
  const characters = new Map<string, GLTF>();
  let robot: GLTF | null = null;
  const jobs: Array<() => Promise<void>> = [
    ...FURNITURE.map((name) => async () => {
      const gltf = await loader.loadAsync(`/hq3d/furniture/${name}.glb`);
      furniture.set(name, normalise(THREE, gltf.scene));
    }),
    ...CHARACTERS.map((name) => async () => {
      const gltf = await loader.loadAsync(`/hq3d/characters/character-${name}.glb`);
      gltf.scene.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.castShadow = true; child.frustumCulled = false; } });
      characters.set(name, gltf);
    }),
    async () => {
      robot = await loader.loadAsync("/hq3d/characters/robot.glb");
      robot.scene.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.castShadow = true; child.userData.kit = true; } });
    },
  ];
  let done = 0;
  await Promise.all(jobs.map((job) => job().catch(() => undefined).finally(() => onProgress(++done, jobs.length))));
  return { furniture, characters, robot };
}

/** Centre a model on x/z, stand it on y=0, cast/receive shadows. */
function normalise(THREE: T, object: Three.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const centre = box.getCenter(new THREE.Vector3());
  object.position.set(-centre.x, -box.min.y, -centre.z);
  object.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true; child.userData.kit = true; } });
  const wrapper = new THREE.Group();
  wrapper.add(object);
  return wrapper;
}

export interface World {
  level: number;
  slots: Map<string, Slot>; meetingSeats: Slot[];
  pickables: Three.Object3D[]; rails: Map<string, Three.Mesh[]>; floors: Map<string, Three.Mesh>;
  plate: Box;
  update: (data: { rooms: HqRoom[]; stats: HqStats; floor: HqFloor; feed: HqFeedItem[]; team: HqMember[] }) => void;
  tick: (time: number, camera: Three.Camera) => void;
  highlight: (room: string | null) => void;
  /** Centre and size of a room on this floor (for the camera). */
  centreOf: (key: string) => { x: number; z: number; span: number } | null;
  robot: { root: Three.Object3D; mixer: Three.AnimationMixer | null; play: (name: string) => void } | null;
  dispose: () => void;
}

/** One floor of the office (level 0 = Tầng 1 with the lobby, Soda, Trạm tin nhắn, Tháp, Kho CV, Phòng họp, AI). */
export function buildWorld(THREE: T, scene: Three.Scene, kit: Kit, sun: Three.DirectionalLight, hemi: Three.HemisphereLight, layout: HqLayout, level: number): World {
  const floorPlan = layout.floors[Math.min(level, layout.floors.length - 1)];
  const PLATE: Box = floorPlan.plate;
  const ground0 = level === 0;
  const root = new THREE.Group();
  scene.add(root);
  const tickers: Array<(time: number, camera: Three.Camera) => void> = [];
  const pickables: Three.Object3D[] = [];

  const place = (name: string, x: number, z: number, options: { rot?: number; scale?: number; y?: number; parent?: Three.Object3D } = {}) => {
    const source = kit.furniture.get(name);
    let object: Three.Object3D;
    if (source) object = source.clone(true);
    else { object = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x334155 })); object.position.y = 0.2; const wrap = new THREE.Group(); wrap.add(object); object = wrap; }
    object.scale.setScalar(S * (options.scale ?? 1));
    object.position.set(x, options.y ?? 0, z);
    object.rotation.y = options.rot ?? 0;
    (options.parent ?? root).add(object);
    return object;
  };

  // ---- The tower floor ----
  const plateWidth = PLATE.x1 - PLATE.x0, plateDepth = PLATE.z1 - PLATE.z0, plateX = (PLATE.x0 + PLATE.x1) / 2, plateZ = (PLATE.z0 + PLATE.z1) / 2;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(plateWidth, 14, plateDepth), new THREE.MeshStandardMaterial({ map: concreteTexture(THREE, [plateWidth / 220, plateDepth / 220]), roughness: 0.35, metalness: 0.15 }));
  slab.position.set(plateX, -7, plateZ); slab.receiveShadow = true;
  const slabEdge = new THREE.Mesh(new THREE.BoxGeometry(plateWidth + 4, 3, plateDepth + 4), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }));
  slabEdge.position.set(plateX, -13, plateZ);
  const under = new THREE.Mesh(new THREE.BoxGeometry(plateWidth - 40, 60, plateDepth - 40), new THREE.MeshStandardMaterial({ color: 0x0a0f1e, roughness: 0.9 }));
  under.position.set(plateX, -45, plateZ);
  root.add(slab, slabEdge, under);

  // Façade: floor-to-ceiling glass with mullions; the sides facing the camera hide so the office stays visible.
  const facadeHeight = 150;
  const facades: Array<{ group: Three.Group; normal: P; centre: P }> = [];
  const side = (from: P, to: P, normal: P) => {
    const group = new THREE.Group();
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const angle = Math.atan2(to.z - from.z, to.x - from.x);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(length, facadeHeight), new THREE.MeshPhysicalMaterial({ color: 0x9fc5ff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    glass.position.y = facadeHeight / 2;
    group.add(glass);
    const mullion = new THREE.BoxGeometry(4, facadeHeight, 6), mullionMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.8 });
    for (let at = 0; at <= length; at += 90) { const post = new THREE.Mesh(mullion, mullionMaterial); post.position.set(at - length / 2, facadeHeight / 2, 0); post.userData.sharedGeometry = true; post.userData.sharedMaterial = true; group.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(length, 4, 8), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 }));
    beam.position.y = facadeHeight; group.add(beam);
    group.position.set((from.x + to.x) / 2, 0, (from.z + to.z) / 2);
    group.rotation.y = -angle;
    root.add(group);
    facades.push({ group, normal, centre: { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 } });
  };
  side({ x: PLATE.x0, z: PLATE.z0 }, { x: PLATE.x1, z: PLATE.z0 }, { x: 0, z: -1 });
  side({ x: PLATE.x1, z: PLATE.z0 }, { x: PLATE.x1, z: PLATE.z1 }, { x: 1, z: 0 });
  side({ x: PLATE.x1, z: PLATE.z1 }, { x: PLATE.x0, z: PLATE.z1 }, { x: 0, z: 1 });
  side({ x: PLATE.x0, z: PLATE.z1 }, { x: PLATE.x0, z: PLATE.z0 }, { x: -1, z: 0 });
  tickers.push((_time, camera) => {
    for (const facade of facades) facade.group.visible = (camera.position.x - facade.centre.x) * facade.normal.x + (camera.position.z - facade.centre.z) * facade.normal.z < 0;
  });

  // ---- The city below (higher floors look down from a little higher) ----
  const city = new THREE.Group();
  const ground = -1500 - level * 120;
  const random = seeded(2026);
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x05070f, roughness: 1 }));
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = ground;
  city.add(groundMesh);
  const roadMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35 });
  const roads: number[] = [];
  for (let line = -4500; line <= 4500; line += 900) {
    roads.push(line);
    const a = new THREE.Mesh(new THREE.PlaneGeometry(9600, 10), roadMaterial); a.rotation.x = -Math.PI / 2; a.position.set(0, ground + 1, line); a.userData.sharedMaterial = true;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(10, 9600), roadMaterial); b.rotation.x = -Math.PI / 2; b.position.set(line, ground + 1, 0); b.userData.sharedMaterial = true;
    city.add(a, b);
  }
  const towers: Array<{ material: Three.MeshStandardMaterial; seed: number }> = [];
  for (let index = 0; index < 90; index += 1) {
    const angle = random() * Math.PI * 2, distance = 1900 + random() * 5200 + Math.max(0, plateDepth - 980) * 0.6;
    const x = Math.cos(angle) * distance, z = plateZ + Math.sin(angle) * distance;
    const width = 160 + random() * 300, depth = 160 + random() * 300, height = 400 + random() * 1100 + (distance > 3200 ? random() * 1000 : 0);
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const uv = geometry.attributes.uv as Three.BufferAttribute;
    for (let vertex = 0; vertex < uv.count; vertex += 1) uv.setXY(vertex, uv.getX(vertex) * Math.max(1, Math.round(width / 90)), uv.getY(vertex) * Math.max(1, Math.round(height / 220)));
    const seed = 100 + (index % 6);
    const material = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6, metalness: 0.4 });
    const building = new THREE.Mesh(geometry, material);
    building.position.set(x, ground + height / 2, z);
    city.add(building);
    towers.push({ material, seed });
    if (random() < 0.25) { const beacon = glow(THREE, 0xff4d6d, 60, 0.9); beacon.position.set(x, ground + height + 12, z); city.add(beacon); const phase = random() * 6; tickers.push((time) => { beacon.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(time * 1.5 + phase)); }); }
  }
  const cars = Array.from({ length: 70 }, (_, index) => {
    const car = glow(THREE, index % 3 === 0 ? 0xff5a5a : 0xfff1c1, 34, 0.9);
    const road = roads[Math.floor(random() * roads.length)], horizontal = random() < 0.5, speed = (140 + random() * 160) * (random() < 0.5 ? -1 : 1), offset = random() * 9600;
    city.add(car);
    return { car, road, horizontal, speed, offset };
  });
  tickers.push((time) => {
    for (const item of cars) {
      const along = ((item.offset + time * item.speed) % 9600 + 9600) % 9600 - 4800;
      if (item.horizontal) item.car.position.set(along, ground + 6, item.road); else item.car.position.set(item.road, ground + 6, along);
    }
  });
  const stars = new THREE.BufferGeometry();
  stars.setAttribute("position", new THREE.Float32BufferAttribute(Array.from({ length: 900 }, (_, index) => { const r = 7000, a = random() * Math.PI * 2, h = 0.15 + random() * 0.8; return index % 3 === 0 ? Math.cos(a) * r * Math.cos(h) : index % 3 === 1 ? r * Math.sin(h) : Math.sin(a) * r * Math.cos(h); }), 3));
  const starField = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xc7d2fe, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false }));
  city.add(starField);
  root.add(city);
  const windowTextures = new Map<string, Three.Texture>();

  const setNight = (night: boolean) => {
    for (const tower of towers) {
      const key = `${tower.seed}:${night}`;
      let texture = windowTextures.get(key);
      if (!texture) { texture = windowsTexture(THREE, tower.seed, night); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; windowTextures.set(key, texture); }
      tower.material.map = texture; tower.material.emissiveMap = texture; tower.material.emissive.setHex(0xffffff); tower.material.emissiveIntensity = night ? 0.85 : 0.25; tower.material.needsUpdate = true;
    }
    const previous = scene.background as Three.Texture | null;
    scene.background = skyTexture(THREE, night);
    previous?.dispose?.();
    scene.fog = new THREE.Fog(night ? 0x0b1230 : 0x5d86c6, 2400 + Math.max(0, plateDepth - 980), 8000 + Math.max(0, plateDepth - 980));
    sun.intensity = night ? 0.75 : 1.5; sun.color.setHex(night ? 0xbfd2ff : 0xffffff);
    hemi.intensity = night ? 0.55 : 0.9;
    starField.visible = night;
    roadMaterial.opacity = night ? 0.22 : 0.08;
  };
  let night: boolean | null = null;
  const isNight = () => { const hour = (new Date().getUTCHours() + 7) % 24; return hour < 6 || hour >= 18; };

  // ---- Rooms: glass walls, a door on the corridor side, a floor of their own ----
  const floors = new Map<string, Three.Mesh>();
  const rails = new Map<string, Three.Mesh[]>();
  const kindOf = new Map<string, string>();
  const floorTexture = (kind: string, width: number, depth: number) =>
    kind === "wood" ? woodTexture(THREE, [width / 220, depth / 220]) : kind === "carpet" ? carpetTexture(THREE, [width / 120, depth / 120]) : kind === "marble" ? marbleTexture(THREE, [width / 180, depth / 180]) : techTexture(THREE, [width / 70, depth / 70]);
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xbfe7ff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });
  const shell = (key: string, room: Box & { door: number }, doorSide: "N" | "S", floorKind: "wood" | "carpet" | "marble" | "tech", wallHeight: number) => {
    const width = room.x1 - room.x0, depth = room.z1 - room.z0, cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 2, depth), new THREE.MeshStandardMaterial({ map: floorTexture(floorKind, width, depth), roughness: floorKind === "marble" ? 0.25 : floorKind === "wood" ? 0.55 : 0.6, metalness: floorKind === "marble" ? 0.2 : 0.05, transparent: true }));
    floor.position.set(cx, 1, cz); floor.receiveShadow = true;
    floor.userData.room = key;
    floors.set(key, floor); pickables.push(floor); root.add(floor);
    const tops: Three.Mesh[] = [];
    const railMaterial = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const length = Math.hypot(x1 - x0, z1 - z0);
      if (length < 2) return;
      const horizontal = Math.abs(z1 - z0) < 0.5;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 2, wallHeight, horizontal ? 2 : length), glassMaterial);
      panel.position.set((x0 + x1) / 2, 2 + wallHeight / 2, (z0 + z1) / 2); panel.userData.sharedMaterial = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 3, 2.5, horizontal ? 3 : length), railMaterial);
      rail.position.set((x0 + x1) / 2, 2 + wallHeight, (z0 + z1) / 2); rail.userData.sharedMaterial = true;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 3, 3, horizontal ? 3 : length), frameMaterial);
      frame.position.set((x0 + x1) / 2, 3.5, (z0 + z1) / 2); frame.userData.sharedMaterial = true;
      root.add(panel, rail, frame); tops.push(rail);
    };
    const gap = 30;
    const withDoor = (z: number) => { wall(room.x0, z, room.door - gap, z); wall(room.door + gap, z, room.x1, z); };
    if (doorSide === "N") withDoor(room.z0); else wall(room.x0, room.z0, room.x1, room.z0);
    if (doorSide === "S") withDoor(room.z1); else wall(room.x0, room.z1, room.x1, room.z1);
    wall(room.x0, room.z0, room.x0, room.z1);
    wall(room.x1, room.z0, room.x1, room.z1);
    const postGeometry = new THREE.BoxGeometry(5, wallHeight + 4, 5);
    for (const [x, z] of [[room.x0, room.z0], [room.x1, room.z0], [room.x0, room.z1], [room.x1, room.z1]]) {
      const post = new THREE.Mesh(postGeometry, frameMaterial); post.userData.sharedMaterial = true; post.userData.sharedGeometry = true;
      post.position.set(x, 2 + wallHeight / 2, z); root.add(post);
    }
    rails.set(key, tops);
  };
  const zoneLabel = (text: string, x: number, z: number, color = "rgba(186,230,253,.55)", size = 12) => { const mesh = floorText(THREE, text, color, size); const width = (mesh.geometry as Three.PlaneGeometry).parameters.width; mesh.position.set(x + width / 2, 2.4, z); root.add(mesh); return mesh; };

  // ---- Desks, from the plan ----
  const slots = new Map<string, Slot>();
  const meetingSeats: Slot[] = [];
  const screenGlowGeometry = new THREE.PlaneGeometry(20, 12.5);
  const deskAt = (seat: LayoutRoom["seats"][number], room: LayoutRoom, executive: boolean) => {
    const { x, deskZ } = seat;
    place("desk", x, deskZ, { rot: Math.PI, scale: executive ? 1.25 : 1 });
    if (executive) place("laptop", x, deskZ - 2, { y: 33, rot: Math.PI });
    else { place("computerScreen", x, deskZ - 8, { y: 27, rot: 0 }); place("computerKeyboard", x - 2, deskZ + 7, { y: 27 }); place("computerMouse", x + 14, deskZ + 7, { y: 27 }); }
    place("chairDesk", x, deskZ + 36, { rot: Math.PI });
    const glowPanel = new THREE.Mesh(screenGlowGeometry, new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, toneMapped: false }));
    glowPanel.position.set(x, 27 + 12, deskZ - 7 + 4.2);
    if (!executive) root.add(glowPanel);
    slots.set(seat.key, { key: seat.key, room: room.key, sit: seat.sit, facing: seat.facing, toCorridor: seat.toCorridor, corridorZ: room.corridorZ, screenGlow: executive ? null : glowPanel });
  };

  let meetingTv: ReturnType<typeof screen> | null = null;
  let robotHandle: World["robot"] = null;
  let aiSpot: P | null = null;
  for (const room of floorPlan.rooms) {
    kindOf.set(room.key, room.kind);
    const floorKind = room.kind === "boss" ? "marble" : room.kind === "meeting" || room.kind === "common" ? "carpet" : room.kind === "ai" ? "tech" : "wood";
    shell(room.key, room, "N", floorKind, room.kind === "dept" || room.kind === "common" ? 42 : 54);
    const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
    if (room.kind === "dept" || room.kind === "common") {
      for (const zone of room.zones) {
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(zone.x1 - zone.x0, zone.z1 - zone.z0), new THREE.MeshBasicMaterial({ color: MARKET_TINT[zone.market] ?? 0x64748b, transparent: true, opacity: 0.16, depthWrite: false }));
        rug.rotation.x = -Math.PI / 2; rug.position.set((zone.x0 + zone.x1) / 2, 2.2, (zone.z0 + zone.z1) / 2);
        root.add(rug);
        if (zone.first) zoneLabel(zone.label, zone.x0 + 4, zone.z0 + 10, zone.market === "IT_JP" ? "rgba(251,207,232,.8)" : zone.market === "IT" ? "rgba(165,243,252,.8)" : "rgba(203,213,225,.7)", 10);
      }
      for (const seat of room.seats) deskAt(seat, room, false);
      place("pottedPlant", room.x0 + 16, room.z1 - 16, { scale: 1 }); place("trashcan", room.x1 - 18, room.z1 - 18);
      if (room.seats.length >= 8) place("bookcaseOpen", room.x1 - 14, room.z1 - 90, { rot: -Math.PI / 2 });
    } else if (room.kind === "boss") {
      for (const seat of room.seats) deskAt(seat, room, true);
      place("rugRectangle", cx, room.z1 - 62, { scale: 1.1, y: 2.2 });
      place("loungeDesignSofa", cx - 10, room.z1 - 40, { rot: Math.PI });
      place("tableCoffeeGlass", cx - 10, room.z1 - 85, { scale: 1.1 });
      place("bookcaseClosedWide", room.x0 + 14, cz, { rot: Math.PI / 2 });
      place("pottedPlant", room.x1 - 16, room.z1 - 16, { scale: 1.2 }); place("lampSquareFloor", room.x0 + 18, room.z1 - 18, { scale: 1.2 });
    } else if (room.kind === "meeting") {
      const centre = { x: cx, z: room.z0 + (room.z1 - room.z0) / 2 + 10 };
      place("tableRound", centre.x, centre.z, { scale: 2.1 });
      place("rugRound", centre.x, centre.z, { scale: 3.2, y: 2.2 });
      for (const seat of room.seats) {
        place("chairModernCushion", seat.x, seat.sit.z, { rot: seat.facing + Math.PI });
        meetingSeats.push({ key: seat.key, room: room.key, sit: seat.sit, facing: seat.facing, toCorridor: seat.toCorridor, corridorZ: room.corridorZ, screenGlow: null });
      }
      meetingTv = screen(THREE, 120, 66);
      meetingTv.group.position.set(cx, 64, room.z1 - 4); meetingTv.group.rotation.y = Math.PI;
      root.add(meetingTv.group);
    } else if (room.kind === "ai") {
      aiSpot = { x: cx, z: room.z0 + 150 };
      place("desk", cx, room.z0 + 100, { rot: Math.PI }); place("laptop", cx, room.z0 + 96, { y: 27, rot: Math.PI });
      place("pottedPlant", room.x1 - 16, room.z1 - 16, { scale: 1.1 });
      if (kit.robot) {
        const model = kit.robot.scene;
        // The robot is reused when the floor is built again: measure it at its own size, away from the old floor.
        model.removeFromParent(); model.scale.setScalar(1); model.position.set(0, 0, 0); model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const height = box.max.y - box.min.y || 1;
        model.scale.setScalar(58 / height);
        const holder = new THREE.Group();
        holder.add(model);
        holder.position.set(aiSpot.x, 2, aiSpot.z); holder.rotation.y = Math.PI;
        root.add(holder);
        const mixer = new THREE.AnimationMixer(model);
        const actions = new Map(kit.robot.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
        let current: Three.AnimationAction | null = null;
        const play = (name: string) => {
          const next = actions.get(name);
          if (!next || next === current) return;
          next.reset().fadeIn(0.4).play();
          current?.fadeOut(0.4);
          current = next;
        };
        play("Idle");
        model.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.userData.pick = { title: "AI Recruiter", sub: "Bấm để xem tóm tắt", href: null }; child.userData.room = "ai"; pickables.push(child); } });
        robotHandle = { root: holder, mixer, play };
      }
    }
    const name = floorText(THREE, room.name, "rgba(186,230,253,.85)", 12);
    const nameWidth = (name.geometry as Three.PlaneGeometry).parameters.width;
    name.position.set(room.x0 + 10 + nameWidth / 2, 2.3, room.z1 - 14);
    root.add(name);
  }

  // Free space at the end of a row: a green corner instead of an empty floor.
  const rowEnds = new Map<number, { x1: number; z1: number }>();
  for (const room of floorPlan.rooms) { const end = rowEnds.get(room.z0); if (!end || room.x1 > end.x1) rowEnds.set(room.z0, { x1: room.x1, z1: Math.max(end?.z1 ?? 0, room.z1) }); }
  for (const [z0, end] of rowEnds) {
    const free = 400 - end.x1;
    if (free < 220) continue;
    const x = end.x1 + free / 2 + 8, z = (z0 + end.z1) / 2;
    place("rugRectangle", x, z, { scale: Math.min(1.4, free / 260), y: 0.4 });
    place("bench", x, z - 30, { scale: 1.2 }); place("bench", x, z + 40, { scale: 1.2, rot: Math.PI });
    place("pottedPlant", x - free / 2 + 30, z0 + 24, { scale: 1.2 }); place("pottedPlant", x + free / 2 - 30, end.z1 - 24, { scale: 1.2 });
    place("plantSmall2", x + 60, z + 5, { scale: 1.7 }); place("plantSmall1", x - 60, z + 5, { scale: 1.7 });
  }

  // ---- North strip ----
  const lobbyScreen = screen(THREE, 150, 72);
  let inboxScreen: ReturnType<typeof screen> | null = null, towerScreen: ReturnType<typeof screen> | null = null;
  let inboxActive = false, towerActive = false;
  const inboxCentre = { x: -260, z: -350 }, towerCentre = { x: -55, z: -350 };
  const cvTagAnchor = new THREE.Object3D(); cvTagAnchor.position.set(150, 0, -340); root.add(cvTagAnchor);
  if (ground0) {
    shell("soda", NORTH_STRIP.soda, "S", "marble", 54);
    shell("inbox", NORTH_STRIP.inbox, "S", "tech", 54);
    shell("tower", NORTH_STRIP.tower, "S", "tech", 54);
    shell("cv", NORTH_STRIP.cv, "S", "tech", 54);
    // Lễ tân: reception counter, sofa, plants, the HQ wall screen; Soda floats above the counter.
    place("kitchenBar", -540, -385, { rot: 0, scale: 1.2 }); place("kitchenBar", -510, -385, { rot: 0, scale: 1.2 }); place("kitchenBarEnd", -480, -385, { scale: 1.2 });
    place("loungeDesignSofa", -470, -292, { rot: Math.PI });
    place("rugRectangle", -470, -320, { scale: 0.9, y: 2.2 });
    place("pottedPlant", -585, -425, { scale: 1.2 }); place("plantSmall1", -385, -425, { scale: 1.4 });
    lobbyScreen.group.position.set(-485, 52, -436);
    root.add(lobbyScreen.group);
    const soda = new THREE.Group();
    const sodaCore = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1, roughness: 0.2, metalness: 0.3, flatShading: true }));
    const sodaShell = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1), new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.55 }));
    soda.add(glow(THREE, 0x22d3ee, 80, 0.55), sodaCore, sodaShell);
    const sodaTag = label(THREE, "Soda · Trợ lý", { height: 13 }); sodaTag.position.y = 26;
    soda.add(sodaTag);
    soda.position.set(-510, 72, -385);
    sodaCore.userData.pick = { title: "Soda · Trợ lý HireX", sub: "Bấm để xem tóm tắt", href: null };
    sodaCore.userData.room = "soda";
    pickables.push(sodaCore);
    root.add(soda);
    tickers.push((time) => { soda.position.y = 72 + Math.sin(time * 1.6) * 3; sodaCore.rotation.y = time * 0.8; sodaShell.rotation.y = -time * 0.4; sodaShell.rotation.x = time * 0.3; });

    // Trạm tin nhắn: a red wall screen, a sorting desk, messages flying in.
    inboxScreen = screen(THREE, 140, 70);
    inboxScreen.group.position.set(inboxCentre.x, 52, -436);
    root.add(inboxScreen.group);
    place("desk", inboxCentre.x, -385, { rot: Math.PI }); place("computerScreen", inboxCentre.x - 14, -393, { y: 27 }); place("computerScreen", inboxCentre.x + 14, -393, { y: 27 });
    const pulse = new THREE.Mesh(new THREE.RingGeometry(14, 17, 48), new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    pulse.rotation.x = -Math.PI / 2; pulse.position.set(inboxCentre.x, 2.5, -320);
    const inboxLight = new THREE.PointLight(0xfb7185, 1.2, 260, 1.6); inboxLight.position.set(inboxCentre.x, 60, -340);
    root.add(pulse, inboxLight);
    const dots = Array.from({ length: 10 }, (_, index) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 12), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true }));
      dot.add(glow(THREE, 0x22d3ee, 16, 0.8));
      root.add(dot);
      return { dot, offset: index / 10, from: { x: inboxCentre.x - 120 + (index % 5) * 60, z: CORRIDOR_A + 160 + Math.floor(index / 5) * 120 } };
    });
    tickers.push((time) => {
      pulse.visible = inboxActive; inboxLight.visible = inboxActive;
      const phase = (time % 2) / 2; pulse.scale.setScalar(0.5 + phase * 2.6); (pulse.material as Three.MeshBasicMaterial).opacity = 1 - phase; inboxLight.intensity = 1 + Math.sin(time * 3) * 0.5;
      for (const item of dots) {
        item.dot.visible = inboxActive;
        const t = (time * 0.32 + item.offset) % 1;
        item.dot.position.set(item.from.x + (inboxCentre.x - item.from.x) * t, 26 + Math.sin(t * Math.PI) * 70, item.from.z + (-420 - item.from.z) * t);
        (item.dot.material as Three.MeshBasicMaterial).opacity = t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1;
      }
    });

    // Tháp phát sóng: antenna, speakers, waves.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 4.5, 90, 12), new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 }));
    mast.position.set(towerCentre.x, 47, towerCentre.z); mast.castShadow = true;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 20), new THREE.MeshBasicMaterial({ color: 0xa5b4fc }));
    beacon.position.set(towerCentre.x, 95, towerCentre.z); beacon.add(glow(THREE, 0x818cf8, 60, 0.8));
    root.add(mast, beacon);
    place("speaker", towerCentre.x - 60, -420, { scale: 1.4 }); place("speaker", towerCentre.x + 60, -420, { scale: 1.4 });
    towerScreen = screen(THREE, 120, 60);
    towerScreen.group.position.set(towerCentre.x, 50, -436);
    root.add(towerScreen.group);
    const waves = Array.from({ length: 3 }, (_, index) => {
      const wave = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 48), new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, depthWrite: false }));
      wave.rotation.x = Math.PI / 2; wave.position.set(towerCentre.x, 95, towerCentre.z);
      root.add(wave);
      return { wave, offset: index / 3 };
    });
    tickers.push((time) => { for (const item of waves) { item.wave.visible = towerActive; const t = (time * 0.45 + item.offset) % 1; item.wave.scale.setScalar(0.4 + t * 6); (item.wave.material as Three.MeshBasicMaterial).opacity = 0.9 * (1 - t); } });

    // Kho CV: shelves and boxes.
    place("bookcaseClosedWide", 105, -425, { scale: 1.2 }); place("bookcaseClosedWide", 175, -425, { scale: 1.2 }); place("bookcaseOpen", 232, -380, { rot: -Math.PI / 2, scale: 1.2 });
    place("cardboardBoxClosed", 90, -300, { scale: 1.3 }); place("cardboardBoxOpen", 118, -292, { scale: 1.3, rot: 0.4 }); place("cardboardBoxClosed", 96, -300, { scale: 1.1, y: 22 });
    const NAMES: Record<string, string> = { soda: "Lễ tân · Soda", inbox: "Trạm tin nhắn", tower: "Tháp phát sóng", cv: "Kho CV" };
    for (const [key, room] of Object.entries(NORTH_STRIP)) {
      const mesh = floorText(THREE, NAMES[key], "rgba(186,230,253,.85)", 12);
      const width = (mesh.geometry as Three.PlaneGeometry).parameters.width;
      mesh.position.set(room.x0 + 10 + width / 2, 2.3, room.z1 - 40);
      root.add(mesh);
    }
  } else {
    // Sảnh tầng: lift lobby with a sofa corner and a wall screen naming who works on this floor.
    place("rugRectangle", -420, -330, { scale: 1.5, y: 0.4 });
    place("loungeDesignSofa", -420, -290, { rot: Math.PI }); place("loungeDesignSofa", -540, -340, { rot: Math.PI / 2 });
    place("tableCoffeeGlass", -430, -350, { scale: 1.2 });
    place("pottedPlant", -585, -425, { scale: 1.3 }); place("pottedPlant", -260, -425, { scale: 1.3 }); place("bookcaseOpen", -150, -425, { scale: 1.2 }); place("plantSmall1", -60, -425, { scale: 1.6 });
    lobbyScreen.group.position.set(-420, 52, -436);
    root.add(lobbyScreen.group);
    zoneLabel(`Sảnh ${floorPlan.name.split(" · ")[0].toLowerCase()}`, -600, -275, "rgba(186,230,253,.85)", 14);
  }

  // ---- Pantry (every floor), lounge and green corner along the east side ----
  for (let index = 0; index < 5; index += 1) place(index === 4 ? "kitchenBarEnd" : "kitchenBar", 330 + index * 31, -425, { scale: 1.3 });
  place("kitchenCoffeeMachine", COFFEE.x, -425, { y: 30, scale: 1.4 });
  place("kitchenFridgeLarge", 575, -420, { scale: 1.3 });
  for (let index = 0; index < 3; index += 1) place("stoolBar", 360 + index * 45, -360, { scale: 1.2 });
  place("pottedPlant", 285, -425, { scale: 1.2 });
  zoneLabel("Pantry · Cà phê", 270, -275);
  place("rugRectangle", 560, -40, { scale: 1.3, y: 0.4 });
  place("loungeSofa", 560, -120, { scale: 1.1 }); place("loungeSofa", 560, 40, { scale: 1.1, rot: Math.PI });
  place("tableCoffeeGlass", 560, -40, { scale: 1.2 });
  place("lampSquareFloor", 625, -170, { scale: 1.3 }); place("pottedPlant", 625, 90, { scale: 1.2 });
  zoneLabel("Lounge", 470, 95);
  for (let z = 300; z <= PLATE.z1 - 60; z += 170) { place(z % 340 === 300 ? "pottedPlant" : "bookcaseOpen", 625, z, { scale: 1.2, rot: -Math.PI / 2 }); place("plantSmall2", 520, z + 40, { scale: 1.6 }); }
  if (PLATE.z1 - 60 >= 300) zoneLabel("Góc xanh", 470, 285);
  for (let x = -600; x <= 600; x += 200) place("pottedPlant", x, PLATE.z0 + 18, { scale: 1 });
  // Lift (only when the company has more than one floor).
  if (layout.floors.length > 1) {
    const lift = new THREE.Group();
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.25 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8, 96, 86), frameMaterial); frame.position.set(0, 48, 0);
    const left = new THREE.Mesh(new THREE.BoxGeometry(4, 88, 38), doorMaterial); left.position.set(-5, 46, -19.5);
    const right = new THREE.Mesh(new THREE.BoxGeometry(4, 88, 38), doorMaterial); right.position.set(-5, 46, 19.5);
    const light = glow(THREE, 0x22d3ee, 30, 0.8); light.position.set(-8, 100, 0);
    lift.add(frame, left, right, light);
    const sign = label(THREE, `Thang máy · ${floorPlan.name.split(" · ")[0]}`, { height: 12 }); sign.position.set(-10, 116, 0); lift.add(sign);
    lift.position.set(PLATE.x1 - 12, 0, -170);
    root.add(lift);
  }

  // ---- Lễ tân: the company sign on the counter; a LED strip above the wall screen runs what is happening ----
  const flat = (width: number, height: number, draw: (context: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const element = document.createElement("canvas"); element.width = Math.round(width * 8); element.height = Math.round(height * 8);
    draw(element.getContext("2d")!, element.width, element.height);
    const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false }));
  };
  if (ground0) {
    const sign = flat(76, 18, (context, w, h) => {
      context.fillStyle = "rgba(7,11,22,.92)"; context.fillRect(0, 0, w, h);
      context.shadowColor = "#22D3EE"; context.shadowBlur = 24; context.fillStyle = "#A5F3FC"; context.textBaseline = "middle";
      context.font = `800 ${Math.round(h * 0.5)}px ${FONT}`; context.fillText("INTALENT", w * 0.06, h * 0.42);
      context.shadowBlur = 0; context.fillStyle = "#C7D2FE"; context.font = `600 ${Math.round(h * 0.24)}px ${FONT}`; context.fillText("HireX HQ", w * 0.68, h * 0.46);
    });
    sign.position.set(-510, 21, -368); root.add(sign);
  }
  const tickerCanvas = document.createElement("canvas"); tickerCanvas.width = 4096; tickerCanvas.height = 64;
  const tickerTexture = new THREE.CanvasTexture(tickerCanvas); tickerTexture.colorSpace = THREE.SRGBColorSpace; tickerTexture.wrapS = THREE.RepeatWrapping;
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(220, 13), new THREE.MeshBasicMaterial({ map: tickerTexture, toneMapped: false }));
  tickerTexture.repeat.set(220 / 13 * 64 / 4096, 1);
  ticker.position.set(ground0 ? -485 : -420, 101, -436.5); root.add(ticker);
  const tickerFrame = new THREE.Mesh(new THREE.BoxGeometry(226, 17, 2), frameMaterial); tickerFrame.position.set(ticker.position.x, 101, -438); tickerFrame.userData.sharedMaterial = true; root.add(tickerFrame);
  let tickerText = "";
  const drawTicker = (items: HqFeedItem[]) => {
    const text = (items.length ? items.map((item) => `${item.at} · ${item.kind}: ${item.text}`) : ["Chào mừng đến HireX HQ · Intalent Việt Nam"]).join("   ✦   ") + "   ✦   ";
    if (text === tickerText) return;
    tickerText = text;
    const context = tickerCanvas.getContext("2d")!;
    context.fillStyle = "#05070f"; context.fillRect(0, 0, 4096, 64);
    context.font = `700 40px ${FONT}`; context.textBaseline = "middle";
    const width = Math.max(1, context.measureText(text).width);
    context.fillStyle = "#FBBF24"; // LED look: amber on black
    for (let x = 0; x < 4096; x += width) context.fillText(text, x, 34);
    tickerTexture.needsUpdate = true;
  };
  tickers.push((time) => { tickerTexture.offset.x = (time * 0.02) % 1; });

  // ---- Tường vinh danh (Lounge): who got the most campaign replies; the first one also wears a cup ----
  const honour = screen(THREE, 120, 84);
  honour.group.position.set(PLATE.x1 - 6, 64, 110); honour.group.rotation.y = -Math.PI / 2;
  root.add(honour.group);
  const cup = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.9, roughness: 0.25, emissive: 0x92400e, emissiveIntensity: 0.3 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(9, 5, 14, 20, 1, true), gold); bowl.position.y = 26;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 10, 10), gold); neck.position.y = 14;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 4, 20), gold); base.position.y = 7;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(22, 5, 22), frameMaterial); plinth.position.y = 2.5; plinth.userData.sharedMaterial = true;
  const shine = glow(THREE, 0xfbbf24, 46, 0.4); shine.position.y = 26;
  cup.add(bowl, neck, base, plinth, shine);
  cup.position.set(PLATE.x1 - 28, 0, 200); root.add(cup);
  tickers.push((time) => { cup.rotation.y = time * 0.6; });
  zoneLabel("Vinh danh", PLATE.x1 - 120, 228, "rgba(253,230,138,.85)", 12);

  // ---- The season (Halloween, Noel, Tết) ----
  const seasonTick = addSeason(THREE, root, floorPlan, seasonOf(new Date()));
  if (seasonTick) tickers.push((time) => seasonTick(time));

  // ---- Live labels (rebuilt on each update) ----
  const liveLabels = new THREE.Group();
  root.add(liveLabels);
  let focus: string | null = null;
  const toneOf = new Map<string, number>();
  const dimmed = (key: string) => Boolean(focus && focus !== key && PEOPLE_ROOMS.has(kindOf.get(key) ?? ""));

  const update: World["update"] = ({ rooms, stats, floor, feed, team }) => {
    drawTicker(feed);
    const best = team.filter((person) => person.campaignReplies > 0).sort((a, b) => b.campaignReplies - a.campaignReplies || a.name.localeCompare(b.name, "vi")).slice(0, 4);
    honour.draw("🏆 Vinh danh · phản hồi chiến dịch", best.length ? best.map((person, index) => ({ text: `${index + 1}. ${person.name}`, value: person.campaignReplies.toLocaleString("vi-VN"), color: index === 0 ? "#FDE68A" : undefined })) : [{ text: "Chưa có phản hồi chiến dịch" }], "#FBBF24");
    const nowNight = isNight();
    if (nowNight !== night) { night = nowNight; setNight(nowNight); }
    focus = floor === "ALL" ? null : floor;
    for (const info of rooms) {
      const floorMesh = floors.get(info.key);
      if (!floorMesh) continue;
      floorMesh.userData.pick = { title: info.name, sub: `${info.meta} · bấm để xem tóm tắt`, href: info.href };
      toneOf.set(info.key, TONE[info.tone]);
    }
    for (const [key, floorMesh] of floors) (floorMesh.material as Three.MeshStandardMaterial).opacity = dimmed(key) ? 0.45 : 1;
    highlight(null);
    // Wall screens.
    const n = (value: number | null) => value === null ? "—" : value.toLocaleString("vi-VN");
    if (ground0) lobbyScreen.draw("HireX HQ · hôm nay", [{ text: "Chưa trả lời", value: n(stats.waiting), color: "#FDA4AF" }, { text: "Phản hồi chiến dịch", value: n(stats.replies) }, { text: "CV mới", value: n(stats.cvToday), color: "#67E8F9" }]);
    else lobbyScreen.draw(floorPlan.name.split(" · ")[0], floorPlan.rooms.filter((room) => PEOPLE_ROOMS.has(room.kind)).slice(0, 4).map((room) => ({ text: room.name, value: `${room.members} người` })));
    inboxScreen?.draw("Trạm tin nhắn", [{ text: "Chưa trả lời", value: n(stats.waiting), color: "#FDA4AF" }, { text: "Nhóm tag mình", value: n(stats.tagged) }], "#FB7185");
    towerScreen?.draw("Zalo Mkt", [{ text: "Tin đã gửi", value: n(stats.sent) }, { text: "Phản hồi", value: n(stats.replies), color: "#A5B4FC" }, { text: "Đang chạy", value: n(stats.running) }], "#818CF8");
    meetingTv?.draw("Phòng họp", [{ text: "Lịch hôm nay", value: n(stats.meetingsToday) }], "#818CF8");
    inboxActive = Boolean(stats.waiting); towerActive = Boolean(stats.running);
    // Floating labels.
    while (liveLabels.children.length) { const child = liveLabels.children[0]; liveLabels.remove(child); (child as Three.Sprite).material?.map?.dispose(); (child as Three.Sprite).material?.dispose(); }
    const add = (sprite: Three.Sprite, x: number, y: number, z: number) => { sprite.position.set(x, y, z); liveLabels.add(sprite); };
    if (ground0) {
      add(label(THREE, "Chưa trả lời", { height: 15, bold: n(stats.waiting), boldColor: "#FDA4AF", border: "rgba(244,63,94,.8)" }), inboxCentre.x, 118, -330);
      add(label(THREE, `Zalo Mkt · ${n(stats.sent)} tin · ${n(stats.replies)} phản hồi`, { height: 13 }), towerCentre.x, 128, towerCentre.z);
      add(label(THREE, "CV mới hôm nay", { height: 14, bold: n(stats.cvToday) }), cvTagAnchor.position.x, 80, cvTagAnchor.position.z);
    }
    const spot = aiSpot as P | null;
    if (spot) {
      if (stats.aiActive) add(label(THREE, `Đang tư vấn ${stats.aiActive} UV`, { height: 12, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" }), spot.x, 82, spot.z);
      add(label(THREE, "AI Recruiter", { height: 12 }), spot.x, 70, spot.z);
    }
    robotHandle?.play(stats.aiActive ? "Yes" : "Idle");
  };

  const highlight: World["highlight"] = (room) => {
    for (const [key, list] of rails) {
      const color = key === room ? 0xa5f3fc : toneOf.get(key) ?? 0x22d3ee;
      const dim = dimmed(key);
      for (const rail of list) { const material = rail.material as Three.MeshBasicMaterial; material.color.setHex(color); material.opacity = dim ? 0.3 : 1; material.transparent = dim; }
    }
  };

  const tick: World["tick"] = (time, camera) => { for (const step of tickers) step(time, camera); };
  const boxes = new Map<string, Box>([...(ground0 ? Object.entries(NORTH_STRIP) : []), ...floorPlan.rooms.map((room) => [room.key, room] as [string, Box])]);
  const centreOf: World["centreOf"] = (key) => {
    const room = boxes.get(key);
    return room ? { x: (room.x0 + room.x1) / 2, z: (room.z0 + room.z1) / 2, span: Math.max(room.x1 - room.x0, room.z1 - room.z0) } : null;
  };
  /** Frees what this floor made; the furniture and characters stay loaded (shared with the kit). */
  const dispose = () => {
    scene.remove(root);
    root.traverse((child) => {
      if (child.userData.kit) return;
      const mesh = child as Three.Mesh;
      if (!child.userData.sharedGeometry) mesh.geometry?.dispose?.();
      if (!child.userData.sharedMaterial) { const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; for (const material of list) { (material as Three.MeshStandardMaterial).map?.dispose(); material.dispose(); } }
    });
    for (const texture of windowTextures.values()) texture.dispose();
  };
  return { level, slots, meetingSeats, pickables, rails, floors, plate: PLATE, update, tick, highlight, centreOf, robot: robotHandle, dispose };
}

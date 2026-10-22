import type * as Three from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HqFloor, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import {
  carpetTexture, concreteTexture, floorText, glow, label, marbleTexture, screen, seeded, skyTexture, techTexture, windowsTexture, woodTexture, type T,
} from "@/modules/crm/dashboard/components/hq-3d-draw";

// The building of HireX HQ mức 3: a high floor of an office tower at night (or day, by Vietnam time), rooms with
// glass walls, real furniture (Kenney Furniture Kit, CC0) and a lit city around it instead of an empty grid.
// Built once; update() only changes numbers, screens, highlights and effects.

export const S = 72; // model units → world units
export type P = { x: number; z: number };
export type RoomKey = "soda" | "inbox" | "tower" | "cv" | "rec" | "sale" | "meeting" | "ai";
type Box = { x0: number; z0: number; x1: number; z1: number };
export const ROOMS: Record<RoomKey, Box & { door: number; side: "N" | "S"; floor: "wood" | "carpet" | "marble" | "tech"; wall: number }> = {
  soda: { x0: -600, z0: -440, x1: -370, z1: -260, door: -485, side: "S", floor: "marble", wall: 54 },
  inbox: { x0: -355, z0: -440, x1: -165, z1: -260, door: -260, side: "S", floor: "tech", wall: 54 },
  tower: { x0: -150, z0: -440, x1: 40, z1: -260, door: -55, side: "S", floor: "tech", wall: 54 },
  cv: { x0: 55, z0: -440, x1: 245, z1: -260, door: 150, side: "S", floor: "tech", wall: 54 },
  rec: { x0: -600, z0: -190, x1: 330, z1: 110, door: 290, side: "S", floor: "wood", wall: 42 },
  sale: { x0: -600, z0: 170, x1: -200, z1: 440, door: -228, side: "N", floor: "wood", wall: 42 },
  meeting: { x0: -185, z0: 170, x1: 95, z1: 440, door: -45, side: "N", floor: "carpet", wall: 54 },
  ai: { x0: 110, z0: 170, x1: 330, z1: 440, door: 220, side: "N", floor: "tech", wall: 54 },
};
export const PLATE: Box = { x0: -650, z0: -490, x1: 650, z1: 490 };
export const CORRIDOR_A = -225, CORRIDOR_B = 140, CONNECTOR_X = 470;
export const COFFEE: P = { x: 430, z: -340 };
const TONE = { cyan: 0x22d3ee, red: 0xfb7185, violet: 0x818cf8, green: 0x34d399 } as const;
export const corridorOf = (room: RoomKey) => (ROOMS[room].side === "S" && room !== "rec" ? CORRIDOR_A : CORRIDOR_B);

/** A desk seat: where the person sits, which way they face, and the walk from the chair out to the corridor. */
/** facing = rotation.y of a character (the models look along +z, so Math.PI = facing north, to the screens). */
export interface Slot { key: string; room: RoomKey; sit: P; facing: number; toCorridor: P[]; screenGlow: Three.Mesh | null }

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
      robot.scene.traverse((child) => { if ((child as Three.Mesh).isMesh) child.castShadow = true; });
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
  object.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  const wrapper = new THREE.Group();
  wrapper.add(object);
  return wrapper;
}

export interface World {
  slots: Map<RoomKey, Slot[]>; meetingSeats: Slot[];
  pickables: Three.Object3D[]; rails: Map<RoomKey, Three.Mesh[]>; floors: Map<RoomKey, Three.Mesh>; walls: Map<RoomKey, Three.Mesh[]>;
  update: (data: { rooms: HqRoom[]; stats: HqStats; floor: HqFloor }) => void;
  tick: (time: number, camera: Three.Camera) => void;
  highlight: (room: RoomKey | null) => void;
  robot: { root: Three.Object3D; mixer: Three.AnimationMixer | null; play: (name: string) => void } | null;
}

export function buildWorld(THREE: T, scene: Three.Scene, kit: Kit, sun: Three.DirectionalLight, hemi: Three.HemisphereLight): World {
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
  const plateWidth = PLATE.x1 - PLATE.x0, plateDepth = PLATE.z1 - PLATE.z0;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(plateWidth, 14, plateDepth), new THREE.MeshStandardMaterial({ map: concreteTexture(THREE, [plateWidth / 220, plateDepth / 220]), roughness: 0.35, metalness: 0.15 }));
  slab.position.y = -7; slab.receiveShadow = true;
  const slabEdge = new THREE.Mesh(new THREE.BoxGeometry(plateWidth + 4, 3, plateDepth + 4), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }));
  slabEdge.position.y = -13;
  const under = new THREE.Mesh(new THREE.BoxGeometry(plateWidth - 40, 60, plateDepth - 40), new THREE.MeshStandardMaterial({ color: 0x0a0f1e, roughness: 0.9 }));
  under.position.y = -45;
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

  // ---- The city below ----
  const city = new THREE.Group();
  const ground = -1500; // we are on a high floor: the city lies far below
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
    const angle = random() * Math.PI * 2, distance = 1900 + random() * 5200;
    const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
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
    scene.fog = new THREE.Fog(night ? 0x0b1230 : 0x5d86c6, 2400, 8000);
    sun.intensity = night ? 0.75 : 1.5; sun.color.setHex(night ? 0xbfd2ff : 0xffffff);
    hemi.intensity = night ? 0.55 : 0.9;
    starField.visible = night;
    roadMaterial.opacity = night ? 0.22 : 0.08;
  };
  let night: boolean | null = null;
  const isNight = () => { const hour = (new Date().getUTCHours() + 7) % 24; return hour < 6 || hour >= 18; };

  // ---- Rooms ----
  const floors = new Map<RoomKey, Three.Mesh>();
  const rails = new Map<RoomKey, Three.Mesh[]>();
  const walls = new Map<RoomKey, Three.Mesh[]>();
  const floorTexture = (kind: string, width: number, depth: number) =>
    kind === "wood" ? woodTexture(THREE, [width / 220, depth / 220]) : kind === "carpet" ? carpetTexture(THREE, [width / 120, depth / 120]) : kind === "marble" ? marbleTexture(THREE, [width / 180, depth / 180]) : techTexture(THREE, [width / 70, depth / 70]);
  for (const [key, room] of Object.entries(ROOMS) as Array<[RoomKey, (typeof ROOMS)[RoomKey]]>) {
    const width = room.x1 - room.x0, depth = room.z1 - room.z0, cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 2, depth), new THREE.MeshStandardMaterial({ map: floorTexture(room.floor, width, depth), roughness: room.floor === "marble" ? 0.25 : room.floor === "wood" ? 0.55 : 0.6, metalness: room.floor === "marble" ? 0.2 : 0.05, transparent: true }));
    floor.position.set(cx, 1, cz); floor.receiveShadow = true;
    floor.userData.room = key;
    floors.set(key, floor); pickables.push(floor); root.add(floor);
    const panels: Three.Mesh[] = [], tops: Three.Mesh[] = [];
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xbfe7ff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const railMaterial = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const length = Math.hypot(x1 - x0, z1 - z0);
      if (length < 2) return;
      const horizontal = Math.abs(z1 - z0) < 0.5;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 2, room.wall, horizontal ? 2 : length), glassMaterial);
      panel.position.set((x0 + x1) / 2, 2 + room.wall / 2, (z0 + z1) / 2); panel.userData.sharedMaterial = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 3, 2.5, horizontal ? 3 : length), railMaterial);
      rail.position.set((x0 + x1) / 2, 2 + room.wall, (z0 + z1) / 2); rail.userData.sharedMaterial = true;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 3, 3, horizontal ? 3 : length), new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 }));
      frame.position.set((x0 + x1) / 2, 3.5, (z0 + z1) / 2);
      root.add(panel, rail, frame); panels.push(panel); tops.push(rail);
    };
    // The side on the corridor has a door opening.
    const gap = 30;
    const withDoor = (z: number) => { wall(room.x0, z, room.door - gap, z); wall(room.door + gap, z, room.x1, z); };
    if (room.side === "N") withDoor(room.z0); else wall(room.x0, room.z0, room.x1, room.z0);
    if (room.side === "S") withDoor(room.z1); else wall(room.x0, room.z1, room.x1, room.z1);
    wall(room.x0, room.z0, room.x0, room.z1);
    wall(room.x1, room.z0, room.x1, room.z1);
    for (const [x, z] of [[room.x0, room.z0], [room.x1, room.z0], [room.x0, room.z1], [room.x1, room.z1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(5, room.wall + 4, 5), new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.8, roughness: 0.3 }));
      post.position.set(x, 2 + room.wall / 2, z); root.add(post);
    }
    rails.set(key, tops); walls.set(key, panels);
  }
  const roomLabels = new Map<RoomKey, Three.Mesh>();
  const zoneLabel = (text: string, x: number, z: number) => { const mesh = floorText(THREE, text, "rgba(186,230,253,.55)", 12); const width = (mesh.geometry as Three.PlaneGeometry).parameters.width; mesh.position.set(x + width / 2, 0.6, z); root.add(mesh); };

  // ---- Desks (Phòng Rec 8×2, Phòng Sale 4×2) ----
  const slots = new Map<RoomKey, Slot[]>();
  const screenGlowGeometry = new THREE.PlaneGeometry(20, 12.5);
  const deskRow = (room: RoomKey, xs: number[], deskZs: number[], route: (x: number, aisle: number) => P[]) => {
    const list: Slot[] = [];
    deskZs.forEach((deskZ, row) => xs.forEach((x, col) => {
      place("desk", x, deskZ, { rot: Math.PI });
      place("computerScreen", x, deskZ - 8, { y: 27, rot: 0 });
      place("computerKeyboard", x - 2, deskZ + 7, { y: 27 });
      place("computerMouse", x + 14, deskZ + 7, { y: 27 });
      place("chairDesk", x, deskZ + 36, { rot: Math.PI });
      const glowPanel = new THREE.Mesh(screenGlowGeometry, new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, toneMapped: false }));
      glowPanel.position.set(x, 27 + 12, deskZ - 7 + 4.2);
      root.add(glowPanel);
      const chairZ = deskZ + 36, aisle = chairZ + 30;
      list.push({ key: `${room}-${row}-${col}`, room, sit: { x, z: chairZ + 2 }, facing: Math.PI, toCorridor: [{ x, z: chairZ + 22 }, { x, z: aisle }, ...route(x, aisle)], screenGlow: glowPanel });
    }));
    slots.set(room, list);
  };
  const recX = Array.from({ length: 8 }, (_, index) => -545 + index * 100);
  deskRow("rec", recX, [-140, -10], (_x, aisle) => [{ x: 240, z: aisle }, { x: 240, z: 80 }, { x: 290, z: 80 }, { x: 290, z: 110 }, { x: 290, z: CORRIDOR_B }]);
  const saleX = Array.from({ length: 4 }, (_, index) => -555 + index * 92);
  deskRow("sale", saleX, [205, 325], (_x, aisle) => [{ x: -228, z: aisle }, { x: -228, z: 195 }, { x: -228, z: 170 }, { x: -228, z: CORRIDOR_B }]);
  // Rec: plants and a printer corner in the free space by the door.
  place("pottedPlant", 300, -165, { scale: 1.1 }); place("pottedPlant", -585, 95, { scale: 1.1 }); place("bookcaseOpen", 285, -60, { rot: -Math.PI / 2 }); place("trashcan", 210, 95);
  place("pottedPlant", -585, 425, { scale: 1.1 }); place("coatRackStanding", -215, 425);

  // ---- Phòng họp: round table, eight chairs, a TV on the wall ----
  const meetingCentre = { x: -45, z: 315 };
  place("tableRound", meetingCentre.x, meetingCentre.z, { scale: 2.1 });
  place("rugRound", meetingCentre.x, meetingCentre.z, { scale: 3.2, y: 2.2 });
  const meetingSeats: Slot[] = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    const x = meetingCentre.x + Math.cos(angle) * 78, z = meetingCentre.z + Math.sin(angle) * 78;
    const facing = Math.atan2(meetingCentre.x - x, meetingCentre.z - z);
    place("chairModernCushion", x, z, { rot: facing + Math.PI });
    const outX = x < meetingCentre.x ? -160 : 70;
    return { key: `meeting-${index}`, room: "meeting" as const, sit: { x, z }, facing, toCorridor: [{ x: outX, z }, { x: outX, z: 200 }, { x: -45, z: 200 }, { x: -45, z: 170 }, { x: -45, z: CORRIDOR_B }], screenGlow: null };
  });
  const meetingTv = screen(THREE, 120, 66);
  meetingTv.group.position.set(meetingCentre.x, 64, 436); meetingTv.group.rotation.y = Math.PI;
  root.add(meetingTv.group);

  // ---- Lễ tân: reception counter, sofa, plants, the HQ wall screen; Soda floats above the counter ----
  place("kitchenBar", -540, -385, { rot: 0, scale: 1.2 }); place("kitchenBar", -510, -385, { rot: 0, scale: 1.2 }); place("kitchenBarEnd", -480, -385, { scale: 1.2 });
  place("loungeDesignSofa", -470, -292, { rot: Math.PI });
  place("rugRectangle", -470, -320, { scale: 0.9, y: 2.2 });
  place("pottedPlant", -585, -425, { scale: 1.2 }); place("plantSmall1", -385, -425, { scale: 1.4 });
  const lobbyScreen = screen(THREE, 150, 72);
  lobbyScreen.group.position.set(-485, 52, -436);
  root.add(lobbyScreen.group);
  const soda = new THREE.Group();
  const sodaCore = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1, roughness: 0.2, metalness: 0.3, flatShading: true }));
  const sodaShell = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1), new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.55 }));
  soda.add(glow(THREE, 0x22d3ee, 80, 0.55), sodaCore, sodaShell);
  const sodaTag = label(THREE, "Soda · Trợ lý", { height: 13 }); sodaTag.position.y = 26;
  soda.add(sodaTag);
  soda.position.set(-510, 72, -385);
  sodaCore.userData.pick = { title: "Soda · Trợ lý HireX", sub: "Mở Trợ lý", href: "/assistant" };
  pickables.push(sodaCore);
  root.add(soda);
  tickers.push((time) => { soda.position.y = 72 + Math.sin(time * 1.6) * 3; sodaCore.rotation.y = time * 0.8; sodaShell.rotation.y = -time * 0.4; sodaShell.rotation.x = time * 0.3; });

  // ---- Trạm tin nhắn: a red wall screen, a sorting desk, messages flying in ----
  const inboxCentre = { x: -260, z: -350 };
  const inboxScreen = screen(THREE, 140, 70);
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
  let inboxActive = false;
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

  // ---- Tháp phát sóng: antenna, speakers, waves ----
  const towerCentre = { x: -55, z: -350 };
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 4.5, 90, 12), new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 }));
  mast.position.set(towerCentre.x, 47, towerCentre.z); mast.castShadow = true;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 20), new THREE.MeshBasicMaterial({ color: 0xa5b4fc }));
  beacon.position.set(towerCentre.x, 95, towerCentre.z); beacon.add(glow(THREE, 0x818cf8, 60, 0.8));
  root.add(mast, beacon);
  place("speaker", towerCentre.x - 60, -420, { scale: 1.4 }); place("speaker", towerCentre.x + 60, -420, { scale: 1.4 });
  const towerScreen = screen(THREE, 120, 60);
  towerScreen.group.position.set(towerCentre.x, 50, -436);
  root.add(towerScreen.group);
  const waves = Array.from({ length: 3 }, (_, index) => {
    const wave = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 48), new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, depthWrite: false }));
    wave.rotation.x = Math.PI / 2; wave.position.set(towerCentre.x, 95, towerCentre.z);
    root.add(wave);
    return { wave, offset: index / 3 };
  });
  let towerActive = false;
  tickers.push((time) => { for (const item of waves) { item.wave.visible = towerActive; const t = (time * 0.45 + item.offset) % 1; item.wave.scale.setScalar(0.4 + t * 6); (item.wave.material as Three.MeshBasicMaterial).opacity = 0.9 * (1 - t); } });

  // ---- Kho CV: shelves and boxes ----
  place("bookcaseClosedWide", 105, -425, { scale: 1.2 }); place("bookcaseClosedWide", 175, -425, { scale: 1.2 }); place("bookcaseOpen", 232, -380, { rot: -Math.PI / 2, scale: 1.2 });
  place("cardboardBoxClosed", 90, -300, { scale: 1.3 }); place("cardboardBoxOpen", 118, -292, { scale: 1.3, rot: 0.4 }); place("cardboardBoxClosed", 96, -300, { scale: 1.1, y: 22 });
  const cvTagAnchor = new THREE.Object3D(); cvTagAnchor.position.set(150, 0, -340); root.add(cvTagAnchor);

  // ---- Bàn AI Recruiter: a desk with a laptop and the robot ----
  place("desk", 220, 270, { rot: Math.PI }); place("laptop", 220, 266, { y: 27, rot: Math.PI });
  place("pottedPlant", 315, 425, { scale: 1.1 });
  let robotHandle: World["robot"] = null;
  if (kit.robot) {
    const model = kit.robot.scene;
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y || 1;
    model.scale.setScalar(58 / height);
    const holder = new THREE.Group();
    holder.add(model);
    holder.position.set(220, 2, 320); holder.rotation.y = Math.PI;
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
    model.traverse((child) => { if ((child as Three.Mesh).isMesh) { child.userData.pick = { title: "AI Recruiter", sub: "Mở cài đặt AI Recruiter", href: "/settings/ai-recruiter" }; pickables.push(child); } });
    robotHandle = { root: holder, mixer, play };
  }

  // ---- Pantry, lounge, green corner ----
  for (let index = 0; index < 5; index += 1) place(index === 4 ? "kitchenBarEnd" : "kitchenBar", 330 + index * 31, -425, { scale: 1.3 });
  place("kitchenCoffeeMachine", COFFEE.x, -425, { y: 30, scale: 1.4 });
  place("kitchenFridgeLarge", 575, -420, { scale: 1.3 });
  for (let index = 0; index < 3; index += 1) place("stoolBar", 360 + index * 45, -360, { scale: 1.2 });
  place("pottedPlant", 285, -425, { scale: 1.2 });
  zoneLabel("Pantry · Cà phê", 270, -275);
  place("rugRectangle", 470, -40, { scale: 1.6, y: 0.4 });
  place("loungeSofa", 470, -120, { scale: 1.2 }); place("loungeSofa", 470, 40, { scale: 1.2, rot: Math.PI });
  place("tableCoffeeGlass", 470, -40, { scale: 1.3 });
  place("lampSquareFloor", 580, -170, { scale: 1.3 }); place("pottedPlant", 585, 90, { scale: 1.2 }); place("plantSmall2", 360, -170, { scale: 1.6 });
  zoneLabel("Lounge", 355, 95);
  place("bench", 470, 420, { scale: 1.3, rot: Math.PI }); place("pottedPlant", 365, 425, { scale: 1.3 }); place("pottedPlant", 585, 425, { scale: 1.3 });
  place("pottedPlant", 585, 200, { scale: 1.3 }); place("bookcaseOpen", 590, 300, { rot: -Math.PI / 2, scale: 1.2 }); place("plantSmall1", 420, 300, { scale: 1.8 }); place("plantSmall2", 520, 300, { scale: 1.8 });
  zoneLabel("Góc xanh", 355, 185);
  for (let x = -600; x <= 600; x += 200) { place("pottedPlant", x, PLATE.z0 + 18, { scale: 1 }); }

  // ---- Room names on the floor ----
  const NAMES: Record<RoomKey, string> = { soda: "Lễ tân · Soda", inbox: "Trạm tin nhắn", tower: "Tháp phát sóng", cv: "Kho CV", rec: "Phòng Rec", sale: "Phòng Sale", meeting: "Phòng họp", ai: "Bàn AI Recruiter" };
  for (const [key, room] of Object.entries(ROOMS) as Array<[RoomKey, (typeof ROOMS)[RoomKey]]>) {
    const mesh = floorText(THREE, NAMES[key], "rgba(186,230,253,.85)", 12);
    const width = (mesh.geometry as Three.PlaneGeometry).parameters.width;
    mesh.position.set(room.x0 + 10 + width / 2, 2.3, room.z1 - (room.side === "S" ? 40 : 14));
    root.add(mesh); roomLabels.set(key, mesh);
  }

  // ---- Live labels (rebuilt on each update) ----
  const liveLabels = new THREE.Group();
  root.add(liveLabels);
  let focus: RoomKey | null = null;
  const toneOf = new Map<RoomKey, number>();

  const update: World["update"] = ({ rooms, stats, floor }) => {
    const nowNight = isNight();
    if (nowNight !== night) { night = nowNight; setNight(nowNight); }
    focus = floor === "REC" ? "rec" : floor === "SALE" ? "sale" : null;
    for (const info of rooms) {
      const key = info.key as RoomKey;
      const floorMesh = floors.get(key);
      if (!floorMesh) continue;
      floorMesh.userData.pick = { title: info.name, sub: info.meta, href: info.href };
      toneOf.set(key, TONE[info.tone]);
      const dim = focus && focus !== key && (key === "rec" || key === "sale");
      (floorMesh.material as Three.MeshStandardMaterial).opacity = dim ? 0.45 : 1;
    }
    highlight(null);
    // Wall screens.
    const n = (value: number | null) => value === null ? "—" : value.toLocaleString("vi-VN");
    lobbyScreen.draw("HireX HQ · hôm nay", [{ text: "Chưa trả lời", value: n(stats.waiting), color: "#FDA4AF" }, { text: "Phản hồi chiến dịch", value: n(stats.replies) }, { text: "CV mới", value: n(stats.cvToday), color: "#67E8F9" }]);
    inboxScreen.draw("Trạm tin nhắn", [{ text: "Chưa trả lời", value: n(stats.waiting), color: "#FDA4AF" }, { text: "Nhóm tag mình", value: n(stats.tagged) }], "#FB7185");
    towerScreen.draw("Zalo Mkt", [{ text: "Tin đã gửi", value: n(stats.sent) }, { text: "Phản hồi", value: n(stats.replies), color: "#A5B4FC" }, { text: "Đang chạy", value: n(stats.running) }], "#818CF8");
    meetingTv.draw("Phòng họp", [{ text: "Lịch hôm nay", value: n(stats.meetingsToday) }], "#818CF8");
    inboxActive = Boolean(stats.waiting); towerActive = Boolean(stats.running);
    // Floating labels.
    while (liveLabels.children.length) { const child = liveLabels.children[0]; liveLabels.remove(child); (child as Three.Sprite).material?.map?.dispose(); (child as Three.Sprite).material?.dispose(); }
    const add = (sprite: Three.Sprite, x: number, y: number, z: number) => { sprite.position.set(x, y, z); liveLabels.add(sprite); };
    add(label(THREE, "Chưa trả lời", { height: 15, bold: n(stats.waiting), boldColor: "#FDA4AF", border: "rgba(244,63,94,.8)" }), inboxCentre.x, 118, -330);
    add(label(THREE, `Zalo Mkt · ${n(stats.sent)} tin · ${n(stats.replies)} phản hồi`, { height: 13 }), towerCentre.x, 128, towerCentre.z);
    add(label(THREE, "CV mới hôm nay", { height: 14, bold: n(stats.cvToday) }), cvTagAnchor.position.x, 80, cvTagAnchor.position.z);
    if (stats.aiActive) add(label(THREE, `Đang tư vấn ${stats.aiActive} UV`, { height: 12, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" }), 220, 82, 320);
    add(label(THREE, "AI Recruiter", { height: 12 }), 220, 70, 320);
    robotHandle?.play(stats.aiActive ? "Yes" : "Idle");
  };

  const highlight: World["highlight"] = (room) => {
    for (const [key, list] of rails) {
      const color = key === room ? 0xa5f3fc : toneOf.get(key) ?? 0x22d3ee;
      const dim = focus && focus !== key && (key === "rec" || key === "sale");
      for (const rail of list) { const material = rail.material as Three.MeshBasicMaterial; material.color.setHex(color); material.opacity = dim ? 0.3 : 1; material.transparent = Boolean(dim); }
    }
  };

  const tick: World["tick"] = (time, camera) => { for (const step of tickers) step(time, camera); };
  return { slots, meetingSeats, pickables, rails, floors, walls, update, tick, highlight, robot: robotHandle };
}

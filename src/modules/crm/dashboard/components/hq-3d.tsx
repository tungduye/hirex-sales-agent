"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as Three from "three";
import type { HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import styles from "@/modules/crm/dashboard/components/hq.module.css";

// HireX HQ, mức 3: the office in real 3D (Three.js, loaded only when this view opens). Same rooms and seats as the
// 2.5D map: drag to turn, scroll to zoom, right-drag to move; hover shows who / what, a click opens the room's screen.
// Live parts: messages flying into Trạm tin nhắn, signal waves on Tháp phát sóng, Soda floating at the desk.
// The scene is built once; each data refresh (every minute) only rebuilds the content, the camera stays where it is.

type T = typeof Three;
type Props = { rooms: HqRoom[]; team: HqMember[]; stats: HqStats; floor: HqFloor; onUnsupported: () => void };
type Hover = { x: number; y: number; title: string; sub: string } | null;
type Pick = { title: string; sub: string; href: string | null };

const W = 760, H = 670;
const BOXES: Record<string, { left: number; top: number; width: number; height: number }> = {
  soda: { left: 0, top: 0, width: 178, height: 170 }, inbox: { left: 194, top: 0, width: 178, height: 170 },
  tower: { left: 388, top: 0, width: 178, height: 170 }, cv: { left: 582, top: 0, width: 178, height: 170 },
  rec: { left: 0, top: 186, width: 760, height: 240 },
  sale: { left: 0, top: 442, width: 300, height: 228 }, meeting: { left: 316, top: 442, width: 212, height: 228 }, ai: { left: 544, top: 442, width: 216, height: 228 },
};
const TONE = { cyan: 0x22d3ee, red: 0xfb7185, violet: 0x818cf8, green: 0x34d399 } as const;
const RING = { busy: "#22D3EE", alert: "#FB7185", meet: "#818CF8", idle: "#64748B" } as const;
const AV_COLORS = ["#A5F3FC", "#C7D2FE", "#BAE6FD", "#DDD6FE", "#99F6E4", "#E0E7FF", "#FBCFE8", "#FDE68A"];
const avatarColor = (id: string) => AV_COLORS[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % AV_COLORS.length];
const FONT = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif';
const n = (value: number | null) => value === null ? "—" : value.toLocaleString("vi-VN");
const CAMERA_START = { x: -360, y: 660, z: 800 };

/** Floor point (px of the plan, like the 2.5D map) → world x/z (centre of the plan at 0,0). */
const world = (room: string, x: number, y: number) => ({ x: BOXES[room].left + x - W / 2, z: BOXES[room].top + y - H / 2 });

interface Engine {
  THREE: T; scene: Three.Scene; camera: Three.PerspectiveCamera; renderer: Three.WebGLRenderer;
  controls: { update: () => void; dispose: () => void; autoRotate: boolean; target: Three.Vector3; reset: () => void; saveState: () => void };
  content: Three.Group; pickables: Three.Object3D[]; tickers: Array<(time: number) => void>;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y); context.arcTo(x + width, y, x + width, y + height, radius); context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius); context.arcTo(x, y, x + width, y, radius); context.closePath();
}

/** A pill label as a sprite that always faces the camera. height = world units. */
function label(THREE: T, text: string, options: { height?: number; color?: string; bg?: string; border?: string; bold?: string; boldColor?: string } = {}) {
  const px = 44, pad = 22, height = options.height ?? 17;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = `600 ${px}px ${FONT}`;
  const boldWidth = options.bold ? context.measureText(` ${options.bold}`).width : 0;
  const width = Math.ceil(context.measureText(text).width + boldWidth + pad * 2);
  canvas.width = width; canvas.height = px + 28;
  context.font = `600 ${px}px ${FONT}`;
  roundRect(context, 2, 2, width - 4, canvas.height - 4, (canvas.height - 4) / 2);
  context.fillStyle = options.bg ?? "rgba(7,11,22,.88)"; context.fill();
  context.lineWidth = 3; context.strokeStyle = options.border ?? "rgba(129,140,248,.55)"; context.stroke();
  context.fillStyle = options.color ?? "#E6ECFF"; context.textBaseline = "middle";
  context.fillText(text, pad, canvas.height / 2 + 2);
  if (options.bold) { context.fillStyle = options.boldColor ?? "#67E8F9"; context.fillText(` ${options.bold}`, pad + context.measureText(text).width, canvas.height / 2 + 2); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set((width / canvas.height) * height, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Text painted flat on the floor (room names). */
function floorText(THREE: T, text: string, color: string, size = 13) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const px = 48;
  context.font = `700 ${px}px ${FONT}`;
  const spaced = text.toUpperCase().split("").join(String.fromCharCode(8202));
  canvas.width = Math.ceil(context.measureText(spaced).width + 8); canvas.height = px + 16;
  context.font = `700 ${px}px ${FONT}`; context.fillStyle = color; context.textBaseline = "middle";
  context.fillText(spaced, 4, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((canvas.width / canvas.height) * size, size), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Round avatar (initials, or the member's photo when the link allows it) with the status ring. */
function avatar(THREE: T, person: { id: string; initials: string; avatarUrl: string | null; tone: keyof typeof RING }, size = 30, fill?: string, glyph?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  const context = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = (image?: HTMLImageElement) => {
    context.clearRect(0, 0, 160, 160);
    context.beginPath(); context.arc(80, 80, 74, 0, Math.PI * 2); context.fillStyle = RING[person.tone]; context.fill();
    context.beginPath(); context.arc(80, 80, 64, 0, Math.PI * 2); context.fillStyle = "#0A1022"; context.fill();
    context.save(); context.beginPath(); context.arc(80, 80, 58, 0, Math.PI * 2); context.clip();
    if (image) context.drawImage(image, 22, 22, 116, 116);
    else {
      context.fillStyle = fill ?? avatarColor(person.id); context.fillRect(0, 0, 160, 160);
      context.fillStyle = "#06111f"; context.font = `700 ${glyph ? 50 : 46}px ${FONT}`; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(glyph ?? person.initials, 80, 84);
    }
    context.restore();
    texture.needsUpdate = true;
  };
  paint();
  if (person.avatarUrl) {
    const image = new Image();
    image.crossOrigin = "anonymous"; image.referrerPolicy = "no-referrer";
    image.onload = () => paint(image);
    image.src = person.avatarUrl;
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 9;
  return sprite;
}

let glowTexture: Three.Texture | null = null;
function glow(THREE: T, color: number, size: number, opacity = 0.55) {
  if (!glowTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.35, "rgba(255,255,255,.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.scale.set(size, size, 1);
  sprite.userData.keepTexture = true;
  return sprite;
}

function disposeTree(object: Three.Object3D) {
  object.traverse((child) => {
    const mesh = child as Three.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const map = (material as Three.MeshBasicMaterial).map;
      if (map && !child.userData.keepTexture) map.dispose();
      material.dispose();
    }
  });
}

/** Builds the people, rooms and live props for the current numbers. */
function buildContent(engine: Engine, data: Omit<Props, "onUnsupported">) {
  const { THREE } = engine;
  engine.scene.remove(engine.content);
  disposeTree(engine.content);
  const content = new THREE.Group();
  const pickables: Three.Object3D[] = [];
  const tickers: Array<(time: number) => void> = [];
  const byKey = new Map(data.rooms.map((room) => [room.key, room]));
  const focus = data.floor === "REC" ? "rec" : data.floor === "SALE" ? "sale" : null;

  // Rooms: a lit floor slab, glass walls with glowing edges, the name on the floor.
  for (const [key, box] of Object.entries(BOXES)) {
    const info = byKey.get(key);
    if (!info) continue;
    const color = TONE[info.tone];
    const dim = focus && focus !== key && (key === "rec" || key === "sale");
    const centre = world(key, box.width / 2, box.height / 2);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(box.width, 4, box.height),
      new THREE.MeshStandardMaterial({ color: 0x0d1630, emissive: color, emissiveIntensity: focus === key ? 0.12 : 0.045, roughness: 0.55, metalness: 0.3, transparent: true, opacity: dim ? 0.45 : 0.95 }));
    slab.position.set(centre.x, 2, centre.z);
    slab.userData.pick = { title: info.name, sub: info.meta, href: info.href } satisfies Pick;
    slab.userData.room = key;
    pickables.push(slab);
    content.add(slab);
    const wallHeight = key === "rec" || key === "sale" ? 22 : 30;
    const wallGeometry = new THREE.BoxGeometry(box.width, wallHeight, box.height);
    const walls = new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dim ? 0.01 : info.tone === "red" ? 0.035 : 0.022, depthWrite: false, side: THREE.DoubleSide }));
    walls.position.set(centre.x, 4 + wallHeight / 2, centre.z);
    content.add(walls);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: dim ? 0.25 : focus === key || info.tone === "red" ? 0.95 : 0.6 }));
    edges.position.copy(walls.position);
    edges.userData.room = key;
    content.add(edges);
    const name = floorText(THREE, info.name, dim ? "rgba(186,230,253,.35)" : "rgba(186,230,253,.9)", 12);
    const nameWidth = (name.geometry as Three.PlaneGeometry).parameters.width;
    const corner = world(key, 12 + nameWidth / 2, box.height - 14);
    name.position.set(corner.x, 4.3, corner.z);
    content.add(name);
  }

  const desk = (room: string, x: number, y: number, on: boolean) => {
    const point = world(room, x, y);
    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 20), new THREE.MeshStandardMaterial({ color: on ? 0x0e7490 : 0x1e293b, emissive: on ? 0x22d3ee : 0x000000, emissiveIntensity: on ? 0.55 : 0, roughness: 0.4, metalness: 0.4 }));
    top.position.y = 14;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 16), new THREE.MeshStandardMaterial({ color: 0x111a33, roughness: 0.8 }));
    legs.position.y = 7;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(16, 11, 1.5), new THREE.MeshStandardMaterial({ color: 0x0b1224, emissive: on ? 0x67e8f9 : 0x1e293b, emissiveIntensity: on ? 0.9 : 0.3 }));
    screen.position.set(0, 22, 5);
    group.add(legs, top, screen);
    group.position.set(point.x, 4, point.z + 12);
    content.add(group);
  };

  const standing = (room: string, x: number, y: number, person: HqMember) => {
    const point = world(room, x, y);
    const group = new THREE.Group();
    const ring = RING[person.tone];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(6.5, 13, 4, 12), new THREE.MeshStandardMaterial({ color: 0x1e2a4a, emissive: new THREE.Color(ring), emissiveIntensity: person.tone === "idle" ? 0.08 : 0.35, roughness: 0.5 }));
    body.position.y = 4 + 6.5 + 6.5;
    const head = avatar(THREE, person, 26);
    head.position.y = 44;
    head.userData.pick = { title: `${person.name}${person.department ? ` · ${person.department}` : ""}`, sub: person.doing, href: null } satisfies Pick;
    pickables.push(head);
    const halo = glow(THREE, new THREE.Color(ring).getHex(), 46, person.tone === "idle" ? 0.15 : 0.4);
    halo.position.y = 44;
    const tagText = person.tone === "alert" ? `${person.name} · ${person.waiting.toLocaleString("vi-VN")} chờ` : person.name;
    const tag = label(THREE, tagText.length > 22 ? `${tagText.slice(0, 21)}…` : tagText, { height: 12, border: person.tone === "alert" ? "rgba(244,63,94,.8)" : undefined });
    tag.position.y = 64;
    group.add(body, halo, head, tag);
    if (person.tone === "busy") {
      const bubble = label(THREE, "Đang nhắn", { height: 12, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" });
      bubble.position.y = 79;
      group.add(bubble);
      const phase = Math.random() * 6;
      tickers.push((time) => { bubble.position.y = 79 + Math.sin(time * 3 + phase) * 1.5; });
    }
    group.position.set(point.x, 0, point.z);
    content.add(group);
  };

  const seats = (room: string, people: HqMember[], cols: number, rows: number, x0: number, y0: number, dx: number, dy: number) => {
    const total = cols * rows;
    const shown = people.length > total ? people.slice(0, total - 1) : people;
    for (let index = 0; index < total; index += 1) {
      const x = x0 + (index % cols) * dx, y = y0 + Math.floor(index / cols) * dy;
      const person = shown[index];
      desk(room, x, y, Boolean(person && person.tone !== "idle"));
      if (person) standing(room, x, y - 4, person);
    }
    if (people.length > total) {
      const last = total - 1, point = world(room, x0 + (last % cols) * dx, y0 + Math.floor(last / cols) * dy);
      const more = label(THREE, `+${people.length - shown.length} người`, { height: 14 });
      more.position.set(point.x, 40, point.z);
      content.add(more);
    }
  };
  const seated = (seat: HqMember["seat"]) => data.team.filter((person) => person.seat === seat);
  seats("rec", seated("REC"), 7, 2, 62, 72, 104, 118);
  seats("sale", seated("SALE"), 3, 2, 56, 70, 94, 116);

  // Phòng họp: a round table, the people in a meeting around it.
  const table = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 4, 40), new THREE.MeshStandardMaterial({ color: 0x1b2450, emissive: 0x818cf8, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.5 }));
  const tableAt = world("meeting", 106, 118);
  table.position.set(tableAt.x, 16, tableAt.z);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 14, 16), new THREE.MeshStandardMaterial({ color: 0x111a33 }));
  stem.position.set(tableAt.x, 9, tableAt.z);
  content.add(table, stem);
  const inMeeting = seated("MEET").slice(0, 8);
  inMeeting.forEach((person, index) => {
    const angle = (index / Math.max(1, inMeeting.length)) * Math.PI * 2 - Math.PI / 2;
    standing("meeting", 106 + Math.cos(angle) * 66, 118 + Math.sin(angle) * 66, person);
  });
  if (!inMeeting.length) { const tag = label(THREE, `${data.stats.meetingsToday} lịch hôm nay`, { height: 14 }); tag.position.set(tableAt.x, 40, tableAt.z); content.add(tag); }

  // Lễ tân: Soda floats over its desk.
  desk("soda", 89, 104, true);
  const sodaAt = world("soda", 89, 96);
  const soda = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, flatShading: true }));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1), new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.55 }));
  soda.add(glow(THREE, 0x22d3ee, 70, 0.5), core, shell);
  const sodaTag = label(THREE, "Soda · Trợ lý", { height: 13 }); sodaTag.position.y = 26;
  const sodaBubble = label(THREE, "Bản tin hôm nay", { height: 12, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" }); sodaBubble.position.y = 41;
  soda.add(sodaTag, sodaBubble);
  soda.position.set(sodaAt.x, 46, sodaAt.z);
  core.userData.pick = { title: "Soda · Trợ lý HireX", sub: "Mở Trợ lý", href: "/assistant" } satisfies Pick;
  pickables.push(core);
  content.add(soda);
  tickers.push((time) => { soda.position.y = 46 + Math.sin(time * 1.6) * 3; core.rotation.y = time * 0.8; shell.rotation.y = -time * 0.4; shell.rotation.x = time * 0.3; });

  // Trạm tin nhắn: pulsing ring and messages flying in while anything waits.
  const inboxAt = world("inbox", 89, 92);
  const inboxTag = label(THREE, "Chưa trả lời", { height: 15, bold: n(data.stats.waiting), boldColor: "#FDA4AF", border: "rgba(244,63,94,.8)" });
  inboxTag.position.set(inboxAt.x, 58, inboxAt.z);
  content.add(inboxTag);
  if (data.stats.tagged) { const tagged = label(THREE, `${n(data.stats.tagged)} nhóm tag mình`, { height: 12 }); tagged.position.set(inboxAt.x, 42, inboxAt.z); content.add(tagged); }
  if (data.stats.waiting) {
    const pulse = new THREE.Mesh(new THREE.RingGeometry(14, 17, 48), new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    pulse.rotation.x = -Math.PI / 2; pulse.position.set(inboxAt.x, 4.5, inboxAt.z);
    const light = new THREE.PointLight(0xfb7185, 1.4, 220, 1.6); light.position.set(inboxAt.x, 40, inboxAt.z);
    content.add(pulse, light);
    tickers.push((time) => { const phase = (time % 2) / 2; pulse.scale.setScalar(0.5 + phase * 2.4); (pulse.material as Three.MeshBasicMaterial).opacity = 1 - phase; light.intensity = 1 + Math.sin(time * 3) * 0.5; });
    const dots = Array.from({ length: 9 }, (_, index) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 12), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true }));
      const halo = glow(THREE, 0x22d3ee, 16, 0.8);
      dot.add(halo);
      content.add(dot);
      return { dot, offset: index / 9, from: { x: inboxAt.x - 260 + (index % 3) * 30, z: inboxAt.z + 120 + Math.floor(index / 3) * 40 } };
    });
    tickers.push((time) => {
      for (const item of dots) {
        const phase = (time * 0.35 + item.offset) % 1;
        item.dot.position.set(item.from.x + (inboxAt.x - item.from.x) * phase, 22 + Math.sin(phase * Math.PI) * 50, item.from.z + (inboxAt.z - item.from.z) * phase);
        (item.dot.material as Three.MeshBasicMaterial).opacity = phase < 0.1 ? phase * 10 : phase > 0.9 ? (1 - phase) * 10 : 1;
      }
    });
  }

  // Tháp phát sóng: an antenna sending waves while campaigns run.
  const towerAt = world("tower", 89, 92);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 4, 70, 12), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 }));
  mast.position.set(towerAt.x, 39, towerAt.z);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 20), new THREE.MeshBasicMaterial({ color: 0xa5b4fc }));
  beacon.position.set(towerAt.x, 77, towerAt.z);
  beacon.add(glow(THREE, 0x818cf8, 50, 0.7));
  content.add(mast, beacon);
  const towerTag = label(THREE, `Zalo Mkt · ${n(data.stats.sent)} tin · ${n(data.stats.replies)} phản hồi`, { height: 13 });
  towerTag.position.set(towerAt.x, 104, towerAt.z);
  const running = label(THREE, `${n(data.stats.running)} đang chạy`, { height: 12 });
  running.position.set(towerAt.x, 90, towerAt.z);
  content.add(towerTag, running);
  if (data.stats.running) {
    const waves = Array.from({ length: 3 }, (_, index) => {
      const wave = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 8, 48), new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, depthWrite: false }));
      wave.rotation.x = Math.PI / 2; wave.position.set(towerAt.x, 77, towerAt.z);
      content.add(wave);
      return { wave, offset: index / 3 };
    });
    tickers.push((time) => { for (const item of waves) { const phase = (time * 0.45 + item.offset) % 1; item.wave.scale.setScalar(0.4 + phase * 5); (item.wave.material as Three.MeshBasicMaterial).opacity = 0.9 * (1 - phase); } });
  }

  // Kho CV: shelves of files.
  const cvAt = world("cv", 89, 96);
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(60, 34, 12), new THREE.MeshStandardMaterial({ color: 0x15213f, emissive: 0x22d3ee, emissiveIntensity: 0.06, roughness: 0.7 }));
    rack.position.set(cvAt.x - 40 + shelf * 40, 21, cvAt.z + 30 - shelf * 30);
    rack.rotation.y = Math.PI / 4;
    content.add(rack);
    for (let file = 0; file < 4; file += 1) {
      const folder = new THREE.Mesh(new THREE.BoxGeometry(4, 14, 9), new THREE.MeshStandardMaterial({ color: [0x67e8f9, 0xa5b4fc, 0x6ee7b7, 0xfde68a][file], emissive: [0x22d3ee, 0x818cf8, 0x34d399, 0xf59e0b][file], emissiveIntensity: 0.4 }));
      folder.position.set(-18 + file * 10, 24, 0);
      rack.add(folder);
    }
  }
  const cvTag = label(THREE, "CV mới hôm nay", { height: 14, bold: n(data.stats.cvToday) });
  cvTag.position.set(cvAt.x, 66, cvAt.z);
  content.add(cvTag);

  // Bàn AI Recruiter.
  desk("ai", 108, 128, Boolean(data.stats.aiActive));
  const aiAt = world("ai", 108, 120);
  const bot = new THREE.Group();
  const botBody = new THREE.Mesh(new THREE.CapsuleGeometry(7, 13, 4, 12), new THREE.MeshStandardMaterial({ color: 0x0f3b2f, emissive: 0x34d399, emissiveIntensity: 0.55, roughness: 0.4 }));
  botBody.position.y = 17;
  const botHead = avatar(THREE, { id: "ai", initials: "AI", avatarUrl: null, tone: "busy" }, 28, "#6EE7B7", "AI");
  botHead.position.y = 44;
  botHead.userData.pick = { title: "AI Recruiter", sub: data.stats.aiActive === null ? "Mở cài đặt AI Recruiter" : `Đang tư vấn ${data.stats.aiActive} ứng viên`, href: "/settings/ai-recruiter" } satisfies Pick;
  pickables.push(botHead);
  const botTag = label(THREE, "AI Recruiter", { height: 13 }); botTag.position.y = 64;
  bot.add(botBody, glow(THREE, 0x34d399, 50, 0.45), botHead, botTag);
  (bot.children[1] as Three.Sprite).position.y = 44;
  if (data.stats.aiActive) { const bubble = label(THREE, `Đang tư vấn ${data.stats.aiActive} UV`, { height: 12, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" }); bubble.position.y = 79; bot.add(bubble); }
  bot.position.set(aiAt.x, 0, aiAt.z);
  content.add(bot);
  tickers.push((time) => { botBody.rotation.y = time; });

  engine.scene.add(content);
  engine.content = content; engine.pickables = pickables; engine.tickers = tickers;
}

export function HqScene3D({ rooms, team, stats, floor, onUnsupported }: Props) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const dataRef = useRef({ rooms, team, stats, floor });
  const [hover, setHover] = useState<Hover>(null);
  const [spinning, setSpinning] = useState(false);
  const [loading, setLoading] = useState(true);
  const fallback = useRef(onUnsupported);
  const navigate = useRef(router.push);
  useEffect(() => { fallback.current = onUnsupported; navigate.current = router.push; });

  useEffect(() => {
    dataRef.current = { rooms, team, stats, floor };
    if (engineRef.current) buildContent(engineRef.current, dataRef.current);
  }, [rooms, team, stats, floor]);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let stopped = false, frame = 0, visible = true;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const [THREE, { OrbitControls }] = await Promise.all([import("three"), import("three/examples/jsm/controls/OrbitControls.js")]);
      if (stopped) return;
      let renderer: Three.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
      catch { fallback.current(); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      element.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x070b16, 1300, 2600);
      const camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
      camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(10, 0, 110);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 260; controls.maxDistance = 1500; controls.maxPolarAngle = 1.32; controls.minPolarAngle = 0.2;
      controls.autoRotateSpeed = 0.6;
      controls.saveState();

      scene.add(new THREE.AmbientLight(0x8ea2ff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-300, 700, 400); scene.add(sun);
      const rim = new THREE.DirectionalLight(0x22d3ee, 0.35); rim.position.set(500, 200, -500); scene.add(rim);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x070b16, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5;
      scene.add(ground);
      const grid = new THREE.GridHelper(4000, 125, 0x22d3ee, 0x22d3ee);
      (grid.material as Three.Material).transparent = true; (grid.material as Three.Material).opacity = 0.07; (grid.material as Three.Material).depthWrite = false;
      scene.add(grid);

      const engine: Engine = { THREE, scene, camera, renderer, controls, content: new THREE.Group(), pickables: [], tickers: [] };
      engineRef.current = engine;
      buildContent(engine, dataRef.current);
      setLoading(false);

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

      // Hover / click on rooms, people and bots.
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let down: { x: number; y: number } | null = null;
      let current: { pick: Pick; room: string | null } | null = null;
      const pickAt = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(engine.pickables, false);
        const sprite = hits.find((hit) => (hit.object as Three.Sprite).isSprite || hit.object.userData.pick?.href === "/assistant");
        const hit = sprite ?? hits[0];
        return hit ? { pick: hit.object.userData.pick as Pick, room: (hit.object.userData.room as string | undefined) ?? null, rect } : null;
      };
      const highlight = (room: string | null) => {
        for (const child of engine.content.children) {
          if (child.userData.room && (child as Three.LineSegments).isLineSegments) {
            const material = (child as Three.LineSegments).material as Three.LineBasicMaterial;
            material.color.setHex(child.userData.room === room ? 0xa5f3fc : TONE[(dataRef.current.rooms.find((item) => item.key === child.userData.room)?.tone ?? "cyan")]);
          }
        }
      };
      const onMove = (event: PointerEvent) => {
        if (down) return;
        const found = pickAt(event);
        if (!found) { if (current) { current = null; highlight(null); setHover(null); renderer.domElement.style.cursor = ""; } return; }
        if (current?.room !== found.room) highlight(found.room);
        current = { pick: found.pick, room: found.room };
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
      const onLeave = () => { current = null; highlight(null); setHover(null); };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointerleave", onLeave);

      const started = performance.now();
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (!visible || document.visibilityState !== "visible") return;
        const time = (performance.now() - started) / 1000;
        for (const tick of engine.tickers) tick(time);
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      cleanups.push(() => {
        cancelAnimationFrame(frame);
        observer.disconnect(); seen.disconnect();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        controls.dispose();
        disposeTree(scene);
        renderer.dispose();
        renderer.domElement.remove();
        engineRef.current = null;
      });
    })().catch(() => { if (!stopped) fallback.current(); });
    return () => { stopped = true; for (const cleanup of cleanups) cleanup(); };
  }, []);

  const zoom = (factor: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const { camera, controls } = engine;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    const length = Math.min(1500, Math.max(260, offset.length()));
    camera.position.copy(controls.target).add(offset.setLength(length));
  };
  const toggleSpin = () => setSpinning((value) => { if (engineRef.current) engineRef.current.controls.autoRotate = !value; return !value; });
  const reset = () => { const engine = engineRef.current; if (!engine) return; engine.controls.autoRotate = false; setSpinning(false); engine.controls.reset(); };

  return (
    <div className={styles.scene3dWrap}>
      <div className={styles.mapTools3d}>
        <button type="button" onClick={() => zoom(0.82)} aria-label="Phóng to">+</button>
        <button type="button" onClick={() => zoom(1.22)} aria-label="Thu nhỏ">−</button>
        <button type="button" onClick={toggleSpin} aria-pressed={spinning} aria-label="Tự xoay" className={spinning ? styles.toolOn : undefined}>⟳</button>
        <button type="button" onClick={reset} aria-label="Về góc nhìn ban đầu">⌂</button>
      </div>
      <div ref={holder} className={styles.scene3d} />
      {loading ? <div className={styles.scene3dLoading}>Đang dựng văn phòng 3D…</div> : null}
      {hover ? <div className={styles.tooltip3d} style={{ left: hover.x + 14, top: hover.y + 14 }}><strong>{hover.title}</strong><span>{hover.sub}</span></div> : null}
      <p className={styles.hint3d}>Kéo chuột trái để xoay · lăn chuột để phóng to · kéo chuột phải để di chuyển · bấm vào phòng để mở</p>
    </div>
  );
}

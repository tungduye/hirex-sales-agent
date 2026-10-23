import type * as Three from "three";
import type { HqSeason, LayoutFloor } from "@/modules/crm/dashboard/core/hq-layout";
import { floorText, glow, seeded, type T } from "@/modules/crm/dashboard/components/hq-3d-draw";

// Seasonal decoration of HireX HQ (3D), chosen by the Vietnam date (core/hq-layout.ts seasonOf):
//   Halloween: glowing pumpkins at the doors, bats circling over the floor; Noel: trees with baubles and gifts;
//   Tết: hoa mai / hoa đào and red lanterns along the corridor. Everything is drawn here, no files to download.

type P = { x: number; z: number };

function canvas(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  draw(element.getContext("2d")!);
  return element;
}

/** Adds the season's objects to `root` (the floor's group, disposed with it); returns what moves every frame. */
export function addSeason(THREE: T, root: Three.Object3D, floor: LayoutFloor, season: HqSeason): ((time: number) => void) | null {
  if (!season) return null;
  const tickers: Array<(time: number) => void> = [];
  const random = seeded(77 + floor.level);
  const people = floor.rooms.filter((room) => room.kind === "dept" || room.kind === "boss" || room.kind === "common");
  const lobby: P = floor.level === 0 ? { x: -588, z: -285 } : { x: -588, z: -300 };
  const lounge: P = { x: 555, z: 150 };
  const texture = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; return map; };

  if (season === "halloween") {
    // Pumpkins: orange ribbed skin, a carved face that glows (emissive map) turned towards the camera.
    const skin = texture(canvas(256, 128, (context) => {
      context.fillStyle = "#EA580C"; context.fillRect(0, 0, 256, 128);
      for (let x = 0; x < 256; x += 21) { context.fillStyle = "rgba(124,45,18,.35)"; context.fillRect(x, 0, 4, 128); }
    }));
    const face = (context: CanvasRenderingContext2D, colour: string) => {
      context.fillStyle = colour;
      const cx = 0.15 * 256, cy = 64;
      context.beginPath(); context.moveTo(cx - 16, cy - 10); context.lineTo(cx - 8, cy - 24); context.lineTo(cx - 2, cy - 10); context.fill();
      context.beginPath(); context.moveTo(cx + 2, cy - 10); context.lineTo(cx + 8, cy - 24); context.lineTo(cx + 16, cy - 10); context.fill();
      context.beginPath(); context.moveTo(cx - 20, cy + 4); for (let index = 0; index <= 6; index += 1) context.lineTo(cx - 20 + index * 6.7, cy + 4 + (index % 2 ? 6 : 0) + Math.sin((index / 6) * Math.PI) * 10); context.lineTo(cx + 20, cy + 4); context.fill();
    };
    const carved = texture(canvas(256, 128, (context) => { context.drawImage(skin.image as HTMLCanvasElement, 0, 0); face(context, "#FDE047"); }));
    const light = texture(canvas(256, 128, (context) => { context.fillStyle = "#000"; context.fillRect(0, 0, 256, 128); face(context, "#FDE047"); }));
    const geometry = new THREE.SphereGeometry(9, 24, 16);
    const material = new THREE.MeshStandardMaterial({ map: carved, emissiveMap: light, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.6 });
    const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.8 });
    const pumpkin = (x: number, z: number, size = 1) => {
      const body = new THREE.Mesh(geometry, material);
      body.scale.set(size, size * 0.78, size); body.position.set(x, 7 * size, z); body.rotation.y = random() * 0.4 - 0.2; body.castShadow = true;
      body.userData.sharedGeometry = true; body.userData.sharedMaterial = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 4 * size, 6), stemMaterial);
      stem.position.set(x, 14 * size, z); stem.userData.sharedMaterial = true;
      const halo = glow(THREE, 0xf97316, 34 * size, 0.45); halo.position.set(x, 8 * size, z);
      root.add(body, stem, halo);
      const phase = random() * 6;
      tickers.push((time) => { halo.material.opacity = 0.35 + 0.15 * Math.sin(time * 4 + phase) + 0.1 * Math.sin(time * 11 + phase); });
    };
    pumpkin(lobby.x + 20, lobby.z - 10, 1.3); pumpkin(lobby.x + 44, lobby.z + 2, 0.9);
    pumpkin(lounge.x - 30, lounge.z, 1.4); pumpkin(lounge.x - 6, lounge.z + 22, 1);
    pumpkin(300, -300, 1.1);
    for (const room of people) pumpkin(room.x0 + 18, room.z0 + 18, 0.9);
    // Bats circling under the ceiling.
    const batTexture = texture(canvas(128, 64, (context) => {
      context.fillStyle = "#0b0b12";
      context.beginPath(); context.moveTo(64, 30); context.quadraticCurveTo(40, 6, 4, 14); context.quadraticCurveTo(20, 24, 16, 40); context.quadraticCurveTo(32, 30, 44, 42); context.quadraticCurveTo(54, 34, 64, 46);
      context.quadraticCurveTo(74, 34, 84, 42); context.quadraticCurveTo(96, 30, 112, 40); context.quadraticCurveTo(108, 24, 124, 14); context.quadraticCurveTo(88, 6, 64, 30); context.fill();
      context.fillStyle = "#F87171"; context.fillRect(58, 30, 4, 3); context.fillRect(66, 30, 4, 3);
    }));
    const batMaterial = new THREE.SpriteMaterial({ map: batTexture, transparent: true, depthWrite: false });
    const centreZ = (floor.plate.z0 + floor.plate.z1) / 2, spread = (floor.plate.z1 - floor.plate.z0) / 2.6;
    for (let index = 0; index < 7; index += 1) {
      const bat = new THREE.Sprite(batMaterial); bat.scale.set(26, 13, 1); bat.userData.sharedMaterial = true;
      root.add(bat);
      const radius = 180 + random() * spread, speed = 0.18 + random() * 0.2, phase = random() * Math.PI * 2, height = 120 + random() * 50;
      tickers.push((time) => {
        const angle = phase + time * speed;
        bat.position.set(Math.cos(angle) * radius * 1.3, height + Math.sin(time * 3 + phase) * 6, centreZ + Math.sin(angle) * radius);
        bat.scale.set(26 * (0.75 + 0.25 * Math.abs(Math.sin(time * 9 + phase))), 13, 1); // wings flapping
      });
    }
    const purple = new THREE.PointLight(0xa855f7, 1.4, 600, 1.4); purple.position.set(0, 140, centreZ); root.add(purple);
    tickers.push((time) => { purple.intensity = 1.1 + Math.sin(time * 0.8) * 0.4; });
    const sign = floorText(THREE, "Happy Halloween", "rgba(251,146,60,.9)", 16); sign.position.set(lounge.x - 80, 2.6, lounge.z - 50); root.add(sign);
  }

  if (season === "christmas") {
    const tree = (x: number, z: number, size = 1) => {
      const green = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 });
      [[34, 30, 26], [27, 26, 48], [19, 22, 68]].forEach(([radius, height, y]) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * size, height * size, 14), green); cone.position.set(x, y * size, z); cone.castShadow = true; cone.userData.sharedMaterial = true; root.add(cone);
      });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(4 * size, 5 * size, 14 * size, 8), new THREE.MeshStandardMaterial({ color: 0x78350f })); trunk.position.set(x, 7 * size, z); root.add(trunk);
      const star = glow(THREE, 0xfde047, 40 * size, 0.9); star.position.set(x, 84 * size, z); root.add(star);
      tickers.push((time) => { star.material.opacity = 0.6 + 0.35 * Math.abs(Math.sin(time * 2)); });
      const colours = [0xef4444, 0xfacc15, 0x60a5fa, 0xf472b6];
      for (let index = 0; index < 16; index += 1) {
        const level = random(), y = (22 + level * 52) * size, radius = (30 - level * 20) * size * 0.85, angle = random() * Math.PI * 2;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(2.4 * size, 8, 8), new THREE.MeshStandardMaterial({ color: colours[index % 4], emissive: colours[index % 4], emissiveIntensity: 0.6 }));
        ball.position.set(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius); root.add(ball);
      }
      for (let index = 0; index < 3; index += 1) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(12 * size, 10 * size, 12 * size), new THREE.MeshStandardMaterial({ color: colours[(index + 1) % 4] }));
        box.position.set(x + (index - 1) * 16 * size, 5 * size, z + 30 * size); box.rotation.y = random(); root.add(box);
      }
    };
    tree(lobby.x + 30, lobby.z, 1.1); tree(lounge.x - 20, lounge.z, 1.3);
    const sign = floorText(THREE, "Merry Christmas", "rgba(134,239,172,.9)", 16); sign.position.set(lounge.x - 80, 2.6, lounge.z - 60); root.add(sign);
  }

  if (season === "tet") {
    const blossomTree = (x: number, z: number, colour: number, size = 1) => {
      const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.9 });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * size, 4 * size, 50 * size, 7), wood); trunk.position.set(x, 25 * size, z); root.add(trunk);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(12 * size, 9 * size, 14 * size, 12), new THREE.MeshStandardMaterial({ color: 0xb91c1c })); pot.position.set(x, 7 * size, z); root.add(pot);
      const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(2.2 * size, 6, 6), new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35 }), 90);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 90; index += 1) {
        const angle = random() * Math.PI * 2, radius = random() * 30 * size, y = (42 + random() * 34) * size;
        matrix.makeTranslation(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius * 0.8);
        flowers.setMatrixAt(index, matrix);
      }
      root.add(flowers);
    };
    blossomTree(lobby.x + 30, lobby.z, 0xfacc15, 1.2); // hoa mai
    blossomTree(lounge.x - 20, lounge.z, 0xf9a8d4, 1.3); // hoa đào
    // Red lanterns along the first corridor, swaying a little.
    const lanternMaterial = new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0xdc2626, emissiveIntensity: 0.7, roughness: 0.5 });
    for (let x = -560; x <= 380; x += 120) {
      const lantern = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), lanternMaterial); body.scale.set(1, 1.2, 1); body.userData.sharedMaterial = true;
      const halo = glow(THREE, 0xef4444, 34, 0.45);
      lantern.add(body, halo);
      lantern.position.set(x, 112, floor.corridors[0]);
      root.add(lantern);
      const phase = random() * 6;
      tickers.push((time) => { lantern.rotation.z = Math.sin(time * 1.4 + phase) * 0.08; lantern.position.y = 112 + Math.sin(time * 1.4 + phase) * 1.5; });
    }
    const sign = floorText(THREE, "Chúc mừng năm mới", "rgba(252,165,165,.95)", 16); sign.position.set(lounge.x - 90, 2.6, lounge.z - 60); root.add(sign);
  }
  return (time) => { for (const step of tickers) step(time); };
}

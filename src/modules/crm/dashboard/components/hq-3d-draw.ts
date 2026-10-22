import type * as Three from "three";

// Drawing helpers for the 3D office (HireX HQ mức 3): labels, avatars, glow, procedural textures (floors, sky,
// city windows) and wall screens. Everything is painted on canvases, so the only downloaded files are the models.

export type T = typeof Three;
export const FONT = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif';
export const RING = { busy: "#22D3EE", alert: "#FB7185", meet: "#818CF8", idle: "#64748B" } as const;
const AV_COLORS = ["#A5F3FC", "#C7D2FE", "#BAE6FD", "#DDD6FE", "#99F6E4", "#E0E7FF", "#FBCFE8", "#FDE68A"];
export const hashOf = (id: string) => Array.from(id).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
const avatarColor = (id: string) => AV_COLORS[hashOf(id) % AV_COLORS.length];

/** Deterministic pseudo-random numbers (the city and textures look the same on every visit). */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y); context.arcTo(x + width, y, x + width, y + height, radius); context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius); context.arcTo(x, y, x + width, y, radius); context.closePath();
}

function canvasTexture(THREE: T, canvas: HTMLCanvasElement, repeat?: [number, number]) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat[0], repeat[1]); }
  return texture;
}

/** A pill label as a sprite that always faces the camera. height = world units. */
export function label(THREE: T, text: string, options: { height?: number; color?: string; bg?: string; border?: string; bold?: string; boldColor?: string } = {}) {
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(THREE, canvas), transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set((width / canvas.height) * height, height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** Text painted flat on the floor (room and zone names). */
export function floorText(THREE: T, text: string, color: string, size = 13) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const px = 48;
  context.font = `700 ${px}px ${FONT}`;
  const spaced = text.toUpperCase().split("").join(String.fromCharCode(8202));
  canvas.width = Math.ceil(context.measureText(spaced).width + 8); canvas.height = px + 16;
  context.font = `700 ${px}px ${FONT}`; context.fillStyle = color; context.textBaseline = "middle";
  context.fillText(spaced, 4, canvas.height / 2);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((canvas.width / canvas.height) * size, size), new THREE.MeshBasicMaterial({ map: canvasTexture(THREE, canvas), transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Round avatar (initials, or the member's photo when the link allows it) with the status ring. */
export function avatar(THREE: T, person: { id: string; initials: string; avatarUrl: string | null; tone: keyof typeof RING }, size = 30, fill?: string, glyph?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  const context = canvas.getContext("2d")!;
  const texture = canvasTexture(THREE, canvas);
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 19;
  return sprite;
}

let glowTexture: Three.Texture | null = null;
export function glow(THREE: T, color: number, size: number, opacity = 0.55) {
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

export function disposeTree(object: Three.Object3D) {
  object.traverse((child) => {
    if (child.userData.shared) return;
    const mesh = child as Three.Mesh;
    if (!child.userData.sharedGeometry) mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      if (child.userData.sharedMaterial) continue;
      const map = (material as Three.MeshBasicMaterial).map;
      if (map && !child.userData.keepTexture) map.dispose();
      material.dispose();
    }
  });
}

// ---- Procedural textures ----

function paint(size: [number, number], draw: (context: CanvasRenderingContext2D, width: number, height: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size[0]; canvas.height = size[1];
  draw(canvas.getContext("2d")!, size[0], size[1]);
  return canvas;
}

/** Warm wooden planks (work rooms). One tile = 160 world units. */
export function woodTexture(THREE: T, repeat: [number, number]) {
  const random = seeded(11);
  return canvasTexture(THREE, paint([512, 512], (context, width, height) => {
    const rows = 8, plank = height / rows;
    for (let row = 0; row < rows; row += 1) {
      let x = -random() * 200;
      while (x < width) {
        const length = 180 + random() * 220;
        const tone = 52 + random() * 22;
        context.fillStyle = `rgb(${tone + 34},${tone + 12},${tone - 14})`;
        context.fillRect(x, row * plank, length, plank);
        context.strokeStyle = "rgba(255,240,220,.05)";
        for (let grain = 0; grain < 5; grain += 1) { context.beginPath(); const y = row * plank + 4 + random() * (plank - 8); context.moveTo(x, y); context.bezierCurveTo(x + length / 3, y + 3, x + (2 * length) / 3, y - 3, x + length, y); context.stroke(); }
        context.fillStyle = "rgba(0,0,0,.45)"; context.fillRect(x + length - 2, row * plank, 2, plank);
        x += length;
      }
      context.fillStyle = "rgba(0,0,0,.5)"; context.fillRect(0, row * plank, width, 2);
    }
  }), repeat);
}

/** Dark blue carpet (meeting room). */
export function carpetTexture(THREE: T, repeat: [number, number]) {
  const random = seeded(23);
  return canvasTexture(THREE, paint([256, 256], (context, width, height) => {
    context.fillStyle = "#1b2150"; context.fillRect(0, 0, width, height);
    for (let index = 0; index < 4000; index += 1) { context.fillStyle = `rgba(${random() > 0.5 ? "129,140,248" : "10,14,40"},${0.08 + random() * 0.12})`; context.fillRect(random() * width, random() * height, 1.5, 1.5); }
    context.strokeStyle = "rgba(165,180,252,.10)"; context.lineWidth = 2;
    for (let line = 0; line < width; line += 32) { context.beginPath(); context.moveTo(line, 0); context.lineTo(line, height); context.stroke(); }
  }), repeat);
}

/** Dark marble with soft veins (lobby). */
export function marbleTexture(THREE: T, repeat: [number, number]) {
  const random = seeded(37);
  return canvasTexture(THREE, paint([512, 512], (context, width, height) => {
    context.fillStyle = "#1c2236"; context.fillRect(0, 0, width, height);
    for (let vein = 0; vein < 14; vein += 1) {
      context.strokeStyle = `rgba(220,230,255,${0.05 + random() * 0.08})`; context.lineWidth = 0.6 + random() * 1.6;
      context.beginPath(); let x = random() * width, y = random() * height; context.moveTo(x, y);
      for (let step = 0; step < 8; step += 1) { x += (random() - 0.3) * 90; y += (random() - 0.5) * 90; context.lineTo(x, y); }
      context.stroke();
    }
    context.strokeStyle = "rgba(0,0,0,.35)"; context.lineWidth = 2; context.strokeRect(0, 0, width, height);
  }), repeat);
}

/** Tech floor: dark tiles with thin glowing seams (Trạm tin nhắn, Tháp phát sóng, Kho CV, AI). */
export function techTexture(THREE: T, repeat: [number, number], seam = "rgba(103,232,249,.28)") {
  return canvasTexture(THREE, paint([256, 256], (context, width, height) => {
    context.fillStyle = "#0e1730"; context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,.025)"; context.fillRect(8, 8, width / 2 - 16, height / 2 - 16); context.fillRect(width / 2 + 8, height / 2 + 8, width / 2 - 16, height / 2 - 16);
    context.strokeStyle = seam; context.lineWidth = 2;
    context.strokeRect(1, 1, width - 2, height - 2);
    context.beginPath(); context.moveTo(width / 2, 0); context.lineTo(width / 2, height); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
  }), repeat);
}

/** Polished concrete with large tiles (corridors, building floor). */
export function concreteTexture(THREE: T, repeat: [number, number]) {
  const random = seeded(51);
  return canvasTexture(THREE, paint([512, 512], (context, width, height) => {
    context.fillStyle = "#262d3f"; context.fillRect(0, 0, width, height);
    for (let index = 0; index < 2500; index += 1) { context.fillStyle = `rgba(${random() > 0.5 ? 255 : 0},${random() > 0.5 ? 255 : 0},255,${random() * 0.035})`; context.fillRect(random() * width, random() * height, 3, 3); }
    context.strokeStyle = "rgba(0,0,0,.4)"; context.lineWidth = 2;
    for (let line = 0; line <= width; line += width / 2) { context.beginPath(); context.moveTo(line, 0); context.lineTo(line, height); context.moveTo(0, line); context.lineTo(width, line); context.stroke(); }
  }), repeat);
}

/** Office-tower façade with lit windows (city around the building). */
export function windowsTexture(THREE: T, seed: number, night: boolean) {
  const random = seeded(seed);
  return canvasTexture(THREE, paint([128, 256], (context, width, height) => {
    context.fillStyle = "#0b1020"; context.fillRect(0, 0, width, height);
    const cols = 6, rows = 16, cellW = width / cols, cellH = height / rows;
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      const lit = random() < (night ? 0.42 : 0.12);
      const warm = random() < 0.7;
      context.fillStyle = lit ? (warm ? `rgba(255,${200 + random() * 40},${120 + random() * 60},${0.65 + random() * 0.35})` : `rgba(150,${210 + random() * 40},255,${0.6 + random() * 0.4})`) : "rgba(40,55,90,.55)";
      context.fillRect(col * cellW + 3, row * cellH + 4, cellW - 6, cellH - 7);
    }
  }), [1, 1]);
}

/** Vertical sky gradient for the scene background. */
export function skyTexture(THREE: T, night: boolean) {
  const texture = canvasTexture(THREE, paint([4, 512], (context, _width, height) => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    if (night) { gradient.addColorStop(0, "#03050d"); gradient.addColorStop(0.55, "#0a1230"); gradient.addColorStop(0.8, "#1c1f4f"); gradient.addColorStop(1, "#2b1d4a"); }
    else { gradient.addColorStop(0, "#10265a"); gradient.addColorStop(0.6, "#2c5aa0"); gradient.addColorStop(1, "#7aa6e0"); }
    context.fillStyle = gradient; context.fillRect(0, 0, 4, height);
  }));
  return texture;
}

/** A wall screen: a glowing panel whose content is redrawn with live numbers. */
export function screen(THREE: T, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = Math.round((640 * height) / width);
  const context = canvas.getContext("2d")!;
  const texture = canvasTexture(THREE, canvas);
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 6, height + 6, 3), new THREE.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 0.4, metalness: 0.6 }));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  panel.position.z = 1.6;
  group.add(frame, panel);
  const draw = (title: string, lines: Array<{ text: string; value?: string; color?: string }>, accent = "#22D3EE") => {
    const w = canvas.width, h = canvas.height;
    const gradient = context.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#071226"); gradient.addColorStop(1, "#140f33");
    context.fillStyle = gradient; context.fillRect(0, 0, w, h);
    context.strokeStyle = accent; context.globalAlpha = 0.6; context.lineWidth = 4; context.strokeRect(6, 6, w - 12, h - 12); context.globalAlpha = 1;
    context.fillStyle = accent; context.font = `700 ${Math.round(h * 0.13)}px ${FONT}`; context.textBaseline = "top";
    context.fillText(title, 28, 22);
    const lineHeight = (h - 22 - h * 0.2) / Math.max(1, lines.length);
    lines.forEach((line, index) => {
      const y = 22 + h * 0.2 + index * lineHeight;
      context.fillStyle = "#A5B4D4"; context.font = `600 ${Math.round(lineHeight * 0.36)}px ${FONT}`;
      context.fillText(line.text, 28, y + lineHeight * 0.1);
      if (line.value) { context.fillStyle = line.color ?? "#F8FAFF"; context.font = `700 ${Math.round(lineHeight * 0.55)}px ${FONT}`; context.textAlign = "right"; context.fillText(line.value, w - 28, y); context.textAlign = "left"; }
    });
    texture.needsUpdate = true;
  };
  return { group, draw };
}

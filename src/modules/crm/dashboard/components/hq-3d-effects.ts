import type * as Three from "three";
import { FONT, glow, label, type T } from "@/modules/crm/dashboard/components/hq-3d-draw";

// Live events in the 3D office (HireX HQ mức 3). Between two refreshes (one minute) the page compares the numbers
// and plays what happened, spread over the next half minute so the office feels alive:
//   a member got new unanswered messages → envelopes fly from Trạm tin nhắn to their desk;
//   a member's waiting count went down → a green tick rises over them (they replied);
//   new CVs today → files fly from the lobby into Kho CV;
//   new campaign replies → a small firework over Tháp phát sóng, and a reply bubble flies to whoever runs the campaign;
//   a new member (joined in the last days, or just added) → confetti and "Chào mừng" over their desk.

export type P3 = { x: number; y: number; z: number };
const INBOX: P3 = { x: -260, y: 62, z: -425 };
const LOBBY_DOOR: P3 = { x: -485, y: 34, z: -250 };
const CV_SHELVES: P3 = { x: 150, y: 44, z: -405 };
const TOWER_TOP: P3 = { x: -55, y: 96, z: -350 };

type Item = { start: number; begin: () => boolean; step: (t: number, delta: number) => void; duration: number; objects: Three.Object3D[] };
export interface Effects {
  envelope: (to: () => P3 | null, delay: number) => void;
  reply: (at: () => P3 | null, delay: number) => void;
  cv: (delay: number) => void;
  firework: (delay: number) => void;
  welcome: (at: () => P3 | null, name: string, delay: number) => void;
  campaignReply: (to: () => P3 | null, delay: number) => void;
  tick: (time: number, delta: number) => void;
  dispose: () => void;
}

function icon(THREE: T, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEffects(THREE: T, parent: Three.Object3D): Effects {
  const group = new THREE.Group();
  parent.add(group);
  const items: Item[] = [];
  let now = 0;

  const envelopeTexture = icon(THREE, (context) => {
    context.fillStyle = "#F8FAFF"; context.strokeStyle = "#0b1224"; context.lineWidth = 5;
    context.beginPath(); context.roundRect(14, 30, 100, 70, 10); context.fill(); context.stroke();
    context.beginPath(); context.moveTo(16, 34); context.lineTo(64, 72); context.lineTo(112, 34); context.stroke();
    context.fillStyle = "#FB7185"; context.beginPath(); context.arc(104, 32, 14, 0, Math.PI * 2); context.fill();
  });
  const fileTexture = icon(THREE, (context) => {
    context.fillStyle = "#E0F2FE"; context.strokeStyle = "#0b1224"; context.lineWidth = 5;
    context.beginPath(); context.moveTo(30, 12); context.lineTo(82, 12); context.lineTo(100, 30); context.lineTo(100, 116); context.lineTo(30, 116); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = "#22D3EE"; for (let line = 0; line < 4; line += 1) context.fillRect(42, 44 + line * 16, line === 3 ? 30 : 46, 6);
    context.font = `800 28px ${FONT}`; context.fillStyle = "#0e7490"; context.fillText("CV", 44, 36);
  });
  const bubbleTexture = icon(THREE, (context) => {
    context.fillStyle = "#A5B4FC"; context.strokeStyle = "#0b1224"; context.lineWidth = 5;
    context.beginPath(); context.roundRect(12, 18, 104, 72, 22); context.fill(); context.stroke();
    context.beginPath(); context.moveTo(34, 88); context.lineTo(26, 114); context.lineTo(56, 89); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = "#1e1b4b"; for (const x of [40, 64, 88]) { context.beginPath(); context.arc(x, 54, 8, 0, Math.PI * 2); context.fill(); }
  });
  const tickTexture = icon(THREE, (context) => {
    context.fillStyle = "#34D399"; context.beginPath(); context.arc(64, 64, 52, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#052e1c"; context.lineWidth = 14; context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); context.moveTo(38, 66); context.lineTo(57, 85); context.lineTo(92, 46); context.stroke();
  });
  const sprite = (texture: Three.Texture, size: number) => {
    const object = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
    object.scale.set(size, size, 1);
    object.renderOrder = 25;
    object.userData.keepTexture = true;
    return object;
  };
  const remove = (objects: Three.Object3D[]) => {
    for (const object of objects) {
      group.remove(object);
      const material = (object as Three.Sprite | Three.Points).material as Three.Material & { map?: Three.Texture | null };
      if (material) { if (material.map && !object.userData.keepTexture) material.map.dispose(); material.dispose(); }
      (object as Three.Points).geometry?.dispose?.();
    }
  };
  const arc = (from: P3, to: P3, t: number, height: number) => ({
    x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * height, z: from.z + (to.z - from.z) * t,
  });

  /** A flying icon from → to; on arrival a small pop and an optional "+1" label. */
  const fly = (texture: Three.Texture, from: () => P3 | null, to: () => P3 | null, delay: number, options: { size: number; height: number; duration: number; badge?: string; badgeColor?: string }) => {
    const item: Item = {
      start: now + delay, duration: options.duration + 0.9, objects: [],
      begin: () => {
        const a = from(), b = to();
        if (!a || !b) return false;
        const icon = sprite(texture, options.size);
        const halo = glow(THREE, 0xffffff, options.size * 2.2, 0.35);
        icon.add(halo);
        group.add(icon);
        item.objects.push(icon);
        let landed = false;
        item.step = (t) => {
          const flight = Math.min(1, (t * item.duration) / options.duration);
          const target = to() ?? b;
          if (flight < 1) {
            const point = arc(a, target, flight, options.height);
            icon.position.set(point.x, point.y, point.z);
            const scale = options.size * (0.7 + 0.3 * Math.sin(Math.PI * flight));
            icon.scale.set(scale, scale, 1);
            return;
          }
          if (!landed) {
            landed = true;
            if (options.badge) {
              const badge = label(THREE, options.badge, { height: 14, bg: options.badgeColor ?? "#FB7185", color: "#fff", border: "rgba(255,255,255,.6)" });
              badge.position.set(target.x, target.y + 18, target.z);
              group.add(badge);
              item.objects.push(badge);
            }
          }
          const after = (t * item.duration - options.duration) / 0.9;
          icon.scale.setScalar(options.size * (1 + after * 0.8));
          (icon.material as Three.SpriteMaterial).opacity = Math.max(0, 1 - after);
          const badge = item.objects[1] as Three.Sprite | undefined;
          if (badge) { badge.position.y = target.y + 18 + after * 14; badge.material.opacity = Math.max(0, 1 - after * 0.9); }
        };
        return true;
      },
      step: () => undefined,
    };
    items.push(item);
  };

  const envelope: Effects["envelope"] = (to, delay) => fly(envelopeTexture, () => INBOX, () => { const point = to(); return point ? { ...point, y: point.y + 62 } : null; }, delay, { size: 22, height: 90, duration: 2.6, badge: "+1 tin" });
  const campaignReply: Effects["campaignReply"] = (to, delay) => fly(bubbleTexture, () => TOWER_TOP, () => { const point = to(); return point ? { ...point, y: point.y + 62 } : null; }, delay, { size: 22, height: 110, duration: 2.8, badge: "+1 phản hồi", badgeColor: "#6366F1" });
  const cv: Effects["cv"] = (delay) => fly(fileTexture, () => LOBBY_DOOR, () => CV_SHELVES, delay, { size: 24, height: 120, duration: 3, badge: "+1 CV", badgeColor: "#0891B2" });

  const reply: Effects["reply"] = (at, delay) => {
    const item: Item = {
      start: now + delay, duration: 1.8, objects: [],
      begin: () => {
        const point = at();
        if (!point) return false;
        const check = sprite(tickTexture, 22);
        check.add(glow(THREE, 0x34d399, 40, 0.5));
        group.add(check);
        item.objects.push(check);
        item.step = (t) => {
          const p = at() ?? point;
          check.position.set(p.x, p.y + 70 + t * 34, p.z);
          (check.material as Three.SpriteMaterial).opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.6) / 0.4);
        };
        return true;
      },
      step: () => undefined,
    };
    items.push(item);
  };

  const burst = (delay: number, at: () => P3 | null, colours: number[], count: number, duration: number, title?: string) => {
    const item: Item = {
      start: now + delay, duration, objects: [],
      begin: () => {
        const origin = at();
        if (!origin) return false;
        const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), velocity: number[] = [];
        const palette = colours.map((colour) => new THREE.Color(colour));
        for (let index = 0; index < count; index += 1) {
          const theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1), speed = 40 + Math.random() * 40;
          velocity.push(Math.sin(phi) * Math.cos(theta) * speed, Math.cos(phi) * speed * 0.8 + 25, Math.sin(phi) * Math.sin(theta) * speed);
          const color = palette[index % palette.length];
          colors.set([color.r, color.g, color.b], index * 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 9, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        points.position.set(origin.x, origin.y + 10, origin.z);
        group.add(points);
        item.objects.push(points);
        const banner = title ? label(THREE, title, { height: 15, bg: "#FEF3C7", color: "#713f12", border: "rgba(251,191,36,1)" }) : null;
        if (banner) { banner.position.set(origin.x, origin.y + 40, origin.z); group.add(banner); item.objects.push(banner); }
        item.step = (t) => {
          if (banner) { banner.position.y = origin.y + 40 + t * 30; banner.material.opacity = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25); }
          const seconds = t * item.duration;
          for (let index = 0; index < count; index += 1) {
            positions[index * 3] = velocity[index * 3] * seconds;
            positions[index * 3 + 1] = velocity[index * 3 + 1] * seconds - 30 * seconds * seconds;
            positions[index * 3 + 2] = velocity[index * 3 + 2] * seconds;
          }
          geometry.attributes.position.needsUpdate = true;
          (points.material as Three.PointsMaterial).opacity = Math.max(0, 1 - t);
        };
        return true;
      },
      step: () => undefined,
    };
    items.push(item);
  };
  const firework: Effects["firework"] = (delay) => burst(delay, () => TOWER_TOP, [0xa5b4fc, 0x67e8f9, 0xf0abfc], 46, 1.8);
  const welcome: Effects["welcome"] = (at, name, delay) => burst(delay, () => { const point = at(); return point ? { ...point, y: point.y + 70 } : null; },
    [0xfbbf24, 0xf472b6, 0x34d399, 0x60a5fa, 0xffffff], 90, 3.2, `Chào mừng ${name}!`);

  const running = new Set<Item>();
  const tick: Effects["tick"] = (time, delta) => {
    now = time;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (time < item.start) continue;
      items.splice(index, 1);
      if (item.begin()) { item.start = time; running.add(item); }
    }
    for (const item of running) {
      const t = (time - item.start) / item.duration;
      if (t >= 1) { remove(item.objects); running.delete(item); continue; }
      item.step(t, delta);
    }
  };

  return {
    envelope, reply, cv, firework, welcome, campaignReply, tick,
    dispose: () => { for (const item of running) remove(item.objects); running.clear(); items.length = 0; parent.remove(group); envelopeTexture.dispose(); fileTexture.dispose(); tickTexture.dispose(); bubbleTexture.dispose(); },
  };
}

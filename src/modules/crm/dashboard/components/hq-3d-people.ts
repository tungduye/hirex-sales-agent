import type * as Three from "three";
import type { HqMember } from "@/modules/crm/dashboard/server/hq-data";
import { avatar, disposeTree, hashOf, label, seeded, type T } from "@/modules/crm/dashboard/components/hq-3d-draw";
import { CHARACTERS, COFFEE, CONNECTOR_X, CORRIDOR_A, S, type Kit, type P, type Slot, type World } from "@/modules/crm/dashboard/components/hq-3d-world";
import type { HqLayout } from "@/modules/crm/dashboard/core/hq-layout";

// The people of HireX HQ mức 3 (Kenney Mini Characters, CC0): each member sits at their desk (core/hq-layout.ts) and works.
// Only the people of the floor on screen are built; someone in a meeting is in Phòng họp on Tầng 1.
// Movement follows real data only: when someone's calendar event starts they walk to Phòng họp, and back afterwards.
// People with no activity occasionally take a coffee break in the pantry (decoration; their status ring stays true).

const WALK_SPEED = 62; // world units / second
const SIT_Y = 4.5, SIT_BACK = 4; // fine-tuning of the sitting pose on the desk chairs
const FEMALE_WORDS = new Set(["chị", "thị", "ngọc", "mai", "thu", "trang", "hoài", "linh", "hương", "lan", "vân", "cúc", "hà", "thảo", "nhung", "hằng", "huyền", "phương", "trinh", "yến", "nga", "hạnh", "hiền", "my", "vy", "nhi", "quỳnh", "ánh", "diệp", "giang", "loan", "oanh", "thúy", "thủy", "xuân", "hồng", "dung", "liên", "ly", "trâm", "uyên", "duyên", "ngân", "hiệp"]);
const looksFemale = (name: string) => name.toLocaleLowerCase("vi").split(/[^\p{L}]+/u).some((word) => FEMALE_WORDS.has(word));
const route = (fromX: number, fromZ: number, toX: number, toZ: number): P[] =>
  fromZ === toZ ? [{ x: toX, z: toZ }] : [{ x: CONNECTOR_X, z: fromZ }, { x: CONNECTOR_X, z: toZ }, { x: toX, z: toZ }];
const last = (points: P[]) => points[points.length - 1];

interface Actor {
  id: string; person: HqMember; root: Three.Group; mixer: Three.AnimationMixer | null; actions: Map<string, Three.AnimationAction>; current: Three.AnimationAction | null;
  slot: Slot; labels: Three.Group; bubble: Three.Sprite | null; head: Three.Sprite;
  state: "sit" | "walk" | "coffee"; path: P[]; arrive: (() => void) | null; until: number; nextBreak: number; random: () => number;
}

export interface People {
  sync: (team: HqMember[], time: number) => void; tick: (time: number, delta: number) => void; pickables: () => Three.Object3D[]; dispose: () => void;
  /** Where a member is right now (at the desk, walking, in the meeting), or null when they have no seat. */
  positionOf: (id: string) => { x: number; y: number; z: number } | null;
  /** A phỏng vấn is running: a candidate sits in Phòng họp (Tầng 1) with the event's title; null = nobody. */
  setGuest: (title: string | null) => void;
}

export function createPeople(THREE: T, parent: Three.Object3D, kit: Kit, world: World, layout: HqLayout, cloneSkinned: (object: Three.Object3D) => Three.Object3D): People {
  const actors = new Map<string, Actor>();
  const group = new THREE.Group();
  parent.add(group);
  let picks: Three.Object3D[] = [];
  let topId: string | null = null; // most campaign replies: a cup over their head (Tường vinh danh shows the list)
  let now = 0;

  const play = (actor: Actor, name: string) => {
    const next = actor.actions.get(name);
    if (!next || next === actor.current) return;
    next.reset().fadeIn(0.3).play();
    actor.current?.fadeOut(0.3);
    actor.current = next;
  };

  const seat = (actor: Actor, slot: Slot) => {
    actor.slot = slot;
    actor.state = "sit"; actor.path = []; actor.arrive = null;
    const back = slot.room === "meeting" ? 0 : SIT_BACK;
    actor.root.position.set(slot.sit.x - Math.sin(slot.facing) * back, SIT_Y, slot.sit.z - Math.cos(slot.facing) * back);
    actor.root.rotation.y = slot.facing;
    play(actor, "sit");
  };

  const walk = (actor: Actor, path: P[], arrive: () => void) => {
    actor.state = "walk"; actor.path = path.slice(); actor.arrive = arrive;
    actor.root.position.y = 0;
    play(actor, "walk");
  };

  const paintLabels = (actor: Actor) => {
    while (actor.labels.children.length) { const child = actor.labels.children[0]; actor.labels.remove(child); disposeTree(child); }
    const person = actor.person;
    const head = avatar(THREE, person, 24);
    head.position.y = 74;
    head.userData.pick = { title: `${person.name}${person.department ? ` · ${person.department}` : ""}`, sub: `${person.doing} · bấm để xem`, href: null, personId: person.id };
    const text = person.tone === "alert" ? `${person.name} · ${person.waiting.toLocaleString("vi-VN")} chờ` : person.name;
    const tag = label(THREE, text.length > 24 ? `${text.slice(0, 23)}…` : text, { height: 11, border: person.tone === "alert" ? "rgba(244,63,94,.85)" : undefined });
    tag.position.y = 91;
    actor.labels.add(head, tag);
    if (person.id === topId) {
      const cupTag = label(THREE, "🏆 Nhiều phản hồi nhất", { height: 11, bg: "#FEF3C7", color: "#713f12", border: "rgba(251,191,36,1)" });
      cupTag.position.y = person.tone === "busy" ? 119 : 105;
      actor.labels.add(cupTag);
    }
    if (person.isNew) {
      const welcome = label(THREE, "🎉 Thành viên mới", { height: 11, bg: "#FEF3C7", color: "#713f12", border: "rgba(251,191,36,1)" });
      welcome.position.y = (person.tone === "busy" ? 119 : 105) + (person.id === topId ? 14 : 0);
      actor.labels.add(welcome);
    }
    actor.head = head;
    actor.bubble = null;
    if (person.tone === "busy") {
      const bubble = label(THREE, "Đang nhắn…", { height: 11, bg: "#E0F2FE", color: "#082f49", border: "rgba(224,242,254,1)" });
      bubble.position.y = 105;
      actor.labels.add(bubble);
      actor.bubble = bubble;
    }
  };

  const create = (person: HqMember, slot: Slot, time: number): Actor => {
    const pool = CHARACTERS.filter((name) => name.startsWith(looksFemale(person.name) ? "female" : "male"));
    const gltf = kit.characters.get(pool[hashOf(person.id) % pool.length]) ?? kit.characters.values().next().value ?? null;
    const root = new THREE.Group();
    let mixer: Three.AnimationMixer | null = null;
    const actions = new Map<string, Three.AnimationAction>();
    if (gltf) {
      const model = cloneSkinned(gltf.scene);
      model.scale.setScalar(S);
      root.add(model);
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      model.traverse((child) => { child.userData.sharedGeometry = true; child.userData.sharedMaterial = true; });
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(7, 18, 4, 12), new THREE.MeshStandardMaterial({ color: 0x334155 }));
      body.position.y = 17; root.add(body);
    }
    const labels = new THREE.Group();
    root.add(labels);
    group.add(root);
    const random = seeded(hashOf(person.id) + Math.floor(time));
    const actor: Actor = { id: person.id, person, root, mixer, actions, current: null, slot, labels, bubble: null, head: null as unknown as Three.Sprite, state: "sit", path: [], arrive: null, until: 0, nextBreak: time + 15 + random() * 60, random };
    paintLabels(actor);
    seat(actor, slot);
    return actor;
  };

  const remove = (actor: Actor) => {
    actor.mixer?.stopAllAction();
    group.remove(actor.root);
    disposeTree(actor.labels);
    actors.delete(actor.id);
  };

  /** From a seat out to the corridor, along the corridors, and in to another seat. */
  const between = (from: Slot, to: Slot): P[] => {
    const out = from.toCorridor, back = to.toCorridor.slice().reverse();
    return [...out, ...route(last(out).x, from.corridorZ, back[0].x, to.corridorZ), ...back.slice(1), to.sit];
  };

  const sync: People["sync"] = (team, time) => {
    topId = team.filter((person) => person.campaignReplies > 0).sort((a, b) => b.campaignReplies - a.campaignReplies || a.name.localeCompare(b.name, "vi"))[0]?.id ?? null;
    const wanted = new Map<string, { person: HqMember; slot: Slot }>();
    const byName = (a: HqMember, b: HqMember) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);
    // In a meeting: Phòng họp (Tầng 1); otherwise their own desk, when it is on this floor.
    team.filter((person) => person.meeting).sort(byName).slice(0, world.meetingSeats.length).forEach((person, index) => wanted.set(person.id, { person, slot: world.meetingSeats[index] }));
    for (const person of team) {
      if (wanted.has(person.id) || (person.meeting && world.level !== 0)) continue;
      const seat = layout.seatOf[person.id];
      const slot = seat && seat.level === world.level ? world.slots.get(seat.seat) : undefined;
      if (slot) wanted.set(person.id, { person, slot });
    }
    for (const actor of [...actors.values()]) if (!wanted.has(actor.id)) remove(actor);
    for (const { person, slot } of wanted.values()) {
      const actor = actors.get(person.id);
      if (!actor) { actors.set(person.id, create(person, slot, time)); continue; }
      actor.person = person;
      paintLabels(actor);
      if (actor.slot.key !== slot.key) {
        // Real movement (e.g. a meeting starts): walk there; mid-walk people just take the new seat.
        if (actor.state === "sit") { const from = actor.slot; walk(actor, between(from, slot), () => seat(actor, slot)); actor.slot = slot; }
        else seat(actor, slot);
      }
    }
    picks = [...actors.values()].map((actor) => actor.head);
    // Screens light up for people at work; ≥100 waiting → the screen blinks red (see tick).
    for (const slot of world.slots.values()) if (slot.screenGlow) (slot.screenGlow.material as Three.MeshBasicMaterial).opacity = 0;
    for (const actor of actors.values()) {
      const glowMaterial = actor.slot.screenGlow?.material as Three.MeshBasicMaterial | undefined;
      if (!glowMaterial) continue;
      glowMaterial.color.setHex(actor.person.tone === "alert" ? 0xfb7185 : 0x67e8f9);
      glowMaterial.opacity = actor.person.tone === "idle" ? 0 : 0.75;
    }
  };

  // The candidate of a running interview (decoration from the calendar; not a member).
  let guest: { root: Three.Group; mixer: Three.AnimationMixer | null; labels: Three.Group } | null = null;
  let guestTitle: string | null = null;
  const setGuest: People["setGuest"] = (title) => {
    if (title === guestTitle) return;
    guestTitle = title;
    if (guest) { guest.mixer?.stopAllAction(); group.remove(guest.root); disposeTree(guest.labels); guest = null; }
    const seatSlot = world.meetingSeats[world.meetingSeats.length - 1];
    if (!title || !seatSlot || [...actors.values()].some((actor) => actor.slot.key === seatSlot.key)) return;
    const gltf = kit.characters.get("male-c") ?? kit.characters.values().next().value ?? null;
    const root = new THREE.Group();
    let mixer: Three.AnimationMixer | null = null;
    if (gltf) {
      const model = cloneSkinned(gltf.scene);
      model.scale.setScalar(S);
      model.traverse((child) => { child.userData.sharedGeometry = true; child.userData.sharedMaterial = true; });
      root.add(model);
      mixer = new THREE.AnimationMixer(model);
      const sit = gltf.animations.find((clip) => clip.name === "sit");
      if (sit) mixer.clipAction(sit).play();
    }
    const labels = new THREE.Group();
    const tag = label(THREE, `Ứng viên · ${title.length > 26 ? `${title.slice(0, 25)}…` : title}`, { height: 11, bg: "#EDE9FE", color: "#3b0764", border: "rgba(167,139,250,1)" });
    tag.position.y = 91; labels.add(tag); root.add(labels);
    root.position.set(seatSlot.sit.x, SIT_Y, seatSlot.sit.z); root.rotation.y = seatSlot.facing;
    group.add(root);
    guest = { root, mixer, labels };
  };

  const tick: People["tick"] = (time, delta) => {
    now = time;
    guest?.mixer?.update(delta);
    let walkers = 0;
    for (const actor of actors.values()) if (actor.state !== "sit") walkers += 1;
    for (const actor of actors.values()) {
      actor.mixer?.update(delta);
      if (actor.person.tone === "alert" && actor.slot.screenGlow) (actor.slot.screenGlow.material as Three.MeshBasicMaterial).opacity = 0.35 + 0.5 * Math.abs(Math.sin(time * 3));
      if (actor.bubble) actor.bubble.position.y = 105 + Math.sin(time * 3 + actor.root.position.x) * 1.5;
      if (actor.state === "walk") {
        const target = actor.path[0];
        if (!target) { const done = actor.arrive; actor.arrive = null; done?.(); continue; }
        const dx = target.x - actor.root.position.x, dz = target.z - actor.root.position.z, distance = Math.hypot(dx, dz);
        const step = WALK_SPEED * Math.min(delta, 0.1);
        if (distance <= step) { actor.root.position.x = target.x; actor.root.position.z = target.z; actor.path.shift(); }
        else { actor.root.position.x += (dx / distance) * step; actor.root.position.z += (dz / distance) * step; }
        if (distance > 0.5) { const goal = Math.atan2(dx, dz); let turn = goal - actor.root.rotation.y; turn = Math.atan2(Math.sin(turn), Math.cos(turn)); actor.root.rotation.y += turn * Math.min(1, delta * 10); }
        continue;
      }
      if (actor.state === "coffee") {
        if (time >= actor.until) {
          const slot = actor.slot, out = slot.toCorridor;
          walk(actor, [{ x: COFFEE.x, z: CORRIDOR_A }, ...route(COFFEE.x, CORRIDOR_A, last(out).x, slot.corridorZ), ...out.slice().reverse().slice(1), slot.sit],
            () => { seat(actor, slot); actor.nextBreak = now + 60 + actor.random() * 150; });
        }
        continue;
      }
      // Seated: people without activity sometimes go for a coffee (never more than two at once).
      if (actor.person.tone === "idle" && actor.slot.room !== "meeting" && time >= actor.nextBreak) {
        if (walkers >= 2) { actor.nextBreak = time + 10 + actor.random() * 30; continue; }
        walkers += 1;
        const slot = actor.slot, out = slot.toCorridor;
        walk(actor, [...out, ...route(last(out).x, slot.corridorZ, COFFEE.x, CORRIDOR_A), COFFEE], () => {
          actor.state = "coffee"; actor.until = now + 6; actor.root.rotation.y = Math.PI;
          play(actor, actor.actions.has("interact-right") ? "interact-right" : "idle");
        });
      }
    }
  };

  const positionOf: People["positionOf"] = (id) => { const actor = actors.get(id); return actor ? { x: actor.root.position.x, y: 0, z: actor.root.position.z } : null; };

  return { sync, tick, positionOf, setGuest, pickables: () => picks, dispose: () => { setGuest(null); for (const actor of [...actors.values()]) remove(actor); parent.remove(group); } };
}

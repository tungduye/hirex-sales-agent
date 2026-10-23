// HireX HQ: the office plan, made from the people in it (no Three.js here, so it can be tested and used by 2.5D and 3D).
//   * Every Bộ phận gets a room (Rec, Sale, AM, AI Chat, NB, then any other bộ phận), then Phòng Giám đốc and
//     Khu chung (people with no bộ phận). CTV has no room. A new member adds a desk, a new bộ phận adds a room.
//   * Desks come in pods of four (2 × 2); inside a room people sit together by Thị trường (IT, IT JP, Khác).
//   * Rooms are packed in rows between corridors; when a floor is full, the next rooms go up to a new floor.
// Units are the 3D world units (the old fixed plan used the same frame: north strip at z −440…−260, corridor −225).

export type P = { x: number; z: number };
export type RoomKind = "dept" | "boss" | "common" | "meeting" | "ai";
export interface LayoutMember { id: string; name: string; department: string | null; market: string | null }
export interface LayoutSeat { key: string; x: number; deskZ: number; sit: P; facing: number; toCorridor: P[]; memberId: string | null; market: string | null }
export interface LayoutZone { market: string; label: string; x0: number; z0: number; x1: number; z1: number; first: boolean }
export interface LayoutRoom {
  key: string; name: string; kind: RoomKind; level: number; x0: number; z0: number; x1: number; z1: number;
  /** x of the door in the north wall, and the corridor it opens on. */
  door: number; corridorZ: number; seats: LayoutSeat[]; zones: LayoutZone[]; members: number;
}
export interface LayoutFloor { level: number; name: string; rooms: LayoutRoom[]; corridors: number[]; plate: { x0: number; z0: number; x1: number; z1: number } }
export interface HqLayout { floors: LayoutFloor[]; seatOf: Record<string, { level: number; room: string; seat: string }>; key: string }

export const NORTH_STRIP = {
  soda: { x0: -600, z0: -440, x1: -370, z1: -260, door: -485 },
  inbox: { x0: -355, z0: -440, x1: -165, z1: -260, door: -260 },
  tower: { x0: -150, z0: -440, x1: 40, z1: -260, door: -55 },
  cv: { x0: 55, z0: -440, x1: 245, z1: -260, door: 150 },
} as const;
export const FIRST_CORRIDOR = -225;
export const CONNECTOR_X = 440;
export const COFFEE: P = { x: 430, z: -340 };
const WORK_X0 = -600, WORK_X1 = 400, GAP = 15, CORRIDOR = 70, ROW_TOP = FIRST_CORRIDOR + CORRIDOR / 2;
const MAX_DEPTH = 1440; // rows of one floor: from z −190 down to about z 1250
const DESK_DX = 90, DESK_DZ = 130, POD = 4;

export const fold = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/giu, "d").toLowerCase().trim();
const KNOWN = [
  { key: "rec", name: "Phòng Rec", test: /\brec\b|tuyen dung|recruit/u },
  { key: "sale", name: "Phòng Sale", test: /\bsales?\b|kinh doanh/u },
  { key: "am", name: "Phòng AM", test: /\bam\b|account manager/u },
  { key: "ai-chat", name: "Phòng AI Chat", test: /\bai ?chat\b/u },
  { key: "nb", name: "Phòng NB", test: /\bnb\b/u },
] as const;
const BOSS = /\b(ceo|giam doc|director|founder|chu tich)\b/u;
const HIDDEN = /\b(ctv|cong tac vien|collaborator)\b/u;
const MARKETS = [["IT", "IT"], ["IT_JP", "IT JP"], ["OTHER", "Khác"]] as const;

/** Which room a member of this bộ phận sits in: "rec", "sale", …, "boss", "common", "x-<tên>" for another bộ phận, null = no room (CTV). */
export function roomOfDepartment(department: string | null | undefined): string | null {
  const value = fold(department);
  if (!value) return "common";
  if (HIDDEN.test(value)) return null;
  if (BOSS.test(value)) return "boss";
  const known = KNOWN.find((item) => item.test.test(value));
  if (known) return known.key;
  return `x-${value.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "khac"}`;
}

/** Room name as shown (Phòng Rec, Phòng Giám đốc, Khu chung, Phòng <bộ phận>). */
export function roomName(key: string, department?: string | null): string {
  if (key === "boss") return "Phòng Giám đốc";
  if (key === "common") return "Khu chung";
  if (key === "meeting") return "Phòng họp";
  if (key === "ai") return "Bàn AI Recruiter";
  return KNOWN.find((item) => item.key === key)?.name ?? `Phòng ${(department ?? key.replace(/^x-/u, "")).trim()}`;
}

const marketKey = (market: string | null | undefined) => market === "IT" || market === "IT_JP" ? market : "OTHER";
const byName = (a: LayoutMember, b: LayoutMember) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);

interface Item { key: string; w: number; d: number; place: (x0: number, z0: number, corridorZ: number, level: number) => LayoutRoom }

/** A room of desk pods; members sit together by market (IT, IT JP, Khác), each desk tinted by its market. */
function podRoom(key: string, name: string, kind: "dept" | "common", members: LayoutMember[]): Item {
  const groups = MARKETS.map(([market, label]) => ({ market, label, people: members.filter((person) => marketKey(person.market) === market).sort(byName) })).filter((group) => group.people.length);
  const ordered = groups.flatMap((group) => group.people.map((person, index) => ({ person, market: group.market, label: group.label, first: index === 0 })));
  const podCount = Math.max(1, Math.ceil(ordered.length / POD));
  const across = Math.min(podCount, 5), podRows = Math.ceil(podCount / across);
  const cols = across * 2, w = cols * DESK_DX + 80, d = podRows * 2 * DESK_DZ + 40;
  const showZones = kind === "dept" && (groups.length > 1 || groups[0]?.market !== "OTHER");
  return {
    key, w, d,
    place: (x0, z0, corridorZ, level) => {
      const x1 = x0 + w, door = x1 - 40;
      const seats: LayoutSeat[] = [], zones: LayoutZone[] = [];
      for (let index = 0; index < podCount * POD; index += 1) {
        const pod = Math.floor(index / POD), slot = index % POD;
        const col = (pod % across) * 2 + (slot % 2), row = Math.floor(pod / across) * 2 + Math.floor(slot / 2);
        const x = x0 + 50 + col * DESK_DX, deskZ = z0 + 50 + row * DESK_DZ;
        const chairZ = deskZ + 36, aisle = chairZ + 30;
        const sitter = ordered[index];
        seats.push({ key: `${key}-${pod}-${slot}`, x, deskZ, sit: { x, z: chairZ + 2 }, facing: Math.PI, memberId: sitter?.person.id ?? null, market: sitter?.market ?? null,
          toCorridor: [{ x, z: chairZ + 22 }, { x, z: aisle }, { x: door, z: aisle }, { x: door, z: corridorZ }] });
        if (showZones && sitter) zones.push({ market: sitter.market, label: sitter.label, x0: x - 44, z0: deskZ - 28, x1: x + 44, z1: deskZ + 72, first: sitter.first });
      }
      return { key, name, kind, level, x0, z0, x1, z1: z0 + d, door, corridorZ, seats, zones, members: members.length };
    },
  };
}

/** Phòng Giám đốc: one large desk each, a sofa corner at the back. */
function bossRoom(members: LayoutMember[]): Item {
  const people = members.slice().sort(byName);
  const w = Math.max(270, people.length * 120 + 110), d = 300;
  return {
    key: "boss", w, d,
    place: (x0, z0, corridorZ, level) => {
      const x1 = x0 + w, door = x1 - 40;
      const seats = people.map((person, index): LayoutSeat => {
        const x = x0 + 70 + index * 120, deskZ = z0 + 70, chairZ = deskZ + 36, aisle = chairZ + 34;
        return { key: `boss-${index}`, x, deskZ, sit: { x, z: chairZ + 2 }, facing: Math.PI, memberId: person.id, market: null, toCorridor: [{ x, z: chairZ + 22 }, { x, z: aisle }, { x: door, z: aisle }, { x: door, z: corridorZ }] };
      });
      return { key: "boss", name: roomName("boss"), kind: "boss", level, x0, z0, x1, z1: z0 + d, door, corridorZ, seats, zones: [], members: people.length };
    },
  };
}

/** Phòng họp: a round table with eight chairs; people come here while a calendar event runs. */
function meetingRoom(): Item {
  const w = 290, d = 300;
  return {
    key: "meeting", w, d,
    place: (x0, z0, corridorZ, level) => {
      const x1 = x0 + w, cx = x0 + w / 2, cz = z0 + d / 2 + 10, door = cx;
      const seats = Array.from({ length: 8 }, (_, index): LayoutSeat => {
        const angle = (index / 8) * Math.PI * 2;
        const x = cx + Math.cos(angle) * 78, z = cz + Math.sin(angle) * 78;
        const outX = x < cx ? x0 + 25 : x1 - 25;
        return { key: `meeting-${index}`, x, deskZ: z, sit: { x, z }, facing: Math.atan2(cx - x, cz - z), memberId: null, market: null,
          toCorridor: [{ x: outX, z }, { x: outX, z: z0 + 30 }, { x: door, z: z0 + 30 }, { x: door, z: corridorZ }] };
      });
      return { key: "meeting", name: roomName("meeting"), kind: "meeting", level, x0, z0, x1, z1: z0 + d, door, corridorZ, seats, zones: [], members: 0 };
    },
  };
}

function aiRoom(): Item {
  const w = 230, d = 300;
  return { key: "ai", w, d, place: (x0, z0, corridorZ, level) => ({ key: "ai", name: roomName("ai"), kind: "ai", level, x0, z0, x1: x0 + w, z1: z0 + d, door: x0 + w / 2, corridorZ, seats: [], zones: [], members: 0 }) };
}

type Row = { items: Item[]; width: number; depth: number };
const rowsDepth = (rows: Row[]) => rows.reduce((sum, row) => sum + row.depth, 0) + CORRIDOR * Math.max(0, rows.length - 1);

/** The whole office for these members: floors, rooms, desks and who sits where. */
export function buildHqLayout(members: LayoutMember[]): HqLayout {
  const byRoom = new Map<string, { department: string | null; people: LayoutMember[] }>();
  for (const person of members) {
    const key = roomOfDepartment(person.department);
    if (!key) continue;
    const entry = byRoom.get(key) ?? { department: person.department?.trim() || null, people: [] };
    entry.people.push(person);
    byRoom.set(key, entry);
  }
  const order = [...KNOWN.map((item) => item.key), ...[...byRoom.keys()].filter((key) => key.startsWith("x-")).sort(), "boss", "common"];
  const items: Item[] = order.flatMap((key) => {
    const entry = byRoom.get(key);
    if (!entry?.people.length) return [];
    if (key === "boss") return [bossRoom(entry.people)];
    return [podRoom(key, roomName(key, entry.department), key === "common" ? "common" : "dept", entry.people)];
  });

  // Floor 1 always keeps Phòng họp and the AI desk in its last row; rooms fill rows first-fit, then go up a floor.
  const floors: Row[][] = [[{ items: [meetingRoom(), aiRoom()], width: 290 + GAP + 230, depth: 300 }]];
  const fixedRow = floors[0][0];
  for (const item of items) {
    let rows = floors[floors.length - 1];
    // The meeting row takes small rooms only once the floor has a row of its own (Rec stays at the front).
    const fits = (row: Row) => (row !== fixedRow || rows.length > 1) && row.width + GAP + item.w <= WORK_X1 - WORK_X0 && rowsDepth(rows.map((other) => other === row ? { ...row, depth: Math.max(row.depth, item.d) } : other)) <= MAX_DEPTH;
    const row = rows.find(fits);
    if (row) { row.items.push(item); row.width += GAP + item.w; row.depth = Math.max(row.depth, item.d); continue; }
    const fresh: Row = { items: [item], width: item.w, depth: item.d };
    const withRow = rows.includes(fixedRow) ? [...rows.slice(0, -1), fresh, fixedRow] : [...rows, fresh];
    const hasPeople = rows.some((other) => other !== fixedRow);
    if (rowsDepth(withRow) <= MAX_DEPTH || !hasPeople) { rows.splice(0, rows.length, ...withRow); continue; }
    rows = [fresh];
    floors.push(rows);
  }

  const seatOf: HqLayout["seatOf"] = {};
  const result: LayoutFloor[] = floors.map((rows, level) => {
    const rooms: LayoutRoom[] = [], corridors = [FIRST_CORRIDOR];
    let top = ROW_TOP;
    for (const row of rows) {
      let x = WORK_X0;
      for (const item of row.items) { rooms.push(item.place(x, top, top - CORRIDOR / 2, level)); x += item.w + GAP; }
      top += row.depth + CORRIDOR;
      corridors.push(top - CORRIDOR / 2);
    }
    corridors.pop();
    for (const room of rooms) for (const seat of room.seats) if (seat.memberId) seatOf[seat.memberId] = { level, room: room.key, seat: seat.key };
    const bottom = Math.max(...rooms.map((room) => room.z1));
    const names = rooms.filter((room) => room.kind === "dept" || room.kind === "boss" || room.kind === "common").map((room) => room.name.replace(/^Phòng /u, ""));
    return { level, name: level === 0 ? "Tầng 1 · Sảnh" : `Tầng ${level + 1} · ${names.join(", ")}`, rooms, corridors, plate: { x0: -650, z0: -490, x1: 650, z1: Math.max(490, bottom + 50) } };
  });
  const key = result.map((floor) => floor.rooms.map((room) => `${room.key}@${room.x0},${room.z0},${room.x1},${room.z1}#${room.seats.length}`).join("|")).join("/");
  return { floors: result, seatOf, key };
}

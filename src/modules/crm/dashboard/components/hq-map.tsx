"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import { NORTH_STRIP, type HqLayout, type LayoutRoom } from "@/modules/crm/dashboard/core/hq-layout";
import styles from "@/modules/crm/dashboard/components/hq.module.css";

// HireX HQ, mức 2: the 2.5D office. The same plan as 3D (core/hq-layout.ts): one room per bộ phận on a tilted floor,
// people at their desks, in Phòng họp while a calendar event is running. Avatars stand upright (counter-rotated) so names stay readable.
// Picking a room or a person opens its summary on the same screen (HqStage), never another page.

/** What is picked on the map: a room (its summary) or a member (their card). */
export type HqSelection = { type: "room"; key: string } | { type: "person"; id: string } | null;

// 2.5D or 3D (mức 3), remembered in this browser. 3D by default; the server always renders 2.5D first.
export type HqViewMode = "2d" | "3d";
const VIEW_KEY = "hirex_hq_view";
const viewListeners = new Set<() => void>();
const subscribeView = (notify: () => void) => { viewListeners.add(notify); window.addEventListener("storage", notify); return () => { viewListeners.delete(notify); window.removeEventListener("storage", notify); }; };
const readView = (): HqViewMode => { try { return window.localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d"; } catch { return "3d"; } };
const serverView = (): HqViewMode => "2d";
export const saveHqView = (view: HqViewMode) => { try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable: keeps 3D */ } viewListeners.forEach((notify) => notify()); };
export const useHqView = () => useSyncExternalStore(subscribeView, readView, serverView);

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
// World units (core/hq-layout.ts) → pixels on the tilted floor.
const K = 0.78, X0 = -615, Z0 = -455, X1 = 415;
const ROTATIONS = [-45, 45, 135, 225];
const ZOOMS = [0.7, 0.85, 1, 1.15, 1.3, 1.5];
type Box = { left: number; top: number; width: number; height: number };
const boxOf = (room: { x0: number; z0: number; x1: number; z1: number }): Box => ({ left: (room.x0 - X0) * K, top: (room.z0 - Z0) * K, width: (room.x1 - room.x0) * K, height: (room.z1 - room.z0) * K });
const MARKET_TINT: Record<string, string> = { IT: "rgba(8,145,178,.16)", IT_JP: "rgba(219,39,119,.15)", OTHER: "rgba(100,116,139,.14)" };
const ROOM_TONE = { cyan: null, red: styles.roomHot, violet: styles.roomVioletMap, green: styles.roomGreenMap } as const;
const RING = { busy: null, alert: styles.rRed, meet: styles.rViolet, idle: styles.rGrey } as const;
const AV_COLORS = ["#A5F3FC", "#C7D2FE", "#BAE6FD", "#DDD6FE", "#99F6E4", "#E0E7FF", "#FBCFE8", "#FDE68A"];
const avatarColor = (id: string) => AV_COLORS[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % AV_COLORS.length];
const n = (value: number | null) => value === null ? "—" : value.toLocaleString("vi-VN");

/** A stack (bubble, avatar, name) standing on the floor point (left, top). */
function Upright({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return <div className={styles.up} style={{ left, top }}>{children}</div>;
}

export function HqAvatar({ person, size = 30 }: { person: Pick<HqMember, "id" | "name" | "initials" | "avatarUrl" | "tone">; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cx(styles.mapAv, RING[person.tone])} style={{ width: size, height: size, background: avatarColor(person.id) }}>
      {person.avatarUrl && !broken
        // eslint-disable-next-line @next/next/no-img-element -- any https image link the admin pastes; no optimisation needed
        ? <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : person.initials}
    </span>
  );
}

function Person({ person, left, top, onPick }: { person: HqMember; left: number; top: number; onPick: (id: string) => void }) {
  const label = person.tone === "alert" ? `${person.name} · ${person.waiting.toLocaleString("vi-VN")} chờ` : person.name;
  return (
    <Upright left={left} top={top}>
      {person.tone === "busy" ? <span className={styles.bubble}>Đang nhắn</span> : null}
      <button type="button" className={styles.avButton} onClick={(event) => { event.stopPropagation(); onPick(person.id); }} title={`${person.name}${person.department ? ` (${person.department})` : ""}\n${person.doing}`}><HqAvatar person={person} /></button>
      <span className={cx(styles.tag, styles.tagName, person.tone === "alert" && styles.tagRed)}>{label}</span>
    </Upright>
  );
}

/** The desks of a room from the plan; a member sits at theirs unless they are in a meeting. */
function Seats({ room, team, onPick }: { room: LayoutRoom; team: Map<string, HqMember>; onPick: (id: string) => void }) {
  return (
    <>
      {room.zones.map((zone, index) => (
        <div key={`z${index}`} className={styles.zone} style={{ left: (zone.x0 - room.x0) * K, top: (zone.z0 - room.z0) * K, width: (zone.x1 - zone.x0) * K, height: (zone.z1 - zone.z0) * K, background: MARKET_TINT[zone.market] }}>
          {zone.first ? <span>{zone.label}</span> : null}
        </div>
      ))}
      {room.seats.map((seat) => {
        const person = seat.memberId ? team.get(seat.memberId) : undefined;
        const here = person && !person.meeting ? person : undefined;
        const left = (seat.x - room.x0) * K, top = (seat.deskZ - room.z0) * K;
        return <div key={seat.key} className={cx(styles.desk, room.kind === "boss" && styles.deskBoss, here && here.tone !== "idle" && styles.deskOn)} style={{ left: left - 17, top: top - 6 }} />;
      })}
      {room.seats.map((seat) => {
        const person = seat.memberId ? team.get(seat.memberId) : undefined;
        if (!person || person.meeting) return null;
        return <Person key={person.id} person={person} left={(seat.x - room.x0) * K} top={(seat.sit.z - room.z0) * K} onPick={onPick} />;
      })}
    </>
  );
}

const BOT_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06111f" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></svg>;

export function HqMap2D({ rooms, team, stats, floor, layout, level, selected, onSelect }: { rooms: HqRoom[]; team: HqMember[]; stats: HqStats; floor: HqFloor; layout: HqLayout; level: number; selected: HqSelection; onSelect: (selection: HqSelection) => void }) {
  const plan = layout.floors[Math.min(level, layout.floors.length - 1)];
  const bottom = Math.max(...plan.rooms.map((room) => room.z1)) + 15;
  const SCENE_W = (X1 - X0) * K, SCENE_H = (bottom - Z0) * K, BASE_W = SCENE_W * 1.36, BASE_H = SCENE_H * 0.9;
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const measure = () => setFit(Math.max(0.35, Math.min(1.6, element.clientWidth / BASE_W, element.clientHeight / BASE_H)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [BASE_W, BASE_H]);
  const scale = fit * ZOOMS[zoom];
  const rz = ROTATIONS[turn];
  const byKey = new Map(rooms.map((room) => [room.key, room]));
  const people = new Map(team.map((person) => [person.id, person]));
  const meeting = team.filter((person) => person.meeting).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const focus = floor === "ALL" ? null : floor;
  const picked = selected?.type === "room" ? selected.key : null;
  const pickPerson = (id: string) => onSelect({ type: "person", id });

  const room = (key: string, box: Box, content: ReactNode, peopleRoom = false) => {
    const info = byKey.get(key);
    if (!info) return null;
    return (
      <div key={key} role="button" tabIndex={0} aria-label={`${info.name}: ${info.meta}`} onClick={() => onSelect({ type: "room", key })}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect({ type: "room", key }); } }}
        className={cx(styles.mapRoom, ROOM_TONE[info.tone], (focus === key || picked === key) && styles.mapRoomFocus, focus && focus !== key && peopleRoom && styles.mapRoomDim)}
        style={box}>
        {content}
        <span className={styles.rname}>{info.name}</span>
      </div>
    );
  };
  const centre = (box: Box) => ({ left: box.width / 2, top: box.height * 0.62 });
  const north = (key: keyof typeof NORTH_STRIP) => boxOf(NORTH_STRIP[key]);

  // The scene turns and scales around its centre, placed a little below the canvas centre (avatars stand above the floor).
  const sceneStyle = { width: SCENE_W, height: SCENE_H, left: (BASE_W * scale - SCENE_W) / 2, top: (BASE_H * scale - SCENE_H) / 2 + 12 * scale, "--rz": `${rz}deg`, "--s": scale } as CSSProperties;
  return (
    <div className={styles.map2dWrap}>
      <div className={styles.stageTools}>
        <button type="button" onClick={() => setZoom((value) => Math.min(ZOOMS.length - 1, value + 1))} aria-label="Phóng to" disabled={zoom === ZOOMS.length - 1}>+</button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0, value - 1))} aria-label="Thu nhỏ" disabled={zoom === 0}>−</button>
        <button type="button" onClick={() => setTurn((value) => (value + 1) % ROTATIONS.length)} aria-label="Xoay bản đồ">⟳</button>
      </div>
      <div ref={holder} className={styles.map2dScroll}>
        <div className={styles.mapCanvas} style={{ width: BASE_W * scale, height: BASE_H * scale }}>
          <div className={styles.scene} style={sceneStyle}>
            {plan.level === 0 ? <>
              {room("soda", north("soda"), <>
                <div className={cx(styles.desk, styles.deskOn)} style={{ left: centre(north("soda")).left - 17, top: centre(north("soda")).top }} />
                <Upright {...centre(north("soda"))}><span className={styles.mapAv} style={{ background: "linear-gradient(135deg,#67E8F9,#818CF8)" }}>{BOT_ICON}</span><span className={styles.tag}>Soda · Trợ lý</span></Upright>
              </>)}
              {room("inbox", north("inbox"), <>
                {stats.waiting ? <><span className={styles.mapRing} /><span className={cx(styles.mapDot, styles.mf1)} /><span className={cx(styles.mapDot, styles.mf2)} /><span className={cx(styles.mapDot, styles.mf3)} /></> : null}
                <Upright {...centre(north("inbox"))}>
                  <span className={cx(styles.tag, styles.tagRed)}>Chưa trả lời <b className={styles.mono}>{n(stats.waiting)}</b></span>
                  {stats.tagged ? <span className={styles.tag}>{n(stats.tagged)} nhóm tag mình</span> : null}
                </Upright>
              </>)}
              {room("tower", north("tower"), <>
                {stats.running ? <span className={cx(styles.mapRing, styles.mapRingViolet)} /> : null}
                <Upright {...centre(north("tower"))}>
                  <span className={styles.tag}>Zalo Mkt · <b className={styles.mono}>{n(stats.sent)}</b> tin · <b className={styles.mono}>{n(stats.replies)}</b> phản hồi</span>
                  <span className={styles.tag}>{n(stats.running)} đang chạy</span>
                </Upright>
              </>)}
              {room("cv", north("cv"), <Upright {...centre(north("cv"))}><span className={styles.tag}>CV mới hôm nay <b className={cx(styles.mono, styles.cyanText)}>{n(stats.cvToday)}</b></span></Upright>)}
            </> : <div className={styles.liftLobby} style={boxOf({ x0: -600, z0: -440, x1: 245, z1: -260 })}><span>Sảnh {plan.name.split(" · ")[0].toLowerCase()}</span></div>}
            {plan.rooms.map((item) => {
              const box = boxOf(item);
              if (item.kind === "meeting") return room(item.key, box, <>
                <div className={styles.table} style={{ left: box.width / 2 - 50, top: box.height / 2 - 18 }} />
                {meeting.length
                  ? meeting.slice(0, 6).map((person, index) => <Person key={person.id} person={person} left={box.width / 2 - 70 + (index % 3) * 70} top={box.height / 2 - 30 + Math.floor(index / 3) * 92} onPick={pickPerson} />)
                  : <Upright {...centre(box)}><span className={styles.tag}>{stats.meetingsToday} lịch hôm nay</span></Upright>}
              </>);
              if (item.kind === "ai") return room(item.key, box, <>
                <div className={cx(styles.desk, stats.aiActive ? styles.deskOn : null)} style={{ left: box.width / 2 - 17, top: box.height * 0.45 }} />
                <Upright {...centre(box)}>
                  {stats.aiActive ? <span className={styles.bubble}>Đang tư vấn {stats.aiActive} UV</span> : null}
                  <span className={cx(styles.mapAv, styles.rGreen)} style={{ background: "linear-gradient(135deg,#6EE7B7,#22D3EE)" }}>AI</span>
                  <span className={styles.tag}>AI Recruiter</span>
                </Upright>
              </>);
              return room(item.key, box, <Seats room={item} team={people} onPick={pickPerson} />, true);
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

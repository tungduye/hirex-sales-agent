"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import type { HqFloor, HqMember, HqRoom, HqStats } from "@/modules/crm/dashboard/server/hq-data";
import styles from "@/modules/crm/dashboard/components/hq.module.css";

// HireX HQ, mức 2: the 2.5D office. Rooms sit on a tilted floor; people sit at desks in Phòng Rec / Phòng Sale and
// move to Phòng họp while a calendar event is running. Avatars stand upright (counter-rotated) so names stay readable.
// Zoom and rotate are local to this browser; every room opens the matching screen.

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const SCENE_W = 760, SCENE_H = 670, BASE_W = 1030, BASE_H = 590;
const ROTATIONS = [-45, 45, 135, 225];
const ZOOMS = [0.7, 0.85, 1, 1.15, 1.3, 1.5];
type Box = { left: number; top: number; width: number; height: number };
const BOXES: Record<string, Box> = {
  soda: { left: 0, top: 0, width: 178, height: 170 }, inbox: { left: 194, top: 0, width: 178, height: 170 },
  tower: { left: 388, top: 0, width: 178, height: 170 }, cv: { left: 582, top: 0, width: 178, height: 170 },
  rec: { left: 0, top: 186, width: 760, height: 240 },
  sale: { left: 0, top: 442, width: 300, height: 228 }, meeting: { left: 316, top: 442, width: 212, height: 228 }, ai: { left: 544, top: 442, width: 216, height: 228 },
};
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

function Person({ person, left, top }: { person: HqMember; left: number; top: number }) {
  const label = person.tone === "alert" ? `${person.name} · ${person.waiting.toLocaleString("vi-VN")} chờ` : person.name;
  return (
    <Upright left={left} top={top}>
      {person.tone === "busy" ? <span className={styles.bubble}>Đang nhắn</span> : null}
      <span title={`${person.name}${person.department ? ` (${person.department})` : ""}\n${person.doing}`}><HqAvatar person={person} /></span>
      <span className={cx(styles.tag, styles.tagName, person.tone === "alert" && styles.tagRed)}>{label}</span>
    </Upright>
  );
}

/** Desks in a grid (anchor = where the person stands); more people than desks → the last desk shows "+N". */
function Desks({ people, cols, rows, x0, y0, dx, dy }: { people: HqMember[]; cols: number; rows: number; x0: number; y0: number; dx: number; dy: number }) {
  const seats = cols * rows;
  const shown = people.length > seats ? people.slice(0, seats - 1) : people;
  const extra = people.length - shown.length;
  const at = (index: number) => ({ x: x0 + (index % cols) * dx, y: y0 + Math.floor(index / cols) * dy });
  return (
    <>
      {Array.from({ length: seats }, (_, index) => {
        const { x, y } = at(index);
        const person = shown[index];
        return <div key={`d${index}`} className={cx(styles.desk, person && person.tone !== "idle" && styles.deskOn)} style={{ left: x - 17, top: y + 6 }} />;
      })}
      {shown.map((person, index) => { const { x, y } = at(index); return <Person key={person.id} person={person} left={x} top={y} />; })}
      {extra > 0 ? <Upright {...(({ x, y }) => ({ left: x, top: y }))(at(seats - 1))}><span className={styles.tag}>+{extra} người</span></Upright> : null}
    </>
  );
}

const BOT_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06111f" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></svg>;

export function HqMap({ rooms, team, stats, floor }: { rooms: HqRoom[]; team: HqMember[]; stats: HqStats; floor: HqFloor }) {
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const measure = () => setFit(Math.max(0.45, Math.min(1.1, element.clientWidth / BASE_W)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = fit * ZOOMS[zoom];
  const rz = ROTATIONS[turn];
  const byKey = new Map(rooms.map((room) => [room.key, room]));
  const seated = (seat: HqMember["seat"]) => team.filter((person) => person.seat === seat);
  const rec = seated("REC"), sale = seated("SALE"), meeting = seated("MEET");
  const unseated = team.filter((person) => !person.seat).length;
  const focus = floor === "REC" ? "rec" : floor === "SALE" ? "sale" : null;

  const room = (key: string, content: ReactNode) => {
    const info = byKey.get(key);
    const box = BOXES[key];
    if (!info || !box) return null;
    return (
      <Link key={key} href={info.href} prefetch={false} aria-label={`${info.name}: ${info.meta}`}
        className={cx(styles.mapRoom, ROOM_TONE[info.tone], focus === key && styles.mapRoomFocus, focus && focus !== key && (key === "rec" || key === "sale") && styles.mapRoomDim)}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        {content}
        <span className={styles.rname}>{info.name}</span>
      </Link>
    );
  };

  // The scene turns and scales around its centre, placed a little below the canvas centre (avatars stand above the floor).
  const sceneStyle = { width: SCENE_W, height: SCENE_H, left: (BASE_W * scale - SCENE_W) / 2, top: (BASE_H * scale - SCENE_H) / 2 + 12 * scale, "--rz": `${rz}deg`, "--s": scale } as CSSProperties;
  return (
    <section className={cx(styles.glass, styles.mapWrap)} aria-label="Bản đồ văn phòng">
      <div className={styles.mapMain}>
        <div className={styles.mapTools}>
          <button type="button" onClick={() => setZoom((value) => Math.min(ZOOMS.length - 1, value + 1))} aria-label="Phóng to" disabled={zoom === ZOOMS.length - 1}>+</button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0, value - 1))} aria-label="Thu nhỏ" disabled={zoom === 0}>−</button>
          <button type="button" onClick={() => setTurn((value) => (value + 1) % ROTATIONS.length)} aria-label="Xoay bản đồ">⟳</button>
          <span>Bấm vào phòng để mở màn tương ứng</span>
        </div>
        <div ref={holder} className={styles.mapScroll}>
          <div className={styles.mapCanvas} style={{ width: BASE_W * scale, height: BASE_H * scale }}>
            <div className={styles.scene} style={sceneStyle}>
              {room("soda", <>
                <div className={cx(styles.desk, styles.deskOn)} style={{ left: 72, top: 96 }} />
                <Upright left={89} top={92}><span className={styles.bubble}>Bản tin hôm nay</span><span className={styles.mapAv} style={{ background: "linear-gradient(135deg,#67E8F9,#818CF8)" }}>{BOT_ICON}</span><span className={styles.tag}>Soda · Trợ lý</span></Upright>
              </>)}
              {room("inbox", <>
                {stats.waiting ? <><span className={styles.mapRing} /><span className={cx(styles.mapDot, styles.mf1)} /><span className={cx(styles.mapDot, styles.mf2)} /><span className={cx(styles.mapDot, styles.mf3)} /></> : null}
                <Upright left={89} top={100}>
                  <span className={cx(styles.tag, styles.tagRed)}>Chưa trả lời <b className={styles.mono}>{n(stats.waiting)}</b></span>
                  {stats.tagged ? <span className={styles.tag}>{n(stats.tagged)} nhóm tag mình</span> : null}
                </Upright>
              </>)}
              {room("tower", <>
                {stats.running ? <span className={cx(styles.mapRing, styles.mapRingViolet)} /> : null}
                <Upright left={89} top={100}>
                  <span className={styles.tag}>Zalo Mkt · <b className={styles.mono}>{n(stats.sent)}</b> tin · <b className={styles.mono}>{n(stats.replies)}</b> phản hồi</span>
                  <span className={styles.tag}>{n(stats.running)} đang chạy</span>
                </Upright>
              </>)}
              {room("rec", <Desks people={rec} cols={7} rows={2} x0={62} y0={72} dx={104} dy={118} />)}
              {room("sale", <Desks people={sale} cols={3} rows={2} x0={56} y0={70} dx={94} dy={116} />)}
              {room("meeting", <>
                <div className={styles.table} />
                {meeting.length
                  ? meeting.slice(0, 6).map((person, index) => <Person key={person.id} person={person} left={46 + (index % 3) * 60} top={78 + Math.floor(index / 3) * 104} />)
                  : <Upright left={106} top={120}><span className={styles.tag}>{stats.meetingsToday} lịch hôm nay</span></Upright>}
              </>)}
              {room("ai", <>
                <div className={cx(styles.desk, stats.aiActive ? styles.deskOn : null)} style={{ left: 91, top: 126 }} />
                <Upright left={108} top={120}>
                  {stats.aiActive ? <span className={styles.bubble}>Đang tư vấn {stats.aiActive} UV</span> : null}
                  <span className={cx(styles.mapAv, styles.rGreen)} style={{ background: "linear-gradient(135deg,#6EE7B7,#22D3EE)" }}>AI</span>
                  <span className={styles.tag}>AI Recruiter</span>
                </Upright>
              </>)}
              {room("cv", <Upright left={89} top={100}><span className={styles.tag}>CV mới hôm nay <b className={cx(styles.mono, styles.cyanText)}>{n(stats.cvToday)}</b></span></Upright>)}
            </div>
          </div>
        </div>
      </div>
      <aside className={styles.mapSide} aria-label="Các phòng">
        <div className={cx(styles.row, styles.panelHead)}><strong className={styles.panelTitle}>Các phòng</strong><span className={cx(styles.pill, styles.busy)}>Live</span></div>
        {rooms.map((item) => (
          <Link key={item.key} href={item.href} prefetch={false} className={styles.item}>
            <span className={cx(styles.sideDot, styles[`dot_${item.tone}`])} />
            <span className={styles.itemText}>{item.name}</span>
            <span className={cx(styles.itemAt, styles.mono)}>{item.meta}</span>
          </Link>
        ))}
        <div className={styles.legend}>
          <span><i className={styles.lgCyan} />Đang làm</span><span><i className={styles.lgRed} />Cần xem (≥100 chờ)</span>
          <span><i className={styles.lgViolet} />Đang họp</span><span><i className={styles.lgGrey} />Chưa có hoạt động</span>
        </div>
        <p className={styles.sideNote}>
          {unseated ? `${unseated} người chưa có Bộ phận Rec/Sale nên chưa có chỗ ngồi. ` : ""}
          Ảnh đại diện: thêm ở <Link href="/settings/roles" prefetch={false}>Vai trò và phân quyền</Link>; chưa có ảnh thì hiện chữ cái tên.
        </p>
      </aside>
    </section>
  );
}

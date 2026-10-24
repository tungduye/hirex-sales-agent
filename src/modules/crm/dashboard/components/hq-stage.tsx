"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HqData, HqMember, HqRoom } from "@/modules/crm/dashboard/server/hq-data";
import { buildHqLayout, roomOfDepartment, type HqLayout } from "@/modules/crm/dashboard/core/hq-layout";
import { HqClock, HqCount, HqCountdown } from "@/modules/crm/dashboard/components/hq-live";
import { HqAvatar, HqMap2D, saveHqView, useHqView, type HqSelection } from "@/modules/crm/dashboard/components/hq-map";
import { HqScene3D } from "@/modules/crm/dashboard/components/hq-3d";
import styles from "@/modules/crm/dashboard/components/hq.module.css";

// HireX HQ (Tổng quan): the office fills the screen (only the main menu and top bar stay). Everything else sits on
// top of it and opens with a button: Chỉ số (left), Đang diễn ra / Đội ngũ (right). Picking a room or a person on the
// map opens its summary on the right — with the same numbers as its own screen — and never leaves this page;
// each summary has a button to open the full screen when wanted.

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const n = (value: number) => value.toLocaleString("vi-VN");
const PILL = { alert: styles.alert, info: styles.info, meet: styles.meet, plain: styles.plain, busy: styles.busy, idle: styles.idle } as const;
const STATUS = { busy: "Đang nhắn", alert: "Cần xem", meet: "Đang họp", idle: "Chưa có hoạt động" } as const;
const CAMPAIGN_STATUS: Record<string, string> = { RUNNING: "Đang chạy", PAUSED: "Tạm dừng", DRAFT: "Nháp", COMPLETED: "Xong", DONE: "Xong", CANCELLED: "Đã huỷ" };
type Drawer = "feed" | "team" | null;
const PANEL_KEY = "hirex_hq_panels";

function readPanels(): { kpi: boolean } {
  try { const value = JSON.parse(window.localStorage.getItem(PANEL_KEY) ?? "{}") as { kpi?: unknown }; return { kpi: value.kpi !== false }; } catch { return { kpi: true }; }
}

/** Suối Nguồn opens with the scope the member last used; summaries here count every nick ("Tất cả"). */
function openInbox(router: ReturnType<typeof useRouter>, href: string) {
  document.cookie = "hirex_inbox_scope=ALL; path=/; max-age=31536000; samesite=lax";
  router.push(href);
}

function Tile({ label, value, tone, note }: { label: string; value: number | string | null; tone?: "red" | "cyan" | "violet" | "green"; note?: string }) {
  return (
    <div className={cx(styles.tile, tone && styles[`tile_${tone}`])}>
      <span>{label}</span>
      <b className={styles.mono}>{value === null ? "—" : typeof value === "number" ? n(value) : value}</b>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function NoAccess({ what }: { what: string }) {
  return <p className={styles.drawerEmpty}>Bạn chưa có quyền xem {what}.</p>;
}

function PersonRow({ person, onPick }: { person: HqMember; onPick: (id: string) => void }) {
  return (
    <button type="button" className={styles.drawerRow} onClick={() => onPick(person.id)}>
      <span className={styles.teamAv} aria-hidden="true"><HqAvatar person={person} size={26} /></span>
      <span className={styles.who}>
        <span className={styles.whoName}>{person.name}{person.department ? <span className={styles.whoRole}>{person.department}</span> : null}</span>
        <span className={styles.whoDoing}>{person.doing}</span>
      </span>
      {person.tone === "idle" ? null : <span className={cx(styles.pill, PILL[person.tone])}>{person.status}</span>}
    </button>
  );
}

/** Rooms of the bộ phận (from the plan) as map rooms: name, people, waiting; each opens its own view (?tang=). */
function peopleRooms(layout: HqLayout, team: HqMember[]): HqRoom[] {
  const rooms = layout.floors.flatMap((floor) => floor.rooms).filter((room) => room.kind === "dept" || room.kind === "boss" || room.kind === "common");
  return rooms.map((room, index) => {
    const waiting = team.filter((person) => roomOfDepartment(person.department) === room.key).reduce((sum, person) => sum + person.waiting, 0);
    return { key: room.key, name: room.name, meta: `${room.members} người${waiting ? ` · ${n(waiting)} chờ` : ""}${layout.floors.length > 1 ? ` · Tầng ${room.level + 1}` : ""}`, href: `/?tang=${room.key}`, tone: index % 2 ? "violet" : "cyan" };
  });
}
const shortName = (name: string) => name.replace(/^Phòng /u, "");

function RoomSummary({ room, data, rooms, layout, onPick, onFloor }: { room: string; data: HqData; rooms: HqRoom[]; layout: HqLayout; onPick: (id: string) => void; onFloor: (href: string) => void }) {
  const router = useRouter();
  const details = data.details;
  const info = rooms.find((item) => item.key === room);
  const open = (href: string, label: string, inbox = false) => <button type="button" className={styles.drawerOpen} onClick={() => inbox ? openInbox(router, href) : router.push(href)}>{label} →</button>;
  let body: ReactNode = null;
  if (room === "inbox") {
    const inbox = details.inbox;
    body = inbox ? <>
      <div className={styles.tiles}>
        <Tile label="Chưa trả lời" value={inbox.waiting} tone="red" />
        <Tile label="Tin cá nhân" value={inbox.personal} />
        <Tile label="Nhóm tag mình" value={inbox.tagged} />
        <Tile label="Quan trọng" value={inbox.important} />
      </div>
      <p className={styles.drawerNote}>Đếm như tab “Chưa trả lời” ở Suối Nguồn, phạm vi Tất cả tài khoản bạn được xem, 30 ngày gần nhất{inbox.capped ? " (vượt 20.000 hội thoại: chỉ đếm 20.000 hội thoại mới nhất)" : ""}.</p>
      <h4 className={styles.drawerH}>Theo người phụ trách</h4>
      {inbox.people.length ? inbox.people.map((person) => (
        <button key={person.id} type="button" className={styles.drawerLine} onClick={() => onPick(person.id)}><span>{person.name}</span><b className={styles.mono}>{n(person.waiting)}</b></button>
      )) : <p className={styles.drawerEmpty}>Không ai còn tin chờ.</p>}
      {inbox.unowned ? <div className={styles.drawerLine}><span>Nick chưa có người dùng chính</span><b className={styles.mono}>{n(inbox.unowned)}</b></div> : null}
      {open("/inbox/all?view=waiting", "Mở Suối Nguồn · Chưa trả lời", true)}
    </> : <NoAccess what="Suối Nguồn" />;
  } else if (room === "tower") {
    const zalo = details.zalo, broadcasts = details.broadcasts;
    body = <>
      {zalo ? <>
        <div className={styles.tiles}>
          <Tile label="Chiến dịch đang chạy" value={zalo.running} tone="violet" />
          <Tile label="Tin đã gửi" value={zalo.sent} />
          <Tile label="Phản hồi" value={zalo.replies} tone="cyan" />
          <Tile label="Phản hồi hôm nay" value={`+${n(zalo.repliesToday)}`} />
        </div>
        <p className={styles.drawerNote}>Cùng số với màn Zalo Marketing (tổng các chiến dịch đang hiển thị ở đó).</p>
        <h4 className={styles.drawerH}>Chiến dịch</h4>
        {zalo.campaigns.length ? zalo.campaigns.map((campaign) => (
          <div key={campaign.id} className={styles.drawerLine}>
            <span>{campaign.name}<small>{CAMPAIGN_STATUS[campaign.status] ?? campaign.status}{campaign.owner ? ` · ${campaign.owner}` : ""}</small></span>
            <b className={styles.mono}>{n(campaign.sent)} / {n(campaign.replies)}</b>
          </div>
        )) : <p className={styles.drawerEmpty}>Chưa có chiến dịch Zalo.</p>}
        <p className={styles.drawerNote}>Cột phải: tin gửi / phản hồi.</p>
        {open("/campaigns/omnichannel", "Mở Zalo Marketing")}
      </> : <NoAccess what="Chiến dịch" />}
      {broadcasts ? <>
        <h4 className={styles.drawerH}>Gửi nhóm Zalo · {broadcasts.running} đang chạy</h4>
        {broadcasts.recent.length ? broadcasts.recent.map((item) => (
          <button key={item.id} type="button" className={styles.drawerLine} onClick={() => router.push(`/broadcasts/${item.id}`)}><span>{item.name}<small>{CAMPAIGN_STATUS[item.status] ?? item.status} · {item.at}</small></span></button>
        )) : <p className={styles.drawerEmpty}>Chưa có đợt gửi nhóm.</p>}
        {open("/broadcasts", "Mở Gửi nhóm Zalo")}
      </> : null}
    </>;
  } else if (room === "cv") {
    const cv = details.cv;
    body = cv ? <>
      <div className={styles.tiles}>
        <Tile label="CV mới hôm nay" value={cv.today} tone="cyan" note="ứng viên gửi CV trong chat" />
        <Tile label="Hôm qua" value={cv.yesterday} />
        <Tile label="Tháng này" value={cv.month} />
        <Tile label="Từ MKT Zalo (tháng)" value={cv.fromCampaignMonth} tone="violet" />
      </div>
      <p className={styles.drawerNote}>CV chuyển hóa: ứng viên gửi file CV (PDF, Word, tên có CV/resume/履歴書…) trong chat 1-1 Zalo/Facebook trên nick tuyển dụng hoặc sau khi phản hồi chiến dịch; mỗi ứng viên tính một lần. File tên kiểu JD, hợp đồng, biên bản… không tính.</p>
      <h4 className={styles.drawerH}>{cv.today ? "Hôm nay" : "Gần nhất"}</h4>
      {cv.recent.length ? cv.recent.map((item, index) => (
        <button key={index} type="button" className={styles.drawerLine} onClick={() => openInbox(router, item.href)}>
          <span>{item.name}<small>{item.file} · {item.nick}{item.owner ? ` (${item.owner})` : ""}{item.campaign ? ` · ${item.campaign}` : ""}</small></span><b className={styles.mono}>{item.at}</b>
        </button>
      )) : <p className={styles.drawerEmpty}>Chưa có CV chuyển hóa.</p>}
      {cv.human ? <>
        <h4 className={styles.drawerH}>Màn CV (Human)</h4>
        <div className={styles.tiles}><Tile label="Human hôm nay" value={cv.human.today} /><Tile label="Hôm qua" value={cv.human.yesterday} /><Tile label="Tổng CV" value={cv.human.total} /></div>
        <p className={styles.drawerNote}>Tính theo ngày tạo trên Human. {cv.human.lastSync ? `Human cập nhật lần cuối ${cv.human.lastSync} (mỗi 6 giờ).` : ""}</p>
        {open("/cvs", "Mở CV")}
      </> : null}
    </> : <NoAccess what="Suối Nguồn" />;
  } else if (room === "meeting") {
    const calendar = details.calendar;
    body = <>
      <div className={styles.tiles}><Tile label="Lịch hôm nay" value={calendar.events.length} tone="violet" note={calendar.scope} /><Tile label="Phỏng vấn" value={calendar.events.filter((item) => item.kind === "Phỏng vấn").length} /></div>
      <h4 className={styles.drawerH}>Hôm nay</h4>
      {calendar.events.length ? calendar.events.map((event) => (
        <div key={event.id} className={cx(styles.drawerLine, event.now && styles.drawerNow)}><span>{event.title}<small>{event.kind} · {event.who}</small></span><b className={styles.mono}>{event.time}</b></div>
      )) : <p className={styles.drawerEmpty}>Hôm nay không có lịch.</p>}
      {open(data.kpis.find((kpi) => kpi.key === "meet")?.href ?? "/calendar", "Mở Lịch hẹn")}
    </>;
  } else if (room === "ai") {
    const ai = details.ai;
    body = ai ? <>
      <div className={styles.tiles}>
        <Tile label="UV đang tư vấn (24 giờ)" value={ai.active} tone="green" />
        <Tile label="Đã trả lời hôm nay" value={ai.sentToday} />
        <Tile label="Nháp chờ duyệt hôm nay" value={ai.draftsToday} />
      </div>
      <h4 className={styles.drawerH}>Gần đây</h4>
      {data.feed.filter((item) => item.kind === "AI Rec").map((item, index) => <div key={index} className={styles.drawerLine}><span>{item.text}</span><b className={styles.mono}>{item.at}</b></div>)}
      {open("/settings/ai-recruiter", "Mở AI Recruiter")}
    </> : <p className={styles.drawerEmpty}>Chỉ quản trị viên xem được AI Recruiter.</p>;
  } else if (room === "soda") {
    const soda = details.soda;
    body = <>
      <div className={styles.tiles}><Tile label="Thẻ chờ bạn xác nhận" value={soda.pending} tone="cyan" /></div>
      <h4 className={styles.drawerH}>Soda vừa làm</h4>
      {soda.recent.length ? soda.recent.map((item, index) => <div key={index} className={styles.drawerLine}><span>{item.title}<small>{item.state}</small></span><b className={styles.mono}>{item.at}</b></div>) : <p className={styles.drawerEmpty}>Chưa có việc nào.</p>}
      {open("/assistant", "Mở Trợ lý")}
    </>;
  } else if (layout.floors.some((floor) => floor.rooms.some((item) => item.key === room && (item.kind === "dept" || item.kind === "boss" || item.kind === "common")))) {
    const people = data.team.filter((person) => roomOfDepartment(person.department) === room);
    const newcomers = people.filter((person) => person.isNew);
    body = <>
      <div className={styles.tiles}>
        <Tile label="Người" value={people.length} tone={info?.tone === "violet" ? "violet" : "cyan"} note={newcomers.length ? `${newcomers.length} người mới` : undefined} />
        <Tile label="Chưa trả lời" value={people.reduce((sum, person) => sum + person.waiting, 0)} tone="red" />
        <Tile label="Đang họp" value={people.filter((person) => person.tone === "meet").length} />
      </div>
      <h4 className={styles.drawerH}>Thành viên</h4>
      {people.length ? people.map((person) => <PersonRow key={person.id} person={person} onPick={onPick} />) : <p className={styles.drawerEmpty}>Chưa có ai (gán Bộ phận ở Vai trò và phân quyền).</p>}
      {room === "common" ? <p className={styles.drawerNote}>Người chưa được xếp bộ phận. Gán Bộ phận ở Vai trò và phân quyền thì họ tự chuyển sang phòng của bộ phận đó.</p> : null}
      {data.floor === room ? null : <button type="button" className={styles.drawerOpen} onClick={() => onFloor(`/?tang=${room}`)}>Chỉ xem {info?.name ?? "phòng này"} →</button>}
    </>;
  }
  return <>
    <div className={styles.drawerHead}><strong>{info?.name ?? "Phòng"}</strong><span>{info?.meta}</span></div>
    {body}
  </>;
}

const CHANNEL: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook", EMAIL: "Email" };

function PersonCard({ person, onClose }: { person: HqMember; onClose: () => void }) {
  const router = useRouter();
  // The assistant panel opens with the question typed in; the member reads it, changes it if needed and sends it.
  const ask = () => window.dispatchEvent(new CustomEvent("hirex:assistant-draft", { detail: { text: `Tình hình hôm nay của ${person.name}: tin chưa trả lời theo từng nick, lịch hẹn và chiến dịch đang chạy?` } }));
  return <>
    <div className={styles.drawerHead}><strong>{person.name}</strong><span>{person.department ?? "Chưa có bộ phận"} · {STATUS[person.tone]}{person.isNew ? " · Thành viên mới 🎉" : ""}</span></div>
    <div className={styles.personTop}><HqAvatar person={person} size={56} /><div className={styles.tiles}>
      <Tile label="Chưa trả lời" value={person.waiting} tone={person.tone === "alert" ? "red" : "cyan"} />
      <Tile label="Phản hồi chiến dịch" value={person.campaignReplies} tone="violet" />
      <Tile label="CV chuyển hóa tháng này" value={person.cvMonth} tone="cyan" note={person.cvToday ? `+${person.cvToday} hôm nay` : undefined} />
    </div></div>
    <p className={styles.drawerNote}>{person.doing}. Số chưa trả lời = Suối Nguồn lọc “Người phụ trách: {person.name}”, tab Chưa trả lời.</p>
    <h4 className={styles.drawerH}>Nick ({person.nicks.length})</h4>
    {person.nicks.length ? person.nicks.slice(0, 8).map((nick) => (
      <button key={nick.id} type="button" className={styles.drawerLine} onClick={() => openInbox(router, `/inbox/all?view=waiting&account=${encodeURIComponent(nick.id)}`)} title="Mở Suối Nguồn của nick này">
        <span><span className={styles.nickName}><i className={nick.live ? styles.dotLive : styles.dotOff} />{nick.name}</span><small>{CHANNEL[nick.channel] ?? nick.channel}{nick.live ? "" : " · mất kết nối"}</small></span>
        <b className={styles.mono}>{n(nick.waiting)}</b>
      </button>
    )) : <p className={styles.drawerEmpty}>Chưa là người dùng chính của nick nào.</p>}
    {person.nicks.length > 8 ? <p className={styles.drawerNote}>và {person.nicks.length - 8} nick khác.</p> : null}
    <h4 className={styles.drawerH}>Lịch hôm nay</h4>
    {person.today.length ? person.today.map((event, index) => (
      <div key={index} className={cx(styles.drawerLine, event.now && styles.drawerNow)}><span>{event.title}<small>{event.kind}</small></span><b className={styles.mono}>{event.time}</b></div>
    )) : <p className={styles.drawerEmpty}>Không có lịch hôm nay.</p>}
    <button type="button" className={styles.drawerOpen} onClick={() => openInbox(router, `/inbox/all?view=waiting&owner=${encodeURIComponent(person.id)}`)}>Mở Suối Nguồn của {person.name} →</button>
    <button type="button" className={styles.drawerGhost} onClick={ask}>Hỏi Trợ lý về {person.name}</button>
    <button type="button" className={styles.drawerGhost} onClick={onClose}>Đóng</button>
  </>;
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/giu, "d").toLowerCase();

/** Tìm người: type a name, pick → the camera goes to their desk (or Phòng họp) and their card opens. */
function PersonSearch({ team, onPick, onClose }: { team: HqMember[]; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const found = team.filter((member) => !query.trim() || fold(`${member.name} ${member.department ?? ""}`).includes(fold(query.trim()))).slice(0, 8);
  return (
    <div className={cx(styles.glass, styles.searchPop)} role="dialog" aria-label="Tìm người">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm người theo tên, bộ phận…" aria-label="Tìm người"
        onKeyDown={(event) => { if (event.key === "Enter" && found[0]) onPick(found[0].id); if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} />
      {found.length ? found.map((member) => <PersonRow key={member.id} person={member} onPick={onPick} />) : <p className={styles.drawerEmpty}>Không có ai khớp “{query}”.</p>}
    </div>
  );
}

export function HqStage({ data }: { data: HqData }) {
  const router = useRouter();
  const view = useHqView();
  const [selected, setSelected] = useState<HqSelection>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [kpiOpen, setKpiOpen] = useState(true);
  useEffect(() => { const timer = window.setTimeout(() => setKpiOpen(readPanels().kpi), 0); return () => window.clearTimeout(timer); }, []);
  const toggleKpi = () => setKpiOpen((value) => { try { window.localStorage.setItem(PANEL_KEY, JSON.stringify({ kpi: !value })); } catch { /* per-browser convenience only */ } return !value; });
  const pick = (selection: HqSelection) => { setSelected(selection); if (selection) setDrawer(null); };
  const [searching, setSearching] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // Chế độ TV: full screen, the camera visits each room (and anyone who needs a look) by itself, numbers stay live.
  const [tv, setTv] = useState(false);
  const goRef = useRef<(selection: HqSelection) => void>(() => undefined);
  const pickPerson = (id: string) => go({ type: "person", id });
  const close = () => { setSelected(null); setDrawer(null); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); setDrawer(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const person = selected?.type === "person" ? data.team.find((member) => member.id === selected.id) ?? null : null;
  const open = selected !== null || drawer !== null;
  // The office plan from the team; it only changes when someone joins, leaves or changes bộ phận / thị trường.
  const planKey = data.team.map((member) => `${member.id}:${member.department ?? ""}:${member.market ?? ""}:${member.name}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- planKey covers what the plan is made from
  const layout = useMemo(() => buildHqLayout(data.team.map((member) => ({ id: member.id, name: member.name, department: member.department, market: member.market }))), [planKey]);
  const rooms = useMemo(() => [...data.rooms, ...peopleRooms(layout, data.team)], [data.rooms, data.team, layout]);
  const peopleRoomList = layout.floors.flatMap((floor) => floor.rooms).filter((room) => room.kind === "dept" || room.kind === "boss" || room.kind === "common");
  // Tầng on screen: picking someone (or a room) on another floor takes the lift there; Phòng họp is on Tầng 1.
  const [level, setLevel] = useState(0);
  const levelOfRoom = (key: string) => layout.floors.find((floor) => floor.rooms.some((room) => room.key === key))?.level ?? 0;
  const focusLevel = data.floor === "ALL" ? null : levelOfRoom(data.floor);
  const [seenFocus, setSeenFocus] = useState<string | null>(null);
  if (data.floor !== seenFocus) { setSeenFocus(data.floor); if (focusLevel !== null) setLevel(focusLevel); }
  const shownLevel = Math.min(level, layout.floors.length - 1);
  const go = (selection: HqSelection) => {
    if (selection?.type === "person") { const member = data.team.find((item) => item.id === selection.id); const seat = layout.seatOf[selection.id]; if (member?.meeting) setLevel(0); else if (seat) setLevel(seat.level); }
    else if (selection?.type === "room" && layout.floors.length > 1 && !["soda", "inbox", "tower", "cv"].includes(selection.key)) setLevel(levelOfRoom(selection.key));
    else if (selection?.type === "room") setLevel(0);
    pick(selection);
  };
  const teamShown = data.floor === "ALL" ? data.team : data.team.filter((member) => roomOfDepartment(member.department) === data.floor);
  useEffect(() => { goRef.current = go; });
  const tour: HqSelection[] = [{ type: "room", key: "inbox" }, ...peopleRoomList.map((room) => ({ type: "room" as const, key: room.key })), { type: "room", key: "tower" }, { type: "room", key: "meeting" },
    ...data.team.filter((member) => member.tone === "alert").slice(0, 3).map((member) => ({ type: "person" as const, id: member.id })), { type: "room", key: "cv" }];
  const tourKey = tour.map((stop) => stop ? (stop.type === "room" ? stop.key : stop.id) : "").join(",");
  useEffect(() => {
    if (!tv) return;
    const stops = tourKey.split(",").map((key): HqSelection => data.team.some((member) => member.id === key) ? { type: "person", id: key } : { type: "room", key });
    let index = 0;
    const next = () => { goRef.current(stops[index % stops.length]); index += 1; };
    next();
    const timer = window.setInterval(next, 9000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tourKey stands for the stops
  }, [tv, tourKey]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) { setTv(false); setSelected(null); } };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleTv = () => {
    if (tv) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); setTv(false); setSelected(null); return; }
    setSearching(false); setDrawer(null);
    void stageRef.current?.requestFullscreen?.().catch(() => undefined);
    setTv(true);
  };

  return (
    <div ref={stageRef} className={cx(styles.stage, tv && styles.stageTv)}>
      <div className={styles.stageMap}>
        {view === "3d"
          ? <HqScene3D rooms={rooms} team={data.team} stats={data.stats} floor={data.floor} feed={data.feed} layout={layout} level={shownLevel} selected={selected} onSelect={go} onUnsupported={() => saveHqView("2d")} />
          : <HqMap2D rooms={rooms} team={data.team} stats={data.stats} floor={data.floor} layout={layout} level={shownLevel} selected={selected} onSelect={go} />}
        {layout.floors.length > 1 ? (
          <nav className={cx(styles.glass, styles.lift)} aria-label="Thang máy">
            <b>Tầng</b>
            {layout.floors.slice().reverse().map((floor) => <button key={floor.level} type="button" aria-pressed={shownLevel === floor.level} title={floor.name} onClick={() => { setSelected(null); setLevel(floor.level); }}>{floor.level + 1}</button>)}
          </nav>
        ) : null}
      </div>

      <div className={styles.leftCol}>
      <header className={cx(styles.glass, styles.hud)}>
        <span className={styles.logo} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 4v16M19 4v16M5 12h14" /></svg></span>
        <strong className={styles.title}>HireX HQ</strong>
        <nav className={styles.row} aria-label="Phòng" style={{ gap: 4 }}>
          <Link href="/" className={cx(styles.chip, styles.chipSm, data.floor === "ALL" && styles.chipOn)} aria-current={data.floor === "ALL" ? "page" : undefined}>Toàn công ty</Link>
          {peopleRoomList.map((room) => <Link key={room.key} href={`/?tang=${room.key}`} className={cx(styles.chip, styles.chipSm, data.floor === room.key && styles.chipOn)} aria-current={data.floor === room.key ? "page" : undefined} title={`${room.name} · ${room.members} người`}>{shortName(room.name)}</Link>)}
        </nav>
        {data.liveNicks !== null ? <span className={cx(styles.chip, styles.chipSm, styles.chipLive)} title="Số nick Zalo đang kết nối"><span className={styles.pulse} />{data.liveNicks} nick Zalo</span> : null}
        {data.nextMeetingAt ? <span className={cx(styles.chip, styles.chipSm)} title={data.nextMeetingTitle ?? undefined}>Lịch kế tiếp <HqCountdown at={data.nextMeetingAt} className={cx(styles.mono, styles.strong)} /></span> : null}
        <HqClock className={cx(styles.chip, styles.chipSm, styles.mono, styles.strong)} />
      </header>


      {kpiOpen ? (
        <aside className={styles.kpiPanel} aria-label="Chỉ số chính">
          {data.kpis.map((kpi) => (
            <button key={kpi.key} type="button" className={cx(styles.glass, styles.kpiCard, selected?.type === "room" && selected.key === kpi.room && styles.kpiOn)} onClick={() => go({ type: "room", key: kpi.room })}>
              <span className={styles.kLabel}>{kpi.label}</span>
              {kpi.value === null ? <span className={cx(styles.kValSm, styles.mono, styles.dim)}>—</span> : <HqCount value={kpi.value} className={cx(styles.kValSm, styles.mono, kpi.tone === "alert" && styles.kAlert)} />}
              <span className={styles.kNote}>{kpi.note}</span>
            </button>
          ))}
        </aside>
      ) : null}
      </div>

      <div className={cx(styles.glass, styles.dock)} role="toolbar" aria-label="Bảng thông tin">
        <button type="button" aria-pressed={searching} onClick={() => setSearching((value) => !value)} title="Tìm người trên bản đồ" aria-label="Tìm người">⌕ Tìm</button>
        <button type="button" aria-pressed={kpiOpen} onClick={toggleKpi}>Chỉ số</button>
        <button type="button" aria-pressed={drawer === "feed"} onClick={() => { setSelected(null); setDrawer((value) => value === "feed" ? null : "feed"); }}>Đang diễn ra{data.feed.length ? <i>{data.feed.length}</i> : null}</button>
        <button type="button" aria-pressed={drawer === "team"} onClick={() => { setSelected(null); setDrawer((value) => value === "team" ? null : "team"); }}>Đội ngũ</button>
        <span className={styles.dockSep} />
        <button type="button" aria-pressed={view === "2d"} onClick={() => saveHqView("2d")}>2.5D</button>
        <button type="button" aria-pressed={view === "3d"} onClick={() => saveHqView("3d")}>3D</button>
        <span className={styles.dockSep} />
        <button type="button" aria-pressed={tv} onClick={toggleTv} title="Chế độ TV: chiếu lên màn hình lớn, toàn màn hình, tự đi qua từng phòng (Esc để thoát)" aria-label={tv ? "Thoát chế độ TV" : "Chế độ TV"}>{tv ? "Thoát TV" : "TV"}</button>
      </div>
      {searching ? <PersonSearch team={data.team} onPick={(id) => { setSearching(false); go({ type: "person", id }); }} onClose={() => setSearching(false)} /> : null}

      {open ? (
        <aside className={cx(styles.glass, styles.drawer)} aria-label="Thông tin">
          <button type="button" className={styles.drawerClose} onClick={close} aria-label="Đóng">×</button>
          <div className={styles.drawerBody}>
            {selected?.type === "room" ? <RoomSummary room={selected.key} data={data} rooms={rooms} layout={layout} onPick={pickPerson} onFloor={(href) => { close(); router.push(href); }} />
              : person ? <PersonCard person={person} onClose={close} />
              : selected?.type === "person" ? <p className={styles.drawerEmpty}>Người này không còn trong danh sách tầng đang xem.</p>
              : drawer === "feed" ? <>
                <div className={styles.drawerHead}><strong>Đang diễn ra</strong><span>{data.feed.length} mới nhất</span></div>
                {data.feed.length ? data.feed.map((item, index) => (
                  <button key={index} type="button" className={styles.drawerLine} onClick={() => item.href ? router.push(item.href) : undefined}>
                    <span><em className={cx(styles.pill, PILL[item.tone])}>{item.kind}</em> {item.text}</span><b className={styles.mono}>{item.at}</b>
                  </button>
                )) : <p className={styles.drawerEmpty}>Chưa có hoạt động mới.</p>}
              </>
              : drawer === "team" ? <>
                <div className={styles.drawerHead}><strong>Đội ngũ</strong><span>{teamShown.length} người · bấm để xem trên bản đồ</span></div>
                {teamShown.length ? teamShown.map((member) => <PersonRow key={member.id} person={member} onPick={pickPerson} />) : <p className={styles.drawerEmpty}>Chưa có thành viên ở phòng này.</p>}
              </> : null}
          </div>
        </aside>
      ) : null}

      <div className={styles.legendBar} aria-hidden="true">
        <span><i className={styles.lgCyan} />Đang làm</span><span><i className={styles.lgRed} />Cần xem (≥100 chờ)</span><span><i className={styles.lgViolet} />Đang họp</span><span><i className={styles.lgGrey} />Chưa có hoạt động</span>
      </div>
    </div>
  );
}

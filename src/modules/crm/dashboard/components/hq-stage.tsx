"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HqData, HqMember } from "@/modules/crm/dashboard/server/hq-data";
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
const FLOORS = [["ALL", "/", "Toàn công ty"], ["REC", "/?tang=rec", "Tầng Rec"], ["SALE", "/?tang=sale", "Tầng Sale"]] as const;
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

function RoomSummary({ room, data, onPick, onFloor }: { room: string; data: HqData; onPick: (id: string) => void; onFloor: (href: string) => void }) {
  const router = useRouter();
  const details = data.details;
  const info = data.rooms.find((item) => item.key === room);
  const open = (href: string, label: string, inbox = false) => <button type="button" className={styles.drawerOpen} onClick={() => inbox ? openInbox(router, href) : router.push(href)}>{label} →</button>;
  const team = (pattern: RegExp) => data.team.filter((person) => pattern.test((person.department ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()));
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
        <Tile label="CV mới hôm nay" value={cv.today} tone="cyan" />
        <Tile label="Hôm qua" value={cv.yesterday} />
        <Tile label="Tổng CV" value={cv.total} note="như màn CV" />
      </div>
      <p className={styles.drawerNote}>Tính theo ngày tạo trên Human. {cv.lastSync ? `Human cập nhật lần cuối ${cv.lastSync} (mỗi 6 giờ).` : ""}</p>
      {open("/cvs", "Mở CV")}
    </> : <NoAccess what="CV" />;
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
  } else if (room === "rec" || room === "sale") {
    const people = team(room === "rec" ? /\brec\b/u : /\bsale\b/u);
    body = <>
      <div className={styles.tiles}>
        <Tile label="Người" value={people.length} tone={room === "rec" ? "cyan" : "violet"} />
        <Tile label="Chưa trả lời" value={people.reduce((sum, person) => sum + person.waiting, 0)} tone="red" />
        <Tile label="Đang họp" value={people.filter((person) => person.tone === "meet").length} />
      </div>
      <h4 className={styles.drawerH}>Thành viên</h4>
      {people.length ? people.map((person) => <PersonRow key={person.id} person={person} onPick={onPick} />) : <p className={styles.drawerEmpty}>Chưa có ai (gán Bộ phận ở Vai trò và phân quyền).</p>}
      <button type="button" className={styles.drawerOpen} onClick={() => onFloor(room === "rec" ? "/?tang=rec" : "/?tang=sale")}>Chỉ xem {room === "rec" ? "tầng Rec" : "tầng Sale"} →</button>
    </>;
  }
  return <>
    <div className={styles.drawerHead}><strong>{info?.name ?? "Phòng"}</strong><span>{info?.meta}</span></div>
    {body}
  </>;
}

function PersonCard({ person, onClose }: { person: HqMember; onClose: () => void }) {
  const router = useRouter();
  return <>
    <div className={styles.drawerHead}><strong>{person.name}</strong><span>{person.department ?? "Chưa có bộ phận"} · {STATUS[person.tone]}</span></div>
    <div className={styles.personTop}><HqAvatar person={person} size={56} /><div className={styles.tiles}><Tile label="Chưa trả lời" value={person.waiting} tone={person.tone === "alert" ? "red" : "cyan"} /></div></div>
    <p className={styles.drawerNote}>{person.doing}. Số chưa trả lời = Suối Nguồn lọc “Người phụ trách: {person.name}”, tab Chưa trả lời.</p>
    <button type="button" className={styles.drawerOpen} onClick={() => openInbox(router, `/inbox/all?view=waiting&owner=${encodeURIComponent(person.id)}`)}>Mở Suối Nguồn của {person.name} →</button>
    <button type="button" className={styles.drawerGhost} onClick={onClose}>Đóng</button>
  </>;
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
  const pickPerson = (id: string) => pick({ type: "person", id });
  const close = () => { setSelected(null); setDrawer(null); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); setDrawer(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const person = selected?.type === "person" ? data.team.find((member) => member.id === selected.id) ?? null : null;
  const open = selected !== null || drawer !== null;

  return (
    <div className={styles.stage}>
      <div className={styles.stageMap}>
        {view === "3d"
          ? <HqScene3D rooms={data.rooms} team={data.team} stats={data.stats} floor={data.floor} selected={selected} onSelect={pick} onUnsupported={() => saveHqView("2d")} />
          : <HqMap2D rooms={data.rooms} team={data.team} stats={data.stats} floor={data.floor} selected={selected} onSelect={pick} />}
      </div>

      <div className={styles.leftCol}>
      <header className={cx(styles.glass, styles.hud)}>
        <span className={styles.logo} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 4v16M19 4v16M5 12h14" /></svg></span>
        <strong className={styles.title}>HireX HQ</strong>
        <nav className={styles.row} aria-label="Tầng" style={{ gap: 4 }}>
          {FLOORS.map(([key, href, label]) => <Link key={key} href={href} className={cx(styles.chip, styles.chipSm, data.floor === key && styles.chipOn)} aria-current={data.floor === key ? "page" : undefined}>{label}</Link>)}
        </nav>
        {data.liveNicks !== null ? <span className={cx(styles.chip, styles.chipSm, styles.chipLive)} title="Số nick Zalo đang kết nối"><span className={styles.pulse} />{data.liveNicks} nick Zalo</span> : null}
        {data.nextMeetingAt ? <span className={cx(styles.chip, styles.chipSm)} title={data.nextMeetingTitle ?? undefined}>Lịch kế tiếp <HqCountdown at={data.nextMeetingAt} className={cx(styles.mono, styles.strong)} /></span> : null}
        <HqClock className={cx(styles.chip, styles.chipSm, styles.mono, styles.strong)} />
      </header>


      {kpiOpen ? (
        <aside className={styles.kpiPanel} aria-label="Chỉ số chính">
          {data.kpis.map((kpi) => (
            <button key={kpi.key} type="button" className={cx(styles.glass, styles.kpiCard, selected?.type === "room" && selected.key === kpi.room && styles.kpiOn)} onClick={() => pick({ type: "room", key: kpi.room })}>
              <span className={styles.kLabel}>{kpi.label}</span>
              {kpi.value === null ? <span className={cx(styles.kValSm, styles.mono, styles.dim)}>—</span> : <HqCount value={kpi.value} className={cx(styles.kValSm, styles.mono, kpi.tone === "alert" && styles.kAlert)} />}
              <span className={styles.kNote}>{kpi.note}</span>
            </button>
          ))}
        </aside>
      ) : null}
      </div>

      <div className={cx(styles.glass, styles.dock)} role="toolbar" aria-label="Bảng thông tin">
        <button type="button" aria-pressed={kpiOpen} onClick={toggleKpi}>Chỉ số</button>
        <button type="button" aria-pressed={drawer === "feed"} onClick={() => { setSelected(null); setDrawer((value) => value === "feed" ? null : "feed"); }}>Đang diễn ra{data.feed.length ? <i>{data.feed.length}</i> : null}</button>
        <button type="button" aria-pressed={drawer === "team"} onClick={() => { setSelected(null); setDrawer((value) => value === "team" ? null : "team"); }}>Đội ngũ</button>
        <span className={styles.dockSep} />
        <button type="button" aria-pressed={view === "2d"} onClick={() => saveHqView("2d")}>2.5D</button>
        <button type="button" aria-pressed={view === "3d"} onClick={() => saveHqView("3d")}>3D</button>
      </div>

      {open ? (
        <aside className={cx(styles.glass, styles.drawer)} aria-label="Thông tin">
          <button type="button" className={styles.drawerClose} onClick={close} aria-label="Đóng">×</button>
          <div className={styles.drawerBody}>
            {selected?.type === "room" ? <RoomSummary room={selected.key} data={data} onPick={pickPerson} onFloor={(href) => { close(); router.push(href); }} />
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
                <div className={styles.drawerHead}><strong>Đội ngũ</strong><span>{data.team.length} người · bấm để xem trên bản đồ</span></div>
                {data.team.length ? data.team.map((member) => <PersonRow key={member.id} person={member} onPick={pickPerson} />) : <p className={styles.drawerEmpty}>Chưa có thành viên ở tầng này.</p>}
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

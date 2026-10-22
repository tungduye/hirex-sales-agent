import type { ReactNode } from "react";
import Link from "next/link";
import type { HqData, HqMember } from "@/modules/crm/dashboard/server/hq-data";
import { HqAutoRefresh, HqClock, HqCount, HqCountdown } from "@/modules/crm/dashboard/components/hq-live";
import { HqAvatar, HqMap } from "@/modules/crm/dashboard/components/hq-map";
import styles from "@/modules/crm/dashboard/components/hq.module.css";

// HireX HQ, mức 1: the live control-room view of Tổng quan (KPIs, rooms, what is happening, the team).
// Mức 2: the rooms are a 2.5D office map (hq-map.tsx) with the members at their desks.

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const PILL = { alert: styles.alert, info: styles.info, meet: styles.meet, plain: styles.plain, busy: styles.busy, idle: styles.idle } as const;
const KPI_PILL = { alert: "Cần xử lý", info: "Human", meet: "Lịch hẹn", plain: "Zalo" } as const;
const FLOORS = [["ALL", "/", "Toàn công ty"], ["REC", "/?tang=rec", "Tầng Rec"], ["SALE", "/?tang=sale", "Tầng Sale"]] as const;

function teamNote(team: HqMember[]) {
  const rec = team.filter((person) => /rec/iu.test(person.department ?? "")).length;
  const sale = team.filter((person) => /sale/iu.test(person.department ?? "")).length;
  return [rec ? `Rec ${rec}` : null, sale ? `Sale ${sale}` : null].filter(Boolean).join(" · ") || `${team.length} người`;
}

export function HqView({ data, brief }: { data: HqData; brief?: ReactNode }) {
  return (
    <div className={styles.hq}>
      <HqAutoRefresh />
      <header className={cx(styles.glass, styles.header)}>
        <div className={styles.row} style={{ marginRight: 8 }}>
          <span className={styles.logo} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 4v16M19 4v16M5 12h14" /></svg>
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong className={styles.title}>HireX HQ</strong>
            <span className={styles.subtitle}>Xin chào, {data.fullName ?? "bạn"}</span>
          </div>
        </div>
        <nav className={styles.row} aria-label="Tầng" style={{ flexWrap: "wrap", gap: 6 }}>
          {FLOORS.map(([key, href, label]) => <Link key={key} href={href} className={cx(styles.chip, data.floor === key && styles.chipOn)} aria-current={data.floor === key ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className={styles.spacer} />
        {data.liveNicks !== null ? <span className={cx(styles.chip, styles.chipLive)} title="Số nick Zalo đang kết nối"><span className={styles.pulse} />Live · {data.liveNicks} nick Zalo</span> : null}
        {data.nextMeetingAt ? <span className={styles.chip} title={data.nextMeetingTitle ?? undefined}>Lịch kế tiếp sau <HqCountdown at={data.nextMeetingAt} className={cx(styles.mono, styles.strong)} /></span> : <span className={styles.chip}>Hết lịch hôm nay</span>}
        <HqClock className={cx(styles.chip, styles.mono, styles.strong)} />
      </header>

      <section className={styles.kpis} aria-label="Chỉ số chính">
        {data.kpis.map((kpi) => (
          <Link key={kpi.key} href={kpi.href} prefetch={false} className={cx(styles.glass, styles.kpi)}>
            <div className={styles.row} style={{ justifyContent: "space-between" }}>
              <span className={styles.kLabel}>{kpi.label}</span>
              <span className={cx(styles.pill, PILL[kpi.tone])}>{KPI_PILL[kpi.tone]}</span>
            </div>
            {kpi.value === null ? <span className={cx(styles.kVal, styles.mono, styles.dim)}>—</span> : <HqCount value={kpi.value} className={cx(styles.kVal, styles.mono)} />}
            <span className={styles.kNote}>{kpi.note}</span>
          </Link>
        ))}
      </section>

      <HqMap rooms={data.rooms} team={data.team} stats={data.stats} floor={data.floor} />

      <section className={styles.lower}>
        <div className={cx(styles.glass, styles.panel)}>
          <div className={cx(styles.row, styles.panelHead)}>
            <strong className={styles.panelTitle}>Đang diễn ra</strong>
            <span className={styles.panelNote}>{data.feed.length ? `${data.feed.length} mới nhất` : ""}</span>
          </div>
          {data.feed.length ? data.feed.map((item, index) => {
            const body = <><span className={cx(styles.pill, PILL[item.tone])}>{item.kind}</span><span className={styles.itemText} title={item.text}>{item.text}</span><span className={cx(styles.itemAt, styles.mono)}>{item.at}</span></>;
            return item.href ? <Link key={index} href={item.href} prefetch={false} className={styles.item}>{body}</Link> : <div key={index} className={styles.item}>{body}</div>;
          }) : <p className={styles.empty}>Chưa có hoạt động mới.</p>}
        </div>
        <div className={cx(styles.glass, styles.panel)}>
          <div className={cx(styles.row, styles.panelHead)}>
            <strong className={styles.panelTitle}>Đội ngũ</strong>
            <span className={styles.panelNote}>{teamNote(data.team)}</span>
          </div>
          <div className={styles.scroll}>
          {data.team.length ? data.team.map((person) => (
            <div key={person.id} className={styles.item}>
              <span className={styles.teamAv} aria-hidden="true"><HqAvatar person={person} size={28} /></span>
              <span className={styles.who}>
                <span className={styles.whoName}>{person.name}{person.department ? <span className={styles.whoRole}>{person.department}</span> : null}</span>
                <span className={styles.whoDoing}>{person.doing}</span>
              </span>
              {person.tone === "idle" ? null : <span className={cx(styles.pill, PILL[person.tone])}>{person.status}</span>}
            </div>
          )) : <p className={styles.empty}>Chưa có thành viên ở tầng này (gán Bộ phận ở Vai trò và phân quyền).</p>}
          </div>
        </div>
      </section>

      {brief ? (
        <section className={cx(styles.glass, styles.brief)} aria-label="Bản tin hôm nay">
          <strong className={styles.panelTitle}>Lễ tân · Soda</strong>
          <div className={styles.briefBody}>{brief}</div>
        </section>
      ) : null}
    </div>
  );
}

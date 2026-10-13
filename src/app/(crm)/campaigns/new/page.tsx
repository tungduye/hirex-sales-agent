import Link from "next/link";
import { CheckCircle2, Users, Mail, Send, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  addCampaignContacts,
  addCampaignFollowUp,
  createCampaign,
  deleteDraftCampaign,
  deleteLastCampaignFollowUp,
  importCampaignAudience,
  moveCampaignFollowUp,
  removeCampaignSender,
  removeCampaignStepAttachment,
  reorderCampaignStepAttachment,
  setCampaignSenders,
  transitionCampaign,
  updateCampaign,
  updateCampaignStep,
  updateEmailCampaignPacing,
  uploadCampaignStepAttachments,
} from "@/modules/campaigns/server/campaign-actions";
import { getCampaign } from "@/modules/campaigns/server/campaign-data";
import { listContacts } from "@/modules/crm/contacts/server/list-contacts";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import { RichEmailEditor } from "@/modules/campaigns/components/rich-email-editor";
import { ConfirmSubmitButton } from "@/modules/campaigns/components/confirm-submit-button";
const stages = [
  {
    key: "basics",
    label: "Thông tin & nội dung",
    help: "Tên, mục tiêu và email mở đầu",
    icon: Mail,
  },
  {
    key: "audience",
    label: "Người nhận",
    help: "Nhập hoặc chọn khách hàng",
    icon: Users,
  },
  {
    key: "sequence",
    label: "Chuỗi email",
    help: "File đính kèm và follow-up",
    icon: ListChecks,
  },
  {
    key: "senders",
    label: "Nguồn gửi",
    help: "Chọn nhiều Gmail và chia quota",
    icon: Send,
  },
  {
    key: "review",
    label: "Kiểm tra & chạy",
    help: "Xác nhận lần cuối trước khi gửi",
    icon: CheckCircle2,
  },
] as const;
type Stage = (typeof stages)[number]["key"];
type Attachment = {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
};
type Draft = {
  id: string;
  name: string;
  status: string;
  subject_template: string;
  body_text_template: string;
  combo_uv: string | null;
  placement: string | null;
  channel_rank: string | null;
  owner_name: string | null;
  campaign_type: string;
  campaign_type_color: string;
  daily_message_limit: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  batch_size: number;
  batch_pause_minutes: number;
  email_campaign_recipients: {
    id: string;
    email: string;
    display_name: string | null;
    company: string | null;
  }[];
  email_campaign_steps: {
    id: string;
    step_order: number;
    delay_minutes: number;
    subject_template: string;
    body_text_template: string;
    body_html_template: string | null;
    email_campaign_step_attachments: {
      sort_order: number;
      email_attachments: Attachment;
    }[];
  }[];
  email_campaign_senders: {
    id: string;
    email_account_id: string;
    daily_cap: number;
    per_minute_cap: number;
    enabled: boolean;
  }[];
};
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string; stage?: string }>;
}) {
  const q = await searchParams;
  const stage = (
    stages.some((s) => s.key === q.stage) ? q.stage : "basics"
  ) as Stage;
  const row = (q.campaignId
    ? await getCampaign(q.campaignId)
    : null) as unknown as Draft | null;
  if (stage !== "basics" && (!row || row.status !== "DRAFT"))
    return (
      <>
        <PageHeader title="Không tìm thấy bản nháp" />
        <Link href="/campaigns/new" className="text-blue-600">
          Tạo chiến dịch mới
        </Link>
      </>
    );
  const [contacts, accounts] = row
    ? await Promise.all([listContacts(), listEmailAccounts()])
    : [{ contacts: [] }, { accounts: [] }];
  const url = (s: Stage) =>
    `/campaigns/new?campaignId=${row?.id ?? ""}&stage=${s}`;
  return (
    <>
      <PageHeader
        title={row ? "Chỉnh sửa chiến dịch" : "Tạo chiến dịch Email Marketing"}
        description="5 bước rõ ràng, lưu liên tục và chỉ khởi chạy sau khi bạn xác nhận."
      />
      <div className="mb-6 grid gap-2 md:grid-cols-5">
        {stages.map((s, i) => (
          <Link
            href={
              row ? url(s.key) : s.key === "basics" ? "/campaigns/new" : "#"
            }
            key={s.key}
            className={`rounded-xl border p-3 ${s.key === stage ? "border-blue-300 bg-blue-50" : "bg-white"}`}
          >
            <s.icon className="mb-2 size-4 text-blue-600" />
            <p className="text-xs text-slate-500">Bước {i + 1}</p>
            <p className="text-sm font-semibold">{s.label}</p>
            <p className="mt-1 text-xs text-slate-500">{s.help}</p>
          </Link>
        ))}
      </div>
      {stage === "basics" && (
        <form
          action={row ? updateCampaign : createCampaign}
          className="max-w-4xl space-y-5 rounded-xl border bg-white p-6"
        >
          {row && <input type="hidden" name="campaignId" value={row.id} />}
          <div>
            <h2 className="text-lg font-semibold">Thông tin chiến dịch</h2>
            <p className="text-sm text-slate-500">
              Các trường này xuất hiện trong danh sách và báo cáo tổng hợp.
            </p>
          </div>
          <Field
            name="name"
            label="Tên chiến dịch"
            max={200}
            value={row?.name}
          />
          <div className="grid gap-4 md:grid-cols-[1fr_110px]">
            <Field name="campaignType" label="Loại chiến dịch" max={100} value={row?.campaign_type ?? "Email Marketing"} />
            <label className="text-sm font-medium">Màu nhãn<input name="campaignTypeColor" type="color" defaultValue={row?.campaign_type_color ?? "#7c3aed"} className="mt-2 h-10 w-full rounded-lg border bg-white p-1" /></label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              name="comboUv"
              label="Combo UV"
              max={200}
              optional
              value={row?.combo_uv}
            />
            <Field
              name="placement"
              label="Vị trí"
              max={200}
              optional
              value={row?.placement}
            />
            <Field
              name="channelRank"
              label="Xếp hạng kênh"
              max={200}
              optional
              value={row?.channel_rank}
            />
            <Field
              name="ownerName"
              label="Owner"
              max={200}
              optional
              value={row?.owner_name}
            />
          </div>
          <Field
            name="subject"
            label="Tiêu đề email đầu tiên"
            max={998}
            value={row?.subject_template}
          />
          <RichEmailEditor
            initialHtml={
              row?.email_campaign_steps.find((s) => s.step_order === 0)
                ?.body_html_template ??
              plainTextHtml(row?.body_text_template ?? "")
            }
          />
          <p className="text-xs text-slate-500">
            Biến cá nhân hóa:{" "}
            {
              "{{name}}, {{first_name}}, {{last_name}}, {{company}}, {{position}}, {{email}}"
            }
          </p>
          <div className="flex flex-wrap gap-3">
            <Button>
              {row ? "Lưu thay đổi và tiếp tục" : "Lưu bản nháp và tiếp tục"}
            </Button>
            {row && (
              <ConfirmSubmitButton
                formAction={deleteDraftCampaign}
                message="Xóa vĩnh viễn bản nháp này? Dữ liệu người nhận và file đính kèm của bản nháp cũng sẽ bị xóa."
                className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700"
              >
                Xóa vĩnh viễn bản nháp
              </ConfirmSubmitButton>
            )}
          </div>
        </form>
      )}
      {row && stage === "audience" && (
        <Panel title="Audience" next={url("sequence")}>
          <p className="text-sm text-slate-600">CSV/XLSX tối đa 5 MB, 20.000 dòng; đọc sheet đầu tiên. Nhận cột Email và Tên ứng viên/name. Nhập lại cùng chiến dịch sẽ bỏ qua email trùng, không ghi đè trạng thái gửi.</p>
          {(q as Record<string,string>).importError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">Không thể nhập file: {({EMPTY_FILE:"File không có dữ liệu.",FILE_SIZE:"File vượt 5 MB.",FILE_TYPE:"Chỉ hỗ trợ CSV/XLSX.",NOT_DRAFT:"Chỉ nhập vào chiến dịch nháp.",ROW_LIMIT:"Vượt 20.000 dòng.",IMPORT_ROW_LIMIT:"Vượt 20.000 dòng.",COLUMN_LIMIT:"Vượt 100 cột.",MISSING_EMAIL:"Thiếu cột Email ở dòng đầu.",DUPLICATE_HEADERS:"Tên cột bị trùng sau chuẩn hóa.",READ_FAILED:"Không đọc được file. Kiểm tra định dạng."} as Record<string,string>)[(q as Record<string,string>).importError]??"Vui lòng kiểm tra file."}</p>}
          {Number((q as Record<string,string>).failedRows)>0 && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">Có dòng chưa nhập được. Kiểm tra chiến dịch còn ở trạng thái nháp rồi nhập lại cùng file; email đã có sẽ được bỏ qua.</p>}
          {(q as Record<string, string | undefined>).sourceRows && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Source", "sourceRows"],
                ["Valid", "validRows"],
                ["Duplicates", "duplicateRows"],
                ["Invalid", "invalidEmailRows"],
                ["Suppressed", "suppressedRows"],
                ["Added", "addedRows"],
                ["Chưa nhập được", "failedRows"],
              ].map(([label, key]) => (
                <div className="rounded border p-3 text-sm" key={key}>
                  <span className="text-slate-500">{label}</span>
                  <b className="block text-lg">
                    {(q as Record<string, string | undefined>)[key]}
                  </b>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <form
              action={importCampaignAudience}
              className="space-y-3 rounded border p-4"
            >
              <input type="hidden" name="campaignId" value={row.id} />
              <input type="file" name="file" accept=".csv,.xlsx" required />
              <Button>Import CSV/XLSX</Button>
            </form>
            <form action={addCampaignContacts} className="rounded border p-4">
              <input type="hidden" name="campaignId" value={row.id} />
              <div className="max-h-48 overflow-auto">
                {contacts.contacts
                  .filter((c) => c.email)
                  .slice(0, 100)
                  .map((c) => (
                    <label className="block text-sm" key={c.id}>
                      <input type="checkbox" name="contactId" value={c.id} />{" "}
                      {c.fullName} — {c.email}
                    </label>
                  ))}
              </div>
              <Button>Add CRM contacts</Button>
            </form>
          </div>
          <p className="text-sm">
            Current audience: <b>{row.email_campaign_recipients.length}</b>
          </p>
          {row.email_campaign_recipients.slice(0, 5).map((r) => (
            <p className="text-sm text-slate-600" key={r.id}>
              {r.display_name || r.email} · {r.company || "—"}
            </p>
          ))}
        </Panel>
      )}
      {row && stage === "sequence" && (
        <Panel title="Chuỗi email" next={url("senders")}>
          <p className="text-sm text-slate-500">
            Mỗi bước có khu vực file riêng. Follow-up chỉ được thêm bằng biểu
            mẫu độc lập bên dưới.
          </p>
          <div className="space-y-4">
            {row.email_campaign_steps
              .sort((a, b) => a.step_order - b.step_order)
              .map((s, i) => (
                <div className="rounded-xl border p-5" key={s.id}>
                  <div>
                    <b>
                      {s.step_order === 0
                        ? "Email đầu tiên"
                        : `Follow-up ${s.step_order}`}
                    </b>
                    {s.step_order > 0 && (
                      <span className="text-sm text-slate-500">
                        {" "}
                        · gửi sau {s.delay_minutes} phút
                      </span>
                    )}
                    <p className="mt-1 text-sm">
                      Tiêu đề: {s.subject_template}
                    </p>
                  </div>
                  <AttachmentEditor campaignId={row.id} step={s} />
                  {s.step_order > 0 && (
                    <div className="mt-3 flex gap-2">
                      {(["UP", "DOWN"] as const).map((d) => (
                        <form action={moveCampaignFollowUp} key={d}>
                          <input
                            type="hidden"
                            name="campaignId"
                            value={row.id}
                          />
                          <input type="hidden" name="stepId" value={s.id} />
                          <input type="hidden" name="direction" value={d} />
                          <button
                            className="rounded border px-2 py-1 text-xs"
                            disabled={
                              (d === "UP" && i === 1) ||
                              (d === "DOWN" &&
                                i === row.email_campaign_steps.length - 1)
                            }
                          >
                            {d === "UP" ? "Đưa lên" : "Đưa xuống"}
                          </button>
                        </form>
                      ))}
                      {i === row.email_campaign_steps.length - 1 && (
                        <form action={deleteLastCampaignFollowUp}>
                          <input
                            type="hidden"
                            name="campaignId"
                            value={row.id}
                          />
                          <input type="hidden" name="stepId" value={s.id} />
                          <button className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">
                            Xóa follow-up
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
          {row.email_campaign_steps.length < 6 && (
            <form
              action={addCampaignFollowUp}
              className="space-y-4 rounded-xl border-2 border-dashed p-5"
            >
              <div>
                <h3 className="font-semibold">Thêm follow-up mới</h3>
                <p className="text-sm text-slate-500">
                  Tối đa 5 follow-up. Thời gian chờ tính từ email trước đó.
                </p>
              </div>
              <input type="hidden" name="campaignId" value={row.id} />
              <label className="block text-sm font-medium">
                Chờ bao nhiêu phút?
                <input
                  className="mt-2 h-11 w-full rounded-lg border px-3"
                  name="delayMinutes"
                  type="number"
                  min="1"
                  defaultValue="1440"
                />
              </label>
              <label className="block text-sm font-medium">
                Tiêu đề follow-up
                <input
                  className="mt-2 h-11 w-full rounded-lg border px-3"
                  name="subject"
                  required
                />
              </label>
              <RichEmailEditor label="Nội dung follow-up" />
              <Button>Thêm follow-up</Button>
            </form>
          )}
        </Panel>
      )}
      {row && stage === "senders" && (
        <Panel title="Nguồn gửi và quota" next={url("review")}>
          <p className="text-sm text-slate-500">
            Có thể chọn nhiều Gmail. Hệ thống luân phiên nguồn gửi và không vượt
            quota riêng của từng tài khoản hoặc quota toàn cục.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {accounts.accounts
              .filter((a) => a.status === "CONNECTED" && a.sendEnabled)
              .map((a) => {
                const configured = row.email_campaign_senders.find(
                  (s) => s.email_account_id === a.id,
                );
                return (
                  <form
                    action={setCampaignSenders}
                    className={`space-y-3 rounded-xl border p-4 ${configured ? "border-blue-300 bg-blue-50/40" : ""}`}
                    key={a.id}
                  >
                    <input type="hidden" name="campaignId" value={row.id} />
                    <input type="hidden" name="emailAccountId" value={a.id} />
                    <div>
                      <b>{a.emailAddress}</b>
                      <p className="text-xs text-slate-500">
                        {configured
                          ? "Đang tham gia chiến dịch"
                          : "Chưa được chọn"}
                      </p>
                    </div>
                    <label className="block text-sm">
                      Quota mỗi ngày
                      <input
                        name="dailyCap"
                        type="number"
                        min="1"
                        max="2000"
                        defaultValue={configured?.daily_cap ?? 100}
                        className="mt-1 h-10 w-full rounded border px-3"
                      />
                    </label>
                    <label className="block text-sm">
                      Quota mỗi phút
                      <input
                        name="perMinuteCap"
                        type="number"
                        min="1"
                        max="100"
                        defaultValue={configured?.per_minute_cap ?? 10}
                        className="mt-1 h-10 w-full rounded border px-3"
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button>
                        {configured ? "Cập nhật quota" : "Thêm nguồn gửi"}
                      </Button>
                      {configured && (
                        <button
                          formAction={removeCampaignSender}
                          className="rounded border border-rose-200 px-3 text-sm text-rose-700"
                        >
                          Bỏ khỏi chiến dịch
                        </button>
                      )}
                    </div>
                  </form>
                );
              })}
          </div>
          <p className="text-sm">
            <b>{row.email_campaign_senders.length}</b> tài khoản đã chọn.
          </p>
          <form action={updateEmailCampaignPacing} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
            <input type="hidden" name="campaignId" value={row.id} />
            <div><b>Nhịp gửi an toàn toàn chiến dịch</b><p className="text-xs text-slate-500">Áp dụng chung cho mọi Gmail; quota từng tài khoản phía trên vẫn được giữ.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-sm">Giới hạn tin/ngày<input className="mt-1 h-10 w-full rounded border px-3" name="dailyMessageLimit" type="number" min="1" max="5000" defaultValue={row.daily_message_limit}/></label>
              <label className="text-sm">Nghỉ tối thiểu (giây)<input className="mt-1 h-10 w-full rounded border px-3" name="minDelaySeconds" type="number" min="5" max="86400" defaultValue={row.min_delay_seconds}/></label>
              <label className="text-sm">Nghỉ tối đa (giây)<input className="mt-1 h-10 w-full rounded border px-3" name="maxDelaySeconds" type="number" min="5" max="86400" defaultValue={row.max_delay_seconds}/></label>
              <label className="text-sm">Số tin mỗi đợt<input className="mt-1 h-10 w-full rounded border px-3" name="batchSize" type="number" min="1" max="1000" defaultValue={row.batch_size}/></label>
              <label className="text-sm">Nghỉ sau mỗi đợt (phút)<input className="mt-1 h-10 w-full rounded border px-3" name="batchPauseMinutes" type="number" min="1" max="1440" defaultValue={row.batch_pause_minutes}/></label>
            </div>
            <Button>Lưu nhịp gửi</Button>
          </form>
        </Panel>
      )}
      {row && stage === "review" && (
        <Panel title="Kiểm tra và khởi chạy">
          <dl className="grid gap-3 md:grid-cols-2">
            <dt>Tên chiến dịch</dt>
            <dd>{row.name}</dd>
            <dt>Combo UV</dt>
            <dd>{row.combo_uv || "—"}</dd>
            <dt>Vị trí</dt>
            <dd>{row.placement || "—"}</dd>
            <dt>Xếp hạng kênh</dt>
            <dd>{row.channel_rank || "—"}</dd>
            <dt>Owner</dt>
            <dd>{row.owner_name || "—"}</dd>
            <dt>Đối tượng</dt>
            <dd>{row.email_campaign_recipients.length}</dd>
            <dt>Chuỗi email</dt>
            <dd>{row.email_campaign_steps.length} bước</dd>
            <dt>Nguồn gửi đi</dt>
            <dd>{row.email_campaign_senders.length} tài khoản</dd>
          </dl>
          <div className="space-y-2">
            {row.email_campaign_steps
              .sort((a, b) => a.step_order - b.step_order)
              .map((step) => {
                const files = step.email_campaign_step_attachments ?? [];
                return (
                  <div
                    className="rounded-lg bg-slate-50 p-3 text-sm"
                    key={step.id}
                  >
                    <b>
                      {step.step_order === 0
                        ? "INITIAL"
                        : `FOLLOW_UP_${step.step_order}`}
                    </b>
                    <span className="ml-2">{step.subject_template}</span>
                    <p className="text-slate-500">
                      {files.length} attachments ·{" "}
                      {formatBytes(
                        files.reduce(
                          (n, x) => n + x.email_attachments.size_bytes,
                          0,
                        ),
                      )}
                    </p>
                    <p>
                      {files
                        .map((x) => x.email_attachments.original_filename)
                        .join(", ") || "No attachments"}
                    </p>
                  </div>
                );
              })}
          </div>
          {(!row.email_campaign_recipients.length ||
            !row.email_campaign_senders.length) && (
            <p className="rounded bg-amber-50 p-3 text-sm">
              Launch blocked: audience and a send-enabled Gmail sender are
              required.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Launch
              id={row.id}
              target="RUNNING"
              disabled={
                !row.email_campaign_recipients.length ||
                !row.email_campaign_senders.length
              }
            />
            <form action={transitionCampaign} className="flex gap-2">
              <input type="hidden" name="campaignId" value={row.id} />
              <input type="hidden" name="target" value="SCHEDULED" />
              <input name="scheduledAt" type="datetime-local" required />
              <Button
                disabled={
                  !row.email_campaign_recipients.length ||
                  !row.email_campaign_senders.length
                }
              >
                Schedule
              </Button>
            </form>
          </div>
        </Panel>
      )}
    </>
  );
}
function Field({
  name,
  label,
  max,
  optional = false,
  value,
}: {
  name: string;
  label: string;
  max: number;
  optional?: boolean;
  value?: string | null;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        name={name}
        required={!optional}
        maxLength={max}
        defaultValue={value ?? ""}
        className="mt-2 h-11 w-full rounded-lg border px-3"
      />
    </label>
  );
}
function Panel({
  title,
  next,
  children,
}: {
  title: string;
  next?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-5xl space-y-5 rounded-xl border bg-white p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
      {next && (
        <Link
          href={next}
          className="inline-flex rounded bg-blue-600 px-4 py-2 text-sm text-white"
        >
          Save & continue
        </Link>
      )}
    </section>
  );
}
function Launch({
  id,
  target,
  disabled,
}: {
  id: string;
  target: "RUNNING";
  disabled: boolean;
}) {
  return (
    <form action={transitionCampaign}>
      <input type="hidden" name="campaignId" value={id} />
      <input type="hidden" name="target" value={target} />
      <Button disabled={disabled}>Start</Button>
    </form>
  );
}
function AttachmentEditor({
  campaignId,
  step,
}: {
  campaignId: string;
  step: Draft["email_campaign_steps"][number];
}) {
  const files = [...(step.email_campaign_step_attachments ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  return (
    <div className="mt-4 space-y-4">
      {step.step_order > 0 && (
        <details className="rounded-lg border bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Chỉnh sửa nội dung follow-up
          </summary>
          <form action={updateCampaignStep} className="space-y-4 border-t p-4">
            <input type="hidden" name="campaignId" value={campaignId} />
            <input type="hidden" name="stepId" value={step.id} />
            <label className="block text-sm">
              Thời gian chờ (phút)
              <input
                className="mt-1 h-10 w-full rounded border px-3"
                name="delayMinutes"
                type="number"
                min="1"
                defaultValue={step.delay_minutes}
              />
            </label>
            <label className="block text-sm">
              Tiêu đề
              <input
                className="mt-1 h-10 w-full rounded border px-3"
                name="subject"
                defaultValue={step.subject_template}
              />
            </label>
            <RichEmailEditor
              initialHtml={
                step.body_html_template ??
                plainTextHtml(step.body_text_template)
              }
            />
            <Button>Lưu follow-up</Button>
          </form>
        </details>
      )}
      <div className="rounded-lg border border-dashed bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <b className="text-sm">File đính kèm</b>
          <span className="text-xs text-slate-500">
            {files.length} file ·{" "}
            {formatBytes(
              files.reduce((n, x) => n + x.email_attachments.size_bytes, 0),
            )}
          </span>
        </div>
        <form
          action={uploadCampaignStepAttachments}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="stepId" value={step.id} />
          <label className="cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm">
            Chọn một hoặc nhiều file
            <input
              className="sr-only"
              type="file"
              name="attachments"
              required
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg"
            />
          </label>
          <Button>Tải lên</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Có thể chọn tối đa 10 file trong một lần; hệ thống vẫn áp dụng giới
          hạn số lượng và dung lượng an toàn.
        </p>
        <div className="mt-3 space-y-2">
          {files.map((link, index) => {
            const file = link.email_attachments;
            return (
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-sm"
                key={file.id}
              >
                <span className="min-w-0 flex-1 truncate">
                  {file.original_filename} · {formatBytes(file.size_bytes)}
                </span>
                <Link
                  className="text-blue-600"
                  href={`/api/campaigns/${campaignId}/attachments/${file.id}`}
                >
                  Tải xuống
                </Link>
                {(["UP", "DOWN"] as const).map((direction) => (
                  <form action={reorderCampaignStepAttachment} key={direction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="stepId" value={step.id} />
                    <input type="hidden" name="attachmentId" value={file.id} />
                    <input type="hidden" name="direction" value={direction} />
                    <button
                      disabled={
                        (direction === "UP" && index === 0) ||
                        (direction === "DOWN" && index === files.length - 1)
                      }
                      className="rounded border px-2 py-1 text-xs"
                    >
                      {direction === "UP" ? "Lên" : "Xuống"}
                    </button>
                  </form>
                ))}
                <form action={removeCampaignStepAttachment}>
                  <input type="hidden" name="campaignId" value={campaignId} />
                  <input type="hidden" name="stepId" value={step.id} />
                  <input type="hidden" name="attachmentId" value={file.id} />
                  <button
                    className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700"
                    aria-label={`Xóa ${file.original_filename}`}
                  >
                    Xóa
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function plainTextHtml(value: string) {
  return `<p>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`;
}

"use client";

import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ChevronDown, ChevronUp, LoaderCircle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContentBatch } from "@/modules/content/server/content-actions";
import { initialCreateContentState } from "@/modules/content/core/content-state";
import { MAX_CONTENT_QUANTITY, MAX_TEMPLATES_PER_BATCH, OTHER_OPTION, type ContentDepartment } from "@/modules/content/core/content-options";
import { useContentLists } from "@/modules/content/components/content-settings-context";
import type { ContentTemplate } from "@/modules/content/server/template-row";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";

const inputClass = "block w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";

const TOPIC_LABEL: Record<string, { title: string; placeholder: string }> = {
  REC: { title: "Tên job", placeholder: "VD: BrSE Senior (Java)" },
  HR: { title: "Vị trí tuyển nội bộ", placeholder: "VD: Thực tập sinh Recruiter" },
  SALE: { title: "Chủ đề / ứng viên / dịch vụ", placeholder: "VD: Share UV PM người Nhật 15 năm" },
  CTV: { title: "Chương trình CTV", placeholder: "VD: Tuyển CTV giới thiệu ứng viên IT" },
  MEDIA: { title: "Chủ đề truyền thông", placeholder: "VD: Team building quý 3 / Kinh nghiệm phỏng vấn BrSE" },
  NOTICE: { title: "Nội dung thông báo", placeholder: "VD: Lịch nghỉ lễ 2/9 / Đổi địa điểm phỏng vấn" },
};

export function CreateContentDialog({ templates, categories, onClose, onCreated }: { templates: ContentTemplate[]; categories: ContentCategory[]; onClose: () => void; onCreated: (message: string) => void }) {
  const [state, formAction] = useActionState(createContentBatch, initialCreateContentState);
  const [pending, startTransition] = useTransition();
  const lists = useContentLists();
  const [department, setDepartment] = useState<ContentDepartment>(lists.departments.some((item) => item.value === "REC") ? "REC" : lists.departments[0]?.value ?? "REC");
  const [style, setStyle] = useState<string>(lists.styles[0]?.value ?? OTHER_OPTION);
  const [selected, setSelected] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const departmentCategories = categoriesOf(categories, department);
  const [showSample, setShowSample] = useState(false);

  useEffect(() => {
    if (state.success && state.message) onCreated(state.message);
  }, [state, onCreated]);

  const departmentTemplates = useMemo(() => templates.filter((template) => template.department === department), [templates, department]);

  function changeDepartment(next: ContentDepartment) {
    setDepartment(next);
    setSelected([]);
    setCategoryId("");
  }

  // Submitting through onSubmit (not <form action>) keeps what was typed if the server rejects it.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const error = (name: string) => state.fieldErrors?.[name]?.[0];
  const topic = TOPIC_LABEL[department] ?? { title: "Tên job / chủ đề", placeholder: `VD: nội dung cho ${lists.departmentLabel(department)}` };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="create-content-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Đóng" onClick={onClose} disabled={pending} />
      <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-5">
          <div><h2 id="create-content-title" className="text-xl font-bold tracking-tight">Tạo content</h2><p className="mt-1 text-sm text-slate-500">Điền brief và chọn mẫu, AI sẽ viết và lưu vào kho. Mỗi content có mã riêng và không trùng quá 50% với content đã có.</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Đóng"><X className="size-5" /></Button>
        </div>
        <form onSubmit={submit} className="space-y-6 p-6">
          <div className="space-y-2" role="radiogroup" aria-label="Bộ phận">
            <p className="text-sm font-semibold text-slate-700">Bộ phận<span className="ml-1 text-rose-500">*</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {lists.departments.map((item) => (
                <label key={item.value} className="cursor-pointer">
                  <input type="radio" name="department" value={item.value} checked={department === item.value} onChange={() => changeDepartment(item.value)} disabled={pending} className="peer sr-only" />
                  <span className="flex h-10 items-center justify-center rounded-lg border bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:font-semibold peer-checked:text-blue-700 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-500">{item.label}</span>
                </label>
              ))}
            </div>
            {error("department") && <p className="text-xs text-rose-600">{error("department")}</p>}
          </div>

          {departmentCategories.length > 0 && <div className="space-y-2" role="radiogroup" aria-label="Phân loại">
            <p className="text-sm font-semibold text-slate-700">Phân loại</p>
            <div className="flex flex-wrap gap-2">
              {[{ id: "", name: "Không phân loại" }, ...departmentCategories].map((item) => (
                <label key={item.id || "none"} className="cursor-pointer">
                  <input type="radio" name="categoryId" value={item.id} checked={categoryId === item.id} onChange={() => setCategoryId(item.id)} disabled={pending} className="peer sr-only" />
                  <span className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-violet-600 peer-checked:bg-violet-50 peer-checked:font-semibold peer-checked:text-violet-700 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-500">{item.name}</span>
                </label>
              ))}
            </div>
            {error("categoryId") && <p className="text-xs text-rose-600">{error("categoryId")}</p>}
          </div>}

          <Section title="Thông tin">
            <Field label={topic.title} required error={error("jobTitle")}><input name="jobTitle" required maxLength={200} disabled={pending} placeholder={topic.placeholder} className={cn(inputClass, "h-11")} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vị trí / cấp bậc" error={error("position")}><input name="position" maxLength={200} disabled={pending} placeholder="Senior, Team Lead…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Địa điểm" hint={department === "CTV" ? undefined : "Có địa điểm thì tiêu đề bắt đầu bằng [Địa điểm]."} error={error("location")}><input name="location" maxLength={200} disabled={pending} placeholder="Hà Nội, HCM, Tokyo…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Ngoại ngữ" error={error("languagesRequired")}><input name="languagesRequired" maxLength={200} disabled={pending} placeholder="Tiếng Nhật N2, tiếng Anh giao tiếp…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Lương" error={error("salary")}><input name="salary" maxLength={200} disabled={pending} placeholder="50 – 60M gross, 500 – 700 man/năm…" className={cn(inputClass, "h-11")} /></Field>
            </div>
            <Field label="Skill tech" error={error("techSkills")}><input name="techSkills" maxLength={1000} disabled={pending} placeholder="Java, Spring Boot, AWS…" className={cn(inputClass, "h-11")} /></Field>
            <Field label="Keypoint / điểm nổi bật" error={error("highlights")}><textarea name="highlights" rows={2} maxLength={2000} disabled={pending} placeholder="Bảo hiểm full lương, công ty 100% vốn Nhật, process 1 vòng…" className={cn(inputClass, "py-2")} /></Field>
            <Field label="Mô tả JD / facts nguồn" hint="AI chỉ dùng dữ kiện có ở đây và các ô trên." error={error("jdText")}><textarea name="jdText" rows={4} maxLength={8000} disabled={pending} placeholder="Dán yêu cầu, nhiệm vụ, quyền lợi… (không bắt buộc)" className={cn(inputClass, "py-2")} /></Field>
            <Field label="Từ khóa cấm" hint="Tên khách hàng, website… AI không được nhắc tới. Cách nhau bằng dấu ; hoặc ," error={error("blockedTerms")}><input name="blockedTerms" maxLength={1000} disabled={pending} placeholder="VD: ABC Japan; abc.co.jp" className={cn(inputClass, "h-11")} /></Field>
          </Section>

          <Section title="Mẫu content">
            <TemplatePicker templates={departmentTemplates} selected={selected} onChange={setSelected} disabled={pending} />
            {error("templateIds") && <p className="text-xs text-rose-600">{error("templateIds")}</p>}
            <button type="button" className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline" onClick={() => setShowSample((value) => !value)}>{showSample ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}Dán thêm một bài mẫu khác</button>
            {showSample && <Field label="Content mẫu tự dán" hint="Dùng như một mẫu: AI viết theo bố cục và giọng của bài này, dữ kiện lấy từ brief." error={error("sampleContent")}><textarea name="sampleContent" rows={4} maxLength={6000} disabled={pending} className={cn(inputClass, "py-2")} /></Field>}
          </Section>

          <Section title="Cách viết">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phong cách" required hint="Dùng khi không có mẫu; có mẫu thì giọng văn theo mẫu." error={error("style")}>
                <select name="style" value={style} onChange={(event) => setStyle(event.target.value)} disabled={pending} className={cn(inputClass, "h-11")}>
                  {lists.styles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  <option value={OTHER_OPTION}>Khác…</option>
                </select>
                {style === OTHER_OPTION && <input name="styleOther" required maxLength={100} disabled={pending} placeholder="Nhập phong cách" className={cn(inputClass, "mt-2 h-10")} />}
              </Field>
              <Field label="Ghi chú phong cách" error={error("styleNote")}><input name="styleNote" maxLength={500} disabled={pending} placeholder="VD: xưng em, gọi anh em; emoji vừa phải" className={cn(inputClass, "h-11")} /></Field>
            </div>
          </Section>

          <Section title="Đầu ra">
            <ChoiceGroup label="Ngôn ngữ content" name="contentLanguage" options={lists.languages} disabled={pending} error={error("contentLanguage")} />
            <ChoiceGroup label="Định dạng content" name="contentFormat" options={lists.formats.map((item) => ({ ...item, label: item.hint ? `${item.label} · ${item.hint}` : item.label }))} defaultValue="POST_LONG" disabled={pending} error={error("contentFormat")} />
            <Field label={`Số lượng (1–${MAX_CONTENT_QUANTITY})`} required error={error("quantity")}><input name="quantity" type="number" min={1} max={MAX_CONTENT_QUANTITY} defaultValue={3} required disabled={pending} className={cn(inputClass, "h-11 sm:w-40")} /></Field>
          </Section>

          {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs text-slate-500 sm:mr-auto">AI viết trong nền khoảng 1–2 phút; tiến độ hiện ở đầu trang Kho content.</p>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Hủy</Button>
            <Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="size-4 animate-spin" />Đang gửi…</> : <><Sparkles className="size-4" />Tạo content</>}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TemplatePicker({ templates, selected, onChange, disabled }: { templates: ContentTemplate[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { languageLabel } = useContentLists();
  const full = selected.length >= MAX_TEMPLATES_PER_BATCH;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : full ? selected : [...selected, id]);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Mỗi content được viết sát theo một mẫu: cùng kiểu tiêu đề, mở bài, bố cục, độ dài, cách xưng hô và CTA, nhưng toàn bộ dữ kiện lấy từ brief ở trên. Chọn tối đa {MAX_TEMPLATES_PER_BATCH} mẫu; không chọn thì hệ thống tự chọn mẫu phù hợp nhất. <span className="font-semibold text-slate-700">Đã chọn {selected.length}/{MAX_TEMPLATES_PER_BATCH}</span></p>
      {selected.map((id) => <input key={id} type="hidden" name="templateId" value={id} />)}
      {templates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-slate-500">Bộ phận này chưa có mẫu. Thêm mẫu ở tab “Kho mẫu”.</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {templates.map((template) => {
            const checked = selected.includes(template.id);
            const open = openId === template.id;
            return (
              <li key={template.id} className={cn("px-3 py-2.5", checked && "bg-blue-50/60")}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={checked} disabled={disabled || (!checked && full)} onChange={() => toggle(template.id)} aria-label={`Chọn mẫu ${template.code}`} className="mt-1 size-4 shrink-0 accent-blue-600" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(open ? null : template.id)} aria-expanded={open}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-mono font-semibold text-blue-700">{template.code}</span>
                      {template.groupName && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{template.groupName}</span>}
                      <span className="text-slate-500">{languageLabel(template.language)}</span>
                    </span>
                    <span className={cn("mt-1 block whitespace-pre-wrap text-sm text-slate-700", !open && "line-clamp-2")}>{template.body}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-4"><legend className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</legend>{children}</fieldset>;
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

function ChoiceGroup({ label, name, options, defaultValue, disabled, error }: { label: string; name: string; options: readonly { value: string; label: string; hint?: string }[]; defaultValue?: string; disabled: boolean; error?: string }) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={label}>
      <p className="text-sm font-semibold text-slate-700">{label}<span className="ml-1 text-rose-500">*</span></p>
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => (
          <label key={option.value} className="cursor-pointer">
            <input type="radio" name={name} value={option.value} defaultChecked={defaultValue ? option.value === defaultValue : index === 0} disabled={disabled} className="peer sr-only" />
            <span title={option.hint} className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:font-semibold peer-checked:text-blue-700 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-500">{option.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

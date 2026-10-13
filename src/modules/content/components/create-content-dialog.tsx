"use client";

import { useActionState, useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AlertCircle, LoaderCircle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContentBatch } from "@/modules/content/server/content-actions";
import { initialCreateContentState } from "@/modules/content/core/content-state";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, CONTENT_STYLES, MAX_CONTENT_QUANTITY, OTHER_OPTION } from "@/modules/content/core/content-options";

const inputClass = "w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";

export function CreateContentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (message: string) => void }) {
  const [state, formAction] = useActionState(createContentBatch, initialCreateContentState);
  const [pending, startTransition] = useTransition();
  const [style, setStyle] = useState<string>(CONTENT_STYLES[0].value);
  const [department, setDepartment] = useState<string>(CONTENT_DEPARTMENTS[0].value);

  useEffect(() => {
    if (state.success && state.message) onCreated(state.message);
  }, [state, onCreated]);

  // Submitting through onSubmit (not <form action>) keeps what was typed if the server rejects it.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const error = (name: string) => state.fieldErrors?.[name]?.[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="create-content-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Đóng" onClick={onClose} disabled={pending} />
      <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-5">
          <div><h2 id="create-content-title" className="text-xl font-bold tracking-tight">Tạo content</h2><p className="mt-1 text-sm text-slate-500">Điền brief, AI sẽ viết và lưu vào kho. Mỗi content có mã riêng và không trùng quá 50% với content đã có.</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Đóng"><X className="size-5" /></Button>
        </div>
        <form onSubmit={submit} className="space-y-6 p-6">
          <Section title="Thông tin job">
            <Field label="Tên job" required error={error("jobTitle")}><input name="jobTitle" required maxLength={200} disabled={pending} placeholder="VD: Java Developer (Spring Boot)" className={cn(inputClass, "h-11")} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vị trí / cấp bậc" error={error("position")}><input name="position" maxLength={200} disabled={pending} placeholder="Senior, Team Lead…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Địa điểm" error={error("location")}><input name="location" maxLength={200} disabled={pending} placeholder="Hà Nội, Hybrid…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Ngoại ngữ" error={error("languagesRequired")}><input name="languagesRequired" maxLength={200} disabled={pending} placeholder="Tiếng Nhật N3, tiếng Anh giao tiếp…" className={cn(inputClass, "h-11")} /></Field>
              <Field label="Lương" error={error("salary")}><input name="salary" maxLength={200} disabled={pending} placeholder="Up to 2.500 USD, thoả thuận…" className={cn(inputClass, "h-11")} /></Field>
            </div>
            <Field label="Skill tech" error={error("techSkills")}><input name="techSkills" maxLength={1000} disabled={pending} placeholder="Java, Spring Boot, AWS, MySQL…" className={cn(inputClass, "h-11")} /></Field>
            <Field label="Điểm nổi bật" error={error("highlights")}><textarea name="highlights" rows={3} maxLength={2000} disabled={pending} placeholder="Onsite Nhật 3 tháng, thưởng 2 tháng lương, team trẻ…" className={cn(inputClass, "py-2")} /></Field>
          </Section>

          <Section title="Cách viết">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phong cách" required error={error("style")}>
                <select name="style" value={style} onChange={(event) => setStyle(event.target.value)} disabled={pending} className={cn(inputClass, "h-11")}>
                  {CONTENT_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  <option value={OTHER_OPTION}>Khác…</option>
                </select>
                {style === OTHER_OPTION && <input name="styleOther" required maxLength={100} disabled={pending} placeholder="Nhập phong cách" className={cn(inputClass, "mt-2 h-10")} />}
              </Field>
              <Field label="Bộ phận" required error={error("department")}>
                <select name="department" value={department} onChange={(event) => setDepartment(event.target.value)} disabled={pending} className={cn(inputClass, "h-11")}>
                  {CONTENT_DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  <option value={OTHER_OPTION}>Khác…</option>
                </select>
                {department === OTHER_OPTION && <input name="departmentOther" required maxLength={100} disabled={pending} placeholder="Nhập bộ phận" className={cn(inputClass, "mt-2 h-10")} />}
              </Field>
            </div>
            <Field label="Ghi chú phong cách" error={error("styleNote")}><input name="styleNote" maxLength={500} disabled={pending} placeholder="VD: xưng mình – bạn, dùng emoji vừa phải" className={cn(inputClass, "h-11")} /></Field>
            <Field label="Content mẫu" hint="Chỉ để AI tham khảo giọng văn và bố cục, không chép lại." error={error("sampleContent")}><textarea name="sampleContent" rows={4} maxLength={6000} disabled={pending} placeholder="Dán một bài mẫu (không bắt buộc)" className={cn(inputClass, "py-2")} /></Field>
          </Section>

          <Section title="Đầu ra">
            <ChoiceGroup label="Ngôn ngữ content" name="contentLanguage" options={CONTENT_LANGUAGES} disabled={pending} error={error("contentLanguage")} />
            <ChoiceGroup label="Định dạng content" name="contentFormat" options={CONTENT_FORMATS} disabled={pending} error={error("contentFormat")} />
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-4"><legend className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</legend>{children}</fieldset>;
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

function ChoiceGroup({ label, name, options, disabled, error }: { label: string; name: string; options: readonly { value: string; label: string }[]; disabled: boolean; error?: string }) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={label}>
      <p className="text-sm font-semibold text-slate-700">{label}<span className="ml-1 text-rose-500">*</span></p>
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => (
          <label key={option.value} className="cursor-pointer">
            <input type="radio" name={name} value={option.value} defaultChecked={index === 0} disabled={disabled} className="peer sr-only" />
            <span className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:font-semibold peer-checked:text-blue-700 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-500">{option.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

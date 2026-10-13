"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeleteSelectedCampaignsButton({
  action,
  formId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  formId?: string;
}) {
  return (
    <Button
      type="submit"
      form={formId}
      formAction={action}
      variant="outline"
      className="border-rose-200 text-rose-700 hover:bg-rose-50"
      onClick={(event) => {
        const form = formId ? document.getElementById(formId) as HTMLFormElement | null : event.currentTarget.form;
        const selected = form?.querySelectorAll<HTMLInputElement>('input[name="campaignId"]:checked').length ?? 0;
        if (!selected) {
          event.preventDefault();
          window.alert("Anh hãy chọn ít nhất một chiến dịch cần xóa.");
          return;
        }
        if (!window.confirm(`Đưa ${selected} chiến dịch đã chọn vào Lưu trữ? Các chiến dịch đang chạy, lên lịch hoặc tạm dừng sẽ được giữ lại.`)) event.preventDefault();
      }}
    >
      <Trash2 className="size-4" />
      Lưu trữ đã chọn
    </Button>
  );
}

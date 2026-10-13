"use client";

import type { ComponentProps } from "react";

// A <select> that submits its form as soon as the value changes, so filters apply without
// a separate "Áp dụng" click. The form keeps working without JavaScript via its own submit button.
export function AutoSubmitSelect({ onChange, ...props }: ComponentProps<"select">) {
  return <select {...props} onChange={(event) => { onChange?.(event); event.currentTarget.form?.requestSubmit(); }} />;
}

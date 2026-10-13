export interface CreateContentState {
  success: boolean;
  message: string | null;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Codes of the items saved by the last submission, e.g. ["CT-000101", "CT-000102"]. */
  codes?: string[];
  rejected?: number;
}

export const initialCreateContentState: CreateContentState = { success: false, message: null };

export interface ContentActionResult {
  ok: boolean;
  message: string;
}

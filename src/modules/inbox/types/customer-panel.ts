export interface CustomerPanelData {
  conversationId: string;
  contact: { id: string; fullName: string; jobTitle: string | null; email: string | null; phone: string | null; leadStatus: string; companyName: string | null } | null;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; assigneeName: string | null }>;
  notes: Array<{ id: string; content: string; authorName: string | null; createdAt: string }>;
  otherConversations: Array<{ id: string; channelType: string; accountName: string | null; subject: string | null; lastMessageAt: string | null }>;
  /** CVs on Human with the contact's phone / e-mail (only with "CV · Xem", within the member's CVs). */
  humanCvs: Array<{ cvId: number; name: string | null; position: string | null; status: string | null; companies: number }>;
  can: { editLead: boolean; createContact: boolean; createTask: boolean; updateTask: boolean; addNote: boolean };
}

export interface CustomerPanelResult { ok: boolean; message: string }

export const LEAD_STATUSES: Array<{ value: string; label: string }> = [
  { value: "NEW", label: "Mới" }, { value: "CONTACTED", label: "Đã liên hệ" }, { value: "ENGAGED", label: "Đang trao đổi" },
  { value: "QUALIFIED", label: "Đủ điều kiện" }, { value: "OPPORTUNITY", label: "Cơ hội" }, { value: "WON", label: "Thành công" },
  { value: "LOST", label: "Thất bại" }, { value: "DO_NOT_CONTACT", label: "Không liên hệ" },
];

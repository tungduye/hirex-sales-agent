import { normalize, type HumanDocument } from "./retrieval";

// Intentionally narrow grammar: never silently discard unrecognized conditions.
export function localDocumentQuery(documents: HumanDocument[], question: string, selectedId?: number) {
  const text = normalize(question).trim().replace(/[?.!]+$/, "").trim();
  const pool = selectedId ? documents.filter(doc => doc.id === selectedId) : documents;
  let matches: HumanDocument[];
  let description: string;
  if (/^(?:co bao nhieu tai lieu|dem tai lieu|dem tat ca tai lieu|liet ke tai lieu|liet ke tat ca tai lieu)$/.test(text)) {
    matches = pool;
    description = selectedId ? `trong phạm vi tài liệu #${selectedId}` : "trong bản dữ liệu đã nhập";
  } else {
    const groupMatch = text.match(/^(?:liet ke|tim|dem) tai lieu (?:cua|trong nhom|thuoc nhom) (.+)$/);
    const titleMatch = text.match(/^(?:tim|liet ke|dem) tai lieu (?:ten|co ten) (.+)$/);
    if (groupMatch) {
      const requested = groupMatch[1];
      const groups = [...new Set(documents.map(doc => doc.group))].filter(group => {
        const name = normalize(group);
        return name === requested || name.replace(/^(?:mon|de tai|bo phan)[_ :]+/, "") === requested;
      });
      if (groups.length !== 1) return null;
      matches = pool.filter(doc => doc.group === groups[0]);
      description = `thuộc nhóm “${groups[0]}”`;
    } else if (titleMatch && !/\b(?:khong|tru|ngoai|va|hoac|moi nhat|hom nay)\b/.test(titleMatch[1])) {
      matches = pool.filter(doc => normalize(doc.name).includes(titleMatch[1]));
      description = `có tên khớp từ khóa không dấu “${titleMatch[1]}”`;
    } else return null;
  }
  const countOnly = /^(dem|co bao nhieu)/.test(text);
  const shown = countOnly ? [] : matches.slice(0, 20);
  return {
    answer: `Tra cứu nội bộ — không gọi AI.\nCó ${matches.length.toLocaleString("vi-VN")} tài liệu ${description}.${selectedId ? " Chỉ xét tài liệu đang mở." : ""}${!countOnly && matches.length > 20 ? " Hiển thị 20 kết quả đầu; hãy lọc cụ thể hơn để xem phần còn lại." : ""}`,
    sources: shown.map(doc => ({ id: doc.id, name: doc.name, quote: `Nhóm tài liệu: ${doc.group}` })), error: false,
  };
}

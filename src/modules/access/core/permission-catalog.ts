export const permissionGroups = [
  { key:"dashboard", label:"Tổng quan", actions:[["view","Xem"]] },
  { key:"companies", label:"Công ty", actions:[["view","Xem"],["create","Thêm"],["update","Sửa"],["delete","Xóa"],["export","Xuất"],["import","Nhập"]] },
  { key:"contacts", label:"Liên hệ", actions:[["view","Xem"],["create","Thêm"],["update","Sửa"],["delete","Xóa"],["export","Xuất"],["import","Nhập"]] },
  { key:"inbox", label:"Suối Nguồn", actions:[["view","Xem"],["reply","Trả lời"],["update","Cập nhật"]] },
  { key:"scan", label:"Scan", actions:[["view","Xem"],["cv","Chạy Scan CV"],["website","Chạy Scan Website"],["export","Xuất kết quả"]] },
  { key:"campaigns", label:"Chiến dịch", actions:[["view","Xem"],["create","Thêm"],["update","Sửa"],["delete","Xóa"],["launch","Khởi chạy"],["export","Xuất"],["import","Nhập"]] },
  { key:"content", label:"Kho content", actions:[["view","Xem"],["create","Tạo"],["delete","Xóa"],["templates","Quản lý kho mẫu"]] },
  { key:"tasks", label:"Công việc", actions:[["view","Xem"],["create","Thêm"],["update","Sửa"],["delete","Xóa"]] },
  { key:"analytics", label:"Phân tích", actions:[["view","Xem"]] },
  { key:"jobs", label:"Job", actions:[["view","Xem"],["manage","Quản lý"]] },
  { key:"accounts", label:"Tài khoản", actions:[["view","Xem"]] },
  { key:"settings", label:"Cài đặt", actions:[["view","Xem"]] },
  { key:"channels", label:"Tài khoản kết nối", actions:[["view","Xem"],["manage","Quản lý"]] },
  { key:"roles", label:"Vai trò và phân quyền", actions:[["view","Xem"],["manage","Quản lý"]] },
] as const;

export const allPermissionKeys = permissionGroups.flatMap(group=>group.actions.map(([action])=>`${group.key}.${action}`));
export type PermissionKey = (typeof allPermissionKeys)[number];

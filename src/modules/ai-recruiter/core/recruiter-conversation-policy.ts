export function recruiterRejectionKind(text:string){
  const value=text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  if(/\b(apply|applied|fail|failed)\b|đã ứng tuyển|từng ứng tuyển|đã phỏng vấn|từng phỏng vấn/iu.test(value))return"KNOWN_REASON" as const;
  if(/lương|thu nhập|địa điểm|xa|gần|nội dung|công việc|tech|công nghệ|process|quy trình/iu.test(value))return"KNOWN_REASON" as const;
  if(/chưa phù hợp|không phù hợp|không hợp|không thích|không avail|không avai/iu.test(value))return"GENERIC" as const;
  return"NONE" as const;
}

export function recruiterRejectionOverride(input:{text:string;lastSaleStage?:string|null}){
  const kind=recruiterRejectionKind(input.text);
  if(kind==="NONE")return null;
  if(input.lastSaleStage==="second_job")return{reply:"Vậy hả anh ơi, hiện em đang online điện thoại nên chưa tiện kiểm tra thêm hệ thống được. Anh đợi em xem thêm dự án sát hơn rồi gửi anh sau ạ.",stopBot:true,notification:"NOTI_3" as const};
  if(input.lastSaleStage==="first_job"&&kind==="GENERIC")return{reply:"Job này chưa hợp ở phần địa điểm, lương hay nội dung công việc vậy anh, để em lọc job khác sát hơn nhé.",stopBot:false,notification:null};
  return null;
}

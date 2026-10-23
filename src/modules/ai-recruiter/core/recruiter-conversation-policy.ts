export function recruiterRejectionKind(text:string){
  const value=text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  if(/\b(apply|applied|fail|failed)\b|đã ứng tuyển|từng ứng tuyển|đã phỏng vấn|từng phỏng vấn/iu.test(value))return"KNOWN_REASON" as const;
  if(/lương|thu nhập|địa điểm|xa|gần|nội dung|công việc|tech|công nghệ|process|quy trình/iu.test(value))return"KNOWN_REASON" as const;
  if(/chưa phù hợp|không phù hợp|không hợp|không thích|không avail|không avai/iu.test(value))return"GENERIC" as const;
  return"NONE" as const;
}

export type RecruiterRejectionKind=ReturnType<typeof recruiterRejectionKind>;

/** The candidate turned down (or already applied to) the job just offered. kind: when the caller already knows it
 *  (e.g. "rồi" answering "anh đã từng apply công ty này chưa"). */
export function recruiterRejectionOverride(input:{text:string;lastSaleStage?:string|null;kind?:RecruiterRejectionKind}){
  const kind=input.kind??recruiterRejectionKind(input.text);
  if(kind==="NONE")return null;
  if(input.lastSaleStage==="second_job")return{reply:"Vậy hả anh ơi, để em check thêm các dự án phù hợp với anh rồi em gửi anh sớm nha. Em cám ơn anh đã dành thời gian trao đổi với em ạ.",stopBot:true,notification:"NOTI_3" as const};
  if(input.lastSaleStage==="first_job"&&kind==="GENERIC")return{reply:"Dạ vâng anh, anh thấy job này chưa hợp ở phần địa điểm, mức lương hay nội dung công việc ạ. Anh chia sẻ giúp em để em lọc job khác sát với anh hơn nha.",stopBot:false,notification:null};
  return null;
}

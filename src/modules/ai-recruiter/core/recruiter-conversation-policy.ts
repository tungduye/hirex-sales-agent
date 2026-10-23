/** Whether the candidate turns the offered job down: KNOWN_REASON (applied before, or a reason such as salary, place,
 *  work), GENERIC ("chưa phù hợp" without a reason), NONE. A question about the job is not a refusal:
 *  "Lương 60tr được không em?" asks about the salary, it does not reject it. */
export function recruiterRejectionKind(text:string){
  const value=text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  if(/\b(apply|applied|fail|failed)\b|đã ứng tuyển|từng ứng tuyển|đã phỏng vấn|từng phỏng vấn/iu.test(value))return"KNOWN_REASON" as const;
  // "… được không em?", "có … không ạ": a question, its "không" is not a "no".
  const said=value.replace(/(?:được|đc|dc|ok|oke|có|phải|thế nào|sao)\s+(?:không|ko|k)(?=$|[\s?.!,])(?:\s*(?:em|ạ|a|nhỉ|nhé|vậy))*\s*\??/gu," ");
  const negative=/chưa phù hợp|không phù hợp|chưa hợp|không hợp|không ổn|không thích|không muốn|không quan tâm|không avail|không avai|không ưng|chưa ưng|thấp|ít quá|không đủ|chưa đủ|cao quá|(?:^|\s)xa(?:$|\s|\.|,|!)|chán|ngại/iu;
  if(!negative.test(said))return"NONE" as const;
  const topic=/lương|thu nhập|địa điểm|chỗ làm|văn phòng|(?:^|\s)xa(?:$|\s|\.|,|!)|nội dung|công việc|tech|công nghệ|process|quy trình|onsite|(?:^|\s)ot(?:$|\s)/iu;
  return topic.test(said)?"KNOWN_REASON" as const:"GENERIC" as const;
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

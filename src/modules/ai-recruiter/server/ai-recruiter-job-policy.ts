export type RecruiterJobPolicyInput={external_job_id:string;company_name?:unknown;requirements?:unknown;summary?:unknown;selling_points?:unknown};

export function normalizeRecruiterMatchText(value:unknown){return typeof value==="string"?value.normalize("NFKC").replace(/\s+/gu," ").trim().toLocaleLowerCase("vi-VN").replace(/[^\p{L}\p{N}]+/gu," "):""}

export function isManagementRecruiterJob(job:Pick<RecruiterJobPolicyInput,"requirements"|"summary"|"selling_points">){return /quản lý|management|lead(?:er|ership)?/iu.test(`${job.requirements??""} ${job.summary??""} ${job.selling_points??""}`)}

export function candidateExplicitlyLacksManagement(value:unknown){const text=normalizeRecruiterMatchText(value);return Boolean(text)&&/(chưa từng|chưa có|không có|không từng|chưa quản lý|không quản lý|chua tung|chua co|khong co|khong tung|chua quan ly|khong quan ly)/u.test(text)}

export function eligibleRecruiterJobIds(jobs:RecruiterJobPolicyInput[],rejectedCompanies:Set<string>,managementExperience:unknown){const lacksManagement=candidateExplicitlyLacksManagement(managementExperience);return new Set(jobs.filter(job=>!rejectedCompanies.has(normalizeRecruiterMatchText(String(job.company_name??"")))&&!(lacksManagement&&isManagementRecruiterJob(job))).map(job=>job.external_job_id))}

export function availabilityFollowup(expectedSalary:unknown,availability:unknown,companyName:unknown){
  if(typeof expectedSalary!=="string"||!expectedSalary.trim()||availability)return null;
  const company=typeof companyName==="string"&&companyName.trim()?` của ${companyName.trim()}`:" vị trí này";
  return `Mức ${expectedSalary.trim()} nằm trong range${company}. Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé.`;
}

/** A CV file: named like one (CV, resume, 履歴書, 職務経歴書, hồ sơ…), or any document (PDF, Word) sent once the CV was asked for. */
export function hasRecruiterCvAttachment(metadata:unknown,cvAsked=false){
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata)||!("attachments" in metadata)||!Array.isArray(metadata.attachments))return false;
  return metadata.attachments.some(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return false;
    const filename="filename" in value&&typeof value.filename==="string"?value.filename:"";
    const contentType="contentType" in value&&typeof value.contentType==="string"?value.contentType.toLowerCase():"";
    if(/(?:^|[^\p{L}\p{N}])(cv|resume|résumé)(?:[^\p{L}\p{N}]|$)|履歴書|職務経歴書|経歴書|レジュメ|hồ sơ|ho so|ho_so|sơ yếu|so yeu|lý lịch|ly lich/iu.test(filename))return true;
    return cvAsked&&(/\.(?:pdf|docx?|odt|pages|rtf)$/iu.test(filename)||/pdf|msword|wordprocessingml|opendocument\.text/u.test(contentType));
  });
}

export function candidateExplicitlyHasNoCv(value:unknown){
  const text=normalizeRecruiterMatchText(value);
  return Boolean(text)&&/(chưa|không) (?:có |chuẩn bị |làm |cập nhật )?(?:cv|resume|résumé)(?: |$)/u.test(text);
}

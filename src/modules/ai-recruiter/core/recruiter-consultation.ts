const plain=(text:unknown)=>String(text??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/gu,'d');
/** A narrow, source-backed bridge from location selection to job consultation. */
export function brseLocationConsultation(profile:Record<string,unknown>,latest:string,jobs:Record<string,unknown>[]) {
  if(plain(profile.candidate_type)!=='brse'||profile.japanese_level)return null;
  const location=plain(profile.location);
  if(location!=='ha noi')return null;
  if(!/\b(job|viec|hn)\b|ha noi/u.test(plain(latest)))return null;
  const job=jobs.find(job=>plain(job.candidate_type)==='brse'&&plain(job.location)==='ha noi'&&/trao doi.*(?:khach|tieng) nhat|giao tiep.*tieng nhat/u.test(plain(job.requirements)));
  if(!job)return null;
  // This catalogue verifies client communication, not requirement gathering or
  // development-team coordination: do not invent those duties from a template.
  return [
    'Em có vị trí BrSE tại Hà Nội, cần người có thể trao đổi công việc với khách Nhật.',
    'Vị trí này cần giao tiếp công việc bằng tiếng Nhật. Phần này hiện anh sử dụng thường xuyên không ạ?',
  ];
}

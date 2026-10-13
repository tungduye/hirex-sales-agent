/** Recover only unambiguous short candidate answers; never infer from bot text. */
export function recoverIntroMemory(turns: {role:string;text:string}[], profile:Record<string,unknown>){
  const recovered:Record<string,unknown>={};
  for(const turn of turns){
    if(turn.role!=='INBOUND')continue;
    const text=turn.text.trim().toLowerCase().replace(/[.!?]+$/u,'').trim();
    const role=text.match(/^(?:(?:anh|chị|em)\s+)?(?:(?:chọn|muốn làm|quan tâm|đang làm)\s+)?(brse|pm|dev|developer|se)(?:\s+(?:em|ạ|nhé|thôi))?$/iu)?.[1];
    if(role)recovered.candidate_type=({brse:'BrSE',pm:'PM',dev:'Developer',developer:'Developer',se:'SE'} as Record<string,string>)[role.toLowerCase()];
    const location=text.match(/^(?:(?:anh|chị|em)\s+)?(?:(?:ưu tiên|ở|muốn ở)\s+)?(hà nội|hồ chí minh|hcm|tokyo|nhật)(?:\s+(?:em|ạ|nhé))?$/iu)?.[1];
    if(location)recovered.location=({'hà nội':'Hà Nội','hồ chí minh':'Hồ Chí Minh',hcm:'Hồ Chí Minh',tokyo:'Tokyo','nhật':'Nhật'} as Record<string,string>)[location.toLowerCase()];
    const japanese=text.match(/^(?:(?:tiếng nhật\s+)?(?:anh|chị|em)\s+)?(?:có\s+)?(n[1-5])(?:\s+(?:em|ạ|nhé))?$/iu)?.[1];
    if(japanese)recovered.japanese_level=japanese.toUpperCase();
    if(/^(?:(?:anh|chị|em)\s+)?chưa từng (?:sống|làm việc|sống hoặc làm việc) (?:ở|tại) nhật$/iu.test(text))recovered.japan_years=0;
  }
  // Existing verified profile wins; this is recovery, not a silent correction.
  return {...recovered,...Object.fromEntries(Object.entries(profile).filter(([,value])=>value!==null&&value!==undefined&&value!==''))};
}

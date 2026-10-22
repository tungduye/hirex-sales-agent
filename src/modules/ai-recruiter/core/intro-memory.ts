const fold=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/gu,'d');
const PLACES:Array<[RegExp,string]>=[[/\b(?:ha noi|hn)\b/u,'Hà Nội'],[/\b(?:ho chi minh|hcm|tphcm|sai gon|sg)\b/u,'Hồ Chí Minh'],[/\bda nang\b/u,'Đà Nẵng'],
  [/\btokyo\b/u,'Tokyo'],[/\bosaka\b/u,'Osaka'],[/\b(?:nhat(?: ban)?|japan)\b/u,'Nhật']];
/** Places named in an answer to "khu vực nào", in the order said ("HN và Nhật cũng ok" → Hà Nội, Nhật). */
export function placesInAnswer(text:string){
  const value=fold(text);
  if(value.length>160||/\b(?:khong|ko|k|chua|tru)\b/u.test(value))return [];
  return PLACES.map(([pattern,name])=>({name,at:value.search(pattern)})).filter(item=>item.at>=0).sort((a,b)=>a.at-b.at).map(item=>item.name);
}

/** Recover only unambiguous short candidate answers; never infer from bot text. */
export function recoverIntroMemory(turns: {role:string;text:string}[], profile:Record<string,unknown>){
  const recovered:Record<string,unknown>={};
  let lastAsked='';
  for(const turn of turns){
    if(turn.role!=='INBOUND'){lastAsked=turn.text;continue;}
    // The answer to the bot's "khu vực nào": one or several places.
    if(/khu vuc|dia diem|o dau/u.test(fold(lastAsked))){
      const places=placesInAnswer(turn.text);
      if(places.length){recovered.location=places[0];if(places.length>1)recovered.preferred_locations=places;}
    }
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

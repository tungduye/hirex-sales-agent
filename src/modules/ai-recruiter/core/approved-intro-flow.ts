const plain=(v:unknown)=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/gu,'d').trim();
const location=(v:unknown)=>({hcm:'ho chi minh',japan:'nhat','nhat ban':'nhat',hn:'ha noi'}[plain(v)]??plain(v));
/** A place as candidates say it ("Japan" in the job data → "Nhật"). */
export function placeLabel(value:unknown){const key=location(value);return ({'ha noi':'Hà Nội','ho chi minh':'HCM',nhat:'Nhật'} as Record<string,string>)[key]??String(value??'');}
export function withoutQuestionMarks(text:string){return text.replace(/[?？]+/gu,'.').replace(/\.{2,}/gu,'.');}
export function approvedIntroReply(profile:Record<string,unknown>,jobs:Record<string,unknown>[]){
 const role=String(profile.candidate_type??'').trim();
 if(!role)return 'Anh đang quan tâm hướng BrSE, PM hay Developer để em lọc job sát cho anh ạ.';
 const eligible=jobs.filter(job=>plain(job.candidate_type)===plain(role));
 if(!profile.location){
   const places=[...new Set(eligible.map(job=>location(job.location)).filter(Boolean))];
   const labels=places.map(place=>({'ha noi':'Hà Nội','ho chi minh':'HCM',nhat:'Nhật'}[place]??String(eligible.find(job=>location(job.location)===place)?.location)));
   const list=labels.length>1?`${labels.slice(0,-1).join(', ')} và ${labels.at(-1)}`:labels[0];
   return `${labels.length?`Dạ vâng anh, ${role} cũng đang là hướng bên em tuyển ạ. Hiện bên em có vị trí ở ${list}.`:`Dạ vâng anh, em sẽ kiểm tra các cơ hội ${role} phù hợp với anh ạ.`}\n\nĐợt này anh đang muốn tìm cơ hội ở khu vực nào để em lọc job sát nhất cho anh ạ.`;
 }
 const needsJapanese=typeof profile.japanese_level!=='string'||!profile.japanese_level.trim();
 const needsJapan=typeof profile.japan_years!=='number'||!Number.isFinite(profile.japan_years)||profile.japan_years<0;
 if(!needsJapanese&&!needsJapan)return null;
 const question=needsJapanese&&needsJapan
   ?'Để em giới thiệu job sát nhất với anh, anh cho em hỏi hiện anh dùng tiếng Nhật ở mức nào và đã từng sống hoặc làm việc bên Nhật bao lâu rồi ạ.'
   :needsJapanese?'Anh cho em hỏi hiện anh dùng tiếng Nhật ở mức nào, có thường xuyên trao đổi công việc với khách Nhật không ạ.':'Anh đã từng sống hoặc làm việc bên Nhật chưa, nếu có thì khoảng bao lâu rồi ạ.';
 if(!needsJapanese||!needsJapan)return question;
 const match=eligible.find(job=>location(job.location)===location(profile.location));
 if(!match)return `Dạ hiện em chưa thấy vị trí ${role} ở ${String(profile.location)} trong danh sách đang tuyển anh ạ.\n\n${question}`;
 const communication=/trao doi.*khach nhat|giao tiep.*tieng nhat/u.test(plain(match.requirements));
 return `Dạ ở ${placeLabel(match.location)} bên em đang có vị trí ${String(match.candidate_type)}${communication?', công việc cần trao đổi trực tiếp với khách Nhật':''} anh ạ.\n\n${question}`;
}

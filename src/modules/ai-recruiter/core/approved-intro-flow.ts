const plain=(v:unknown)=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/gu,'d').trim();
const location=(v:unknown)=>({hcm:'ho chi minh',japan:'nhat','nhat ban':'nhat',hn:'ha noi'}[plain(v)]??plain(v));
export function withoutQuestionMarks(text:string){return text.replace(/[?？]+/gu,'.').replace(/\.{2,}/gu,'.');}
export function approvedIntroReply(profile:Record<string,unknown>,jobs:Record<string,unknown>[]){
 const role=String(profile.candidate_type??'').trim();
 if(!role)return 'Anh đang quan tâm hướng BrSE, PM hay Developer để em lọc job sát cho anh ạ.';
 const eligible=jobs.filter(job=>plain(job.candidate_type)===plain(role));
 if(!profile.location){
   const places=[...new Set(eligible.map(job=>location(job.location)).filter(Boolean))];
   const labels=places.map(place=>({'ha noi':'Hà Nội','ho chi minh':'HCM',nhat:'Nhật'}[place]??String(eligible.find(job=>location(job.location)===place)?.location)));
   const list=labels.length>1?`${labels.slice(0,-1).join(', ')} và ${labels.at(-1)}`:labels[0];
   return `${labels.length?`${role} cũng là hướng bên em đang tuyển anh ạ. Hiện có các vị trí ở ${list}.`:`Em sẽ kiểm tra các cơ hội ${role} phù hợp với anh.`}\n\nĐợt này anh muốn tìm cơ hội ở khu vực nào ạ.`;
 }
 const needsJapanese=typeof profile.japanese_level!=='string'||!profile.japanese_level.trim();
 const needsJapan=typeof profile.japan_years!=='number'||!Number.isFinite(profile.japan_years)||profile.japan_years<0;
 if(!needsJapanese&&!needsJapan)return null;
 const question=needsJapanese&&needsJapan
   ?'Hiện anh sử dụng tiếng Nhật trong công việc thế nào ạ. Anh chia sẻ thêm giúp em thời gian từng sống hoặc làm việc bên Nhật nhé'
   :needsJapanese?'Hiện anh sử dụng tiếng Nhật trong công việc thế nào ạ.':'Còn thời gian sống hoặc làm việc bên Nhật của anh thì khoảng bao lâu rồi ạ.';
 if(!needsJapanese||!needsJapan)return question;
 const match=eligible.find(job=>location(job.location)===location(profile.location));
 if(!match)return `Em chưa thấy vị trí ${role} ở ${String(profile.location)} trong danh sách hiện tại.\n\n${question}`;
 const communication=/trao doi.*khach nhat|giao tiep.*tieng nhat/u.test(plain(match.requirements));
 return `Em có vị trí ${String(match.candidate_type)} tại ${String(match.location)}${communication?', cần người có thể trao đổi công việc với khách Nhật':''}.\n\n${question}`;
}

export function missingIntroField(profile: Record<string,unknown>) {
  for(const field of ['candidate_type','location','japanese_level'] as const){
    if(typeof profile[field]!== 'string'||!profile[field].trim())return field;
  }
  if(typeof profile.japan_years!=='number'||!Number.isFinite(profile.japan_years)||profile.japan_years<0)return 'japan_years';
  return null;
}

export function introductionQuestion(profile:Record<string,unknown>): string|null {
  switch(missingIntroField(profile)){
    case 'candidate_type': return 'Để chọn hướng việc phù hợp, anh đang quan tâm BrSE, PM hay Developer ạ?';
    case 'location': return `Mình tập trung vào hướng ${String(profile.candidate_type)} nhé anh. Anh muốn ưu tiên làm việc ở khu vực nào để em lọc cơ hội sát hơn ạ?`;
    case 'japanese_level': return `Anh ưu tiên ${String(profile.location)} thì mình tập trung tìm cơ hội ở đây nhé. Trong công việc hiện tại, anh có thường xuyên trao đổi bằng tiếng Nhật không ạ?`;
    case 'japan_years': return 'Em muốn hiểu thêm môi trường anh từng làm việc để tư vấn sát hơn. Anh đã từng sống hoặc làm việc ở Nhật chưa, nếu có thì khoảng bao lâu rồi ạ?';
    default:return null;
  }
}

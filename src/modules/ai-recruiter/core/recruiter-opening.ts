export const recruiterOpening = 'Em chào anh ạ, em đang có một vài job IT tiếng Nhật khá tốt cho các hướng BrSE, PM, SE và Developer. Anh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?';

export function initialRecruiterOpening(turns: {role:string;text:string}[], profile: Record<string,unknown>) {
  if (profile.candidate_type || turns.some(turn => turn.role === 'OUTBOUND')) return null;
  const incoming = turns.filter(turn => turn.role === 'INBOUND');
  if (!incoming.length || !incoming.every(turn => /^(?:(?:hi|hello|chào)(?:\s+(?:em|e|anh|chị))?|(?:em|e)\s*ơi)[!.,\s]*$/iu.test(turn.text.trim()))) return null;
  return recruiterOpening;
}

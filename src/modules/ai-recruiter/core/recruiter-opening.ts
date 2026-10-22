export const recruiterOpening = 'Em chào anh ạ, em đang có một vài job IT tiếng Nhật khá tốt cho các hướng BrSE, PM, SE và Developer. Anh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?';

/** A bare greeting ("hi em", "helo em", "alo", "chào anh ạ", "em ơi"): nothing else said yet. */
export const BARE_GREETING = /^(?:(?:hi|hii+|hello|helo|hellu|hé lô|hê lô|alo|a lô|hey|chào|xin chào)(?:\s+(?:em|e|anh|chị|bạn|ad|admin|ạ|nhé))*|(?:em|e)\s*ơi)[!.,~\s]*$/iu;

export function initialRecruiterOpening(turns: {role:string;text:string}[], profile: Record<string,unknown>) {
  if (profile.candidate_type || turns.some(turn => turn.role === 'OUTBOUND')) return null;
  const incoming = turns.filter(turn => turn.role === 'INBOUND');
  if (!incoming.length || !incoming.every(turn => BARE_GREETING.test(turn.text.trim()))) return null;
  return recruiterOpening;
}

/** Greeting sentence of the opening, without its question. */
export const recruiterGreeting = 'Em chào anh ạ, em đang có một vài job IT tiếng Nhật khá tốt cho các hướng BrSE, PM, SE và Developer.';

/**
 * The first message the bot sends in a conversation always greets, whatever the candidate wrote first
 * ("anh tìm job BrSE ở HN" too). Later replies do not greet again.
 */
export function withFirstGreeting(parts: string[], turns: {role:string;text:string}[]) {
  if (!parts.length || turns.some(turn => turn.role === 'OUTBOUND')) return parts;
  const plain = parts[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/gu, 'd').trim();
  if (/^(?:da\s+)?(?:em\s+)?(?:xin\s+)?chao\b/u.test(plain)) return parts;
  return [`${recruiterGreeting}\n\n${parts[0]}`, ...parts.slice(1)];
}

type Turn = { role: string; text: string };

/** Consecutive inbound messages are one candidate answer, not separate turns. */
export function candidateBurst(turns: Turn[]) {
  const burst: string[]=[];
  for(let i=turns.length-1;i>=0;i--){
    if(turns[i].role!=="INBOUND")break;
    burst.unshift(turns[i].text);
  }
  return burst.join("\n");
}

/** Stable per run: retries must not alter the number/content of message parts. */
export function shapeReply(parts: string[], seed: string): string[] {
  const text=parts.map(p=>p.trim()).filter(Boolean).join("\n\n");
  if(!text)return [];
  let hash=0;for(const char of seed)hash=(hash*31+char.charCodeAt(0))>>>0;
  if(hash%2===0||text.length<100)return [text];
  const boundaries=[...text.matchAll(/(?:[.!?]\s+|\n\n+)/gu)]
    .map(match=>match.index!+match[0].length)
    .filter(index=>index>=35&&text.length-index>=35);
  if(!boundaries.length)return [text];
  const index=boundaries.sort((a,b)=>Math.abs(a-text.length/2)-Math.abs(b-text.length/2))[0];
  return [text.slice(0,index).trim(),text.slice(index).trim()];
}

import { timingSafeEqual } from "node:crypto";

function safeEqual(left:string,right:string){
  const leftBytes=Buffer.from(left,"utf8"),rightBytes=Buffer.from(right,"utf8");
  return leftBytes.length===rightBytes.length&&timingSafeEqual(leftBytes,rightBytes);
}

export function verifyFacebookWebhookChallenge(input:{mode:string|null;suppliedToken:string|null;expectedToken:string;challenge:string|null}){
  if(input.mode!=="subscribe"||!input.suppliedToken||!safeEqual(input.suppliedToken,input.expectedToken))return{status:403 as const,body:"Forbidden"};
  if(!input.challenge||input.challenge.length>512||/[\u0000-\u001f\u007f-\u009f]/u.test(input.challenge))return{status:400 as const,body:"Bad Request"};
  return{status:200 as const,body:input.challenge};
}

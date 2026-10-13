import "server-only";
import sanitizeHtml from "sanitize-html";
import { renderCampaignTemplate, type Personalization } from "@/modules/campaigns/domain/campaign-rules";

const allowedTags=["p","div","br","strong","b","em","i","u","s","ul","ol","li","blockquote","a","span","font"];
const fontSizes:Record<string,string>={"1":"10px","2":"13px","3":"16px","4":"18px","5":"24px","6":"32px","7":"48px"};

export function sanitizeCampaignHtml(value:string){
  const styles={"text-align":[/^left$|^center$|^right$/],color:[/^#[0-9a-f]{6}$/i,/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],"font-size":[/^(10|13|16|18|24|32|48)px$/]};
  return sanitizeHtml(value.replace(/\u200B/g,""),{allowedTags,allowedAttributes:{a:["href","target","rel"],span:["style"],p:["style"],div:["style"],font:["color","size"]},allowedStyles:{span:styles,p:styles,div:styles},allowedSchemes:["http","https","mailto"],allowProtocolRelative:false,transformTags:{a:(_tag,attrs)=>({tagName:"a",attribs:{...attrs,target:"_blank",rel:"noopener noreferrer"}}),font:(_tag,attrs)=>{const stylesOut:string[]=[];if(/^#[0-9a-f]{6}$/i.test(attrs.color??""))stylesOut.push(`color:${attrs.color}`);if(fontSizes[attrs.size??""])stylesOut.push(`font-size:${fontSizes[attrs.size]}`);const attribs:Record<string,string>=stylesOut.length?{style:stylesOut.join(";")}:{ };return{tagName:"span",attribs};}}}).trim();
}

export function htmlToPlainText(value:string){const withBreaks=value.replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|li|blockquote)>/gi,"\n");return sanitizeHtml(withBreaks,{allowedTags:[],allowedAttributes:{}}).replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();}

export function renderCampaignHtml(template:string,values:Personalization){
  const escaped=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,sanitizeHtml(value,{allowedTags:[],allowedAttributes:{}})]));
  return renderCampaignTemplate(template,escaped).rendered;
}

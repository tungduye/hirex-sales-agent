"use client";

import {useEffect,useRef,useState} from "react";

export function SelectAllCampaignCheckbox(){
  const ref=useRef<HTMLInputElement>(null);
  const[selected,setSelected]=useState(0);
  const[total,setTotal]=useState(0);
  useEffect(()=>{const master=ref.current,form=master?.closest("form");if(!master||!form)return;const boxes=[...form.querySelectorAll<HTMLInputElement>('input[name="campaignId"]')];const update=()=>{const count=boxes.filter(box=>box.checked).length;setSelected(count);setTotal(boxes.length);master.indeterminate=count>0&&count<boxes.length};boxes.forEach(box=>box.addEventListener("change",update));update();return()=>boxes.forEach(box=>box.removeEventListener("change",update))},[]);
  function toggle(checked:boolean){const form=ref.current?.closest("form");if(!form)return;const boxes=[...form.querySelectorAll<HTMLInputElement>('input[name="campaignId"]')];boxes.forEach(box=>{box.checked=checked;box.dispatchEvent(new Event("change",{bubbles:true}))})}
  return <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap"><input ref={ref} type="checkbox" checked={total>0&&selected===total} onChange={event=>toggle(event.target.checked)} aria-label="Chọn tất cả chiến dịch" className="size-4 rounded border-slate-300 accent-blue-600"/><span>Chọn tất cả</span></label>;
}

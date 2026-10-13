"use client";

export function ConfirmSubmitButton({children,message,className,formAction}:{children:React.ReactNode;message:string;className?:string;formAction?:(formData:FormData)=>void|Promise<void>}){return <button type="submit" formAction={formAction} onClick={event=>{if(!window.confirm(message))event.preventDefault();}} className={className}>{children}</button>}

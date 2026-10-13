const LOCAL_HOSTS=new Set(["localhost","127.0.0.1","::1"]);

export function requireTrustedFacebookProfileBridgeOrigin(value:unknown):string{
  if(typeof value!=="string"||value.length>2048)throw new Error("INVALID_FACEBOOK_PROFILE_BRIDGE_ORIGIN");
  const url=new URL(value);
  const local=LOCAL_HOSTS.has(url.hostname);
  if((url.protocol!=="https:"&&!local)||url.username||url.password||url.search||url.hash||url.pathname!=="/")
    throw new Error("INVALID_FACEBOOK_PROFILE_BRIDGE_ORIGIN");
  return url.origin;
}

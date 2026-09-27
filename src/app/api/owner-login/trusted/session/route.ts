import { NextResponse } from "next/server";
import { createOwnerSessionToken, ownerSessionClaims, OWNER_SESSION_COOKIE, OWNER_SESSION_MAX_AGE_SECONDS } from "../../../../owner-auth.ts";
import { jarvisOwnerSecret } from "../../../jarvis/broker.ts";
import { trustedDeviceIsRevoked } from "../../../../trusted-device-registry-client.ts";
export async function POST(request: Request) {
 const secret=jarvisOwnerSecret(); if(!secret) return NextResponse.json({message:"JARVIS owner login is not configured"},{status:503});
 const payload=await request.json().catch(()=>null) as Record<string,unknown>|null;
 const token=typeof payload?.sessionToken==="string"?payload.sessionToken:""; const claims=ownerSessionClaims(secret,token);
 if(!claims) return NextResponse.json({message:"Owner session expired"},{status:401});
 try { if(await trustedDeviceIsRevoked(claims.deviceId)) return NextResponse.json({message:"Trusted device revoked"},{status:401}); }
 catch { return NextResponse.json({message:"Trusted device state unavailable"},{status:503}); }
 const refreshed=createOwnerSessionToken(secret,{deviceId:claims.deviceId});
 const response=NextResponse.json({ok:true,sessionToken:refreshed},{headers:{"Cache-Control":"no-store"}});
 response.cookies.set(OWNER_SESSION_COOKIE,refreshed,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:OWNER_SESSION_MAX_AGE_SECONDS});
 return response;
}

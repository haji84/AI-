export const REMOTE_VIDEO_MAX_CONSECUTIVE_FAILURES = 5;
export function remoteVideoReconnectDelay(consecutiveFailures:number, cleanSegment:boolean){
  if(cleanSegment)return 150;
  return Math.min(8_000,500*Math.pow(2,Math.max(0,Math.min(4,consecutiveFailures-1))));
}
export function shouldReconnectRemoteVideo(input:{alive:boolean;visible:boolean;consecutiveFailures:number}){
  return input.alive&&input.visible&&input.consecutiveFailures<=REMOTE_VIDEO_MAX_CONSECUTIVE_FAILURES;
}

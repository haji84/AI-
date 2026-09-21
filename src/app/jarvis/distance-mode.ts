export const JARVIS_DISTANCE_KEY = "jarvis-distance-meters-v1";
export type JarvisDistanceMeters = 3 | 4 | 5;

export function normalizeJarvisDistanceMeters(value: unknown): JarvisDistanceMeters {
  const n=Number(value);
  if(n>=5) return 5;
  if(n>=4) return 4;
  return 3;
}
export function readJarvisDistanceMeters():JarvisDistanceMeters{
  try{return normalizeJarvisDistanceMeters(window.localStorage.getItem(JARVIS_DISTANCE_KEY));}catch{return 3;}
}
export function distanceVisualProfile(distance:JarvisDistanceMeters){
  if(distance===5)return {fontScale:1.42,targetPx:72,gapPx:18};
  if(distance===4)return {fontScale:1.3,targetPx:64,gapPx:16};
  return {fontScale:1.18,targetPx:56,gapPx:14};
}
export function applyJarvisDistanceMeters(distance:JarvisDistanceMeters){
  const d=normalizeJarvisDistanceMeters(distance);const p=distanceVisualProfile(d);const root=document.documentElement;
  root.dataset.jarvisDistanceMeters=String(d);
  root.style.setProperty("--jarvis-distance-font-scale",String(p.fontScale));
  root.style.setProperty("--jarvis-distance-target-px",`${p.targetPx}px`);
  root.style.setProperty("--jarvis-distance-gap-px",`${p.gapPx}px`);
}
export function writeJarvisDistanceMeters(distance:JarvisDistanceMeters){
  const d=normalizeJarvisDistanceMeters(distance);window.localStorage.setItem(JARVIS_DISTANCE_KEY,String(d));applyJarvisDistanceMeters(d);
}

export type HandLandmark={x:number;y:number;z?:number};
export type HandGestureName="open-palm"|"fist"|"point"|"pinch"|"unknown";
export type HandGestureResult={name:HandGestureName;confidence:number};

function distance(a:HandLandmark,b:HandLandmark){return Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));}
function extended(points:HandLandmark[],tip:number,pip:number,mcp:number){return distance(points[tip],points[mcp])>distance(points[pip],points[mcp])*1.15;}
function requireLandmarks(points:HandLandmark[]){if(points.length!==21||points.some(p=>![p.x,p.y,p.z??0].every(Number.isFinite)))throw new Error("21 normalized hand landmarks are required");}

export function recognizeHandGesture(points:HandLandmark[]):HandGestureResult{
  requireLandmarks(points);
  const fingers=[
    extended(points,8,6,5),
    extended(points,12,10,9),
    extended(points,16,14,13),
    extended(points,20,18,17),
  ];
  const thumbOpen=distance(points[4],points[5])>distance(points[3],points[5])*1.08;
  const extendedCount=fingers.filter(Boolean).length+(thumbOpen?1:0);
  const pinchDistance=distance(points[4],points[8]);
  const palmScale=Math.max(0.001,distance(points[0],points[9]));
  const pinchRatio=pinchDistance/palmScale;
  if(pinchRatio<0.35)return {name:"pinch",confidence:Number(Math.min(0.99,1-pinchRatio).toFixed(2))};
  if(fingers[0]&&!fingers[1]&&!fingers[2]&&!fingers[3])return {name:"point",confidence:0.9};
  if(extendedCount>=4)return {name:"open-palm",confidence:Number((0.75+extendedCount*0.04).toFixed(2))};
  if(extendedCount<=1)return {name:"fist",confidence:0.88};
  return {name:"unknown",confidence:0.4};
}

export class StableHandGestureRecognizer{
  private last:HandGestureName="unknown"; private since=0;
  update(points:HandLandmark[],now=Date.now()){
    const current=recognizeHandGesture(points);
    if(current.name!==this.last){this.last=current.name;this.since=now;}
    const stableMs=now-this.since;
    return {...current,stableMs,accepted:current.name!=="unknown"&&current.confidence>=0.85&&stableMs>=500};
  }
  reset(){this.last="unknown";this.since=0;}
}

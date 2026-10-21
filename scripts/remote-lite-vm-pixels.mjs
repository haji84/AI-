const pixelCount = 12 * 7;
const channelCount = pixelCount * 3;
const valid = frame => Array.isArray(frame) && frame.length === pixelCount * 4 &&
  frame.every(value => Number.isInteger(value) && value >= 0 && value <= 255);

export const pixelProbeScript = (...selectors) => `const sample=selector=>{const element=document.querySelector(selector);
  if(!element||!(element.naturalWidth||element.videoWidth||element.width)||
    (element.tagName==="IMG"&&!element.complete)||
    (element.tagName==="VIDEO"&&element.readyState<2))return null;
  try {
    const probe=document.createElement("canvas");probe.width=12;probe.height=7;
    const ctx=probe.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(element,0,0,12,7);
    return Array.from(ctx.getImageData(0,0,12,7).data);
  } catch { return null; }};
  return ${selectors.length === 1 ? `sample(${JSON.stringify(selectors[0])})` :
    `${JSON.stringify(selectors)}.map(sample)`};`;

export function compareFramePixels(image, canvas, video) {
  const unavailable = { sourceHasContent:false, sourceEnergy:0, canvasError:null,
    viewerError:null, canvasErrorRatio:null, viewerErrorRatio:null, matched:false };
  if (![image, canvas, video].every(valid)) return unavailable;
  let energy = 0;
  let canvasDifference = 0;
  let viewerDifference = 0;
  let sourceHasContent = false;
  for (let index = 0; index < image.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const source = image[index + channel];
      energy += source;
      if (source > 24) sourceHasContent = true;
      canvasDifference += Math.abs(source - canvas[index + channel]);
      viewerDifference += Math.abs(source - video[index + channel]);
    }
  }
  const sourceEnergy = energy / channelCount;
  const canvasError = canvasDifference / channelCount;
  const viewerError = viewerDifference / channelCount;
  const canvasErrorRatio = sourceEnergy ? canvasError / sourceEnergy : Infinity;
  const viewerErrorRatio = sourceEnergy ? viewerError / sourceEnergy : Infinity;
  return { sourceHasContent, sourceEnergy, canvasError, viewerError,
    canvasErrorRatio, viewerErrorRatio,
    matched: sourceHasContent && canvasError < 6 && viewerError < 32 &&
      canvasErrorRatio < .3 && viewerErrorRatio < .6 };
}

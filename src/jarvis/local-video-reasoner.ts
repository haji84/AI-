import sharp from 'sharp';

// Fixed loopback and fixed local model: no user-supplied endpoint, cloud model or redirect.
export const VIDEO_MODEL = 'qwen3-vl:2b-instruct';
let busy = false;
export const videoPlanSchema = { type: 'object', required: ['uncertain', 'goal', 'completion', 'steps'], properties: { uncertain: { type: 'boolean' }, goal: { type: 'string' }, completion: { type: 'string' }, steps: { type: 'array', maxItems: 12, items: { type: 'object', required: ['label', 'before', 'after'], properties: { label: { type: 'string', enum: ['戻る', 'ホーム', '次へ', '前へ', '開く', '一覧', '詳細', '検索', '閉じる', 'Back', 'Home', 'Next', 'Previous', 'Open', 'Details', 'Search', 'Close'] }, before: { type: 'string' }, after: { type: 'string' } } } } } };
export async function localVideoReasoning(prompt: string, images: string[], format: object | 'json' = 'json'): Promise<unknown> {
  if (busy) throw Error('動画AIは別の解析中です');
  if (!images.length || images.length > 12) throw Error('1〜12枚の観測が必要です');
  busy = true;
  try {
    const normalized: string[] = [];
    for (const image of images) {
      if (typeof image !== 'string' || image.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw Error('Invalid image');
      normalized.push((await sharp(Buffer.from(image, 'base64'), { limitInputPixels: 20_000_000 }).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer()).toString('base64'));
    }
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VIDEO_MODEL, prompt, images: normalized, stream: false, think: false, format, keep_alive: '5m', options: { temperature: 0, num_predict: 1800, num_ctx: 16384 } }),
    });
    if (!response.ok) throw Error('ローカル画像AIが利用できません');
    const body = await response.json();
    if (typeof body.response !== 'string' || !body.response.trim() || body.response.length > 20000) throw Error(`ローカルAIが有効な手順を返しませんでした (${body.done_reason === 'length' ? '出力制限' : '空または不正な応答'})`);
    return JSON.parse(body.response);
  } finally { busy = false; }
}

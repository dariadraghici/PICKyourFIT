// Wraps Google's Gemini API image model ("Nano Banana" — model id
// gemini-2.5-flash-image) to turn a raw clothing photo into a clean,
// evenly-lit product shot before it goes through classification and
// background removal.
//
// Free tier: Google AI Studio gives ~500 requests/day, no credit card
// required. Get a key at https://aistudio.google.com/apikey and put it in
// .env as GEMINI_API_KEY. On the free tier Google may use the
// request/response data to improve their products — fine for a personal
// project, but worth knowing if you ever go paid/production.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const ARRANGE_PROMPT =
  'This photo shows a single clothing item. Redraw it as a clean, ' +
  'professionally lit e-commerce product photo of the exact same garment: ' +
  'laid flat or on an invisible mannequin, centered, wrinkle-free, no ' +
  'background clutter, plain light-gray studio background, no people, no ' +
  'text, no watermark, no logos added. Keep the original color, pattern, ' +
  'material and shape exactly as shown.';

// buffer: Buffer of the uploaded image. mimeType: e.g. 'image/jpeg'.
// Returns { buffer, mimeType } of the generated image.
async function arrangeClothingPhoto(buffer, mimeType) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
          { text: ARRANGE_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Gemini request failed (${response.status}).`;
    throw new Error(message);
  }

  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const imagePart = parts.find((p) => p.inline_data || p.inlineData);
  const inline = imagePart && (imagePart.inline_data || imagePart.inlineData);

  if (!inline || !inline.data) {
    // Most common cause: the safety filter blocked the image (e.g. a face
    // was visible in the shot) — surface a clear reason if Gemini gave one.
    const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(blockReason ? `Gemini blocked the request: ${blockReason}` : 'Gemini did not return an image.');
  }

  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mimeType: inline.mime_type || inline.mimeType || 'image/png',
  };
}

module.exports = { arrangeClothingPhoto };

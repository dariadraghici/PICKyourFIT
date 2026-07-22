// Local, free, self-hosted replacement for the old Gemini ("Nano Banana")
// call. Runs entirely on this server via an ONNX model bundled with
// @imgly/background-removal-node - no external API, no API key, no quota,
// no per-request cost, and the photo never leaves this machine.
//
// It can't "redraw" the garment the way a generative model could, but it
// does the two things that step actually needed in practice:
//   1. Segment out the foreground (the person/garment) from clutter.
//   2. Crop tightly to it and place it centered on a plain light-gray
//      "studio" background, the same look the old Gemini prompt asked for.
//
// Called BEFORE classification and BEFORE /api/remove-bg, same as before -
// remove-bg still does the final, more precise background strip later.

const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

const STUDIO_BG = { r: 235, g: 235, b: 235 }; // light gray, matches old prompt
const OUTPUT_SIZE = 1024; // square canvas
const PADDING_RATIO = 0.08; // breathing room around the garment

// buffer: Buffer of the uploaded image. mimeType: e.g. 'image/jpeg'.
// Returns { buffer, mimeType } of the processed image (same shape the old
// arrangeClothingPhoto() returned, so enhanceRoutes.js barely changes).
async function isolateGarment(buffer, mimeType) {
  // 1. Segment foreground vs background.
  const blob = new Blob([buffer], { type: mimeType || 'image/jpeg' });
  const resultBlob = await removeBackground(blob);
  const cutoutBuffer = Buffer.from(await resultBlob.arrayBuffer());

  // 2. Trim the fully-transparent margins left after segmentation, so we're
  //    left with just the bounding box of whatever was detected.
  const trimmed = await sharp(cutoutBuffer).trim({ threshold: 10 }).toBuffer();
  const { width, height } = await sharp(trimmed).metadata();

  if (!width || !height) {
    throw new Error('Could not detect a garment in the photo.');
  }

  // 3. Composite onto a plain light-gray square canvas, centered, padded.
  const pad = Math.round(Math.max(width, height) * PADDING_RATIO);
  const canvasSize = Math.max(width, height) + pad * 2;

  const composed = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 3,
      background: STUDIO_BG,
    },
  })
    .composite([
      {
        input: trimmed,
        left: Math.round((canvasSize - width) / 2),
        top: Math.round((canvasSize - height) / 2),
      },
    ])
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: STUDIO_BG })
    .png()
    .toBuffer();

  return { buffer: composed, mimeType: 'image/png' };
}

module.exports = { isolateGarment };

const express = require('express');
const multer = require('multer');
const { isolateGarment } = require('./imageProcessing');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB, same cap as wardrobe uploads
});

// POST /api/enhance-image  multipart/form-data, field name "image_file"
// Runs the raw upload through a local segmentation model so it comes back
// isolated on a clean, light-gray background. Called client-side right
// after the file picker, before classification and before /api/remove-bg.
// Fully local - no external API, no key, no rate limit, no cost.
router.post('/enhance-image', upload.single('image_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image_file provided.' });
    }

    const { buffer, mimeType } = await isolateGarment(req.file.buffer, req.file.mimetype);

    res.set('Content-Type', mimeType);
    return res.send(buffer);
  } catch (err) {
    console.error('Image enhance error:', err.message);
    return res.status(502).json({ error: 'Could not generate the enhanced photo.' });
  }
});

module.exports = router;

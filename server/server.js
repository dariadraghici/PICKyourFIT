require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');

const { projectId } = require('./firebaseAdmin');
const authRoutes = require('./authRoutes');
const wardrobeRoutes = require('./wardrobeRoutes');
const profileRoutes = require('./profileRoutes');
const calendarRoutes = require('./calendarRoutes');
const favoritesRoutes = require('./favoritesRoutes');

const app = express();
const upload = multer(); // keeps uploaded file in memory, doesn't write to disk

app.set('trust proxy', true);

app.use(express.json());

const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;

if (!REMOVE_BG_API_KEY) {
  console.error('ERROR: REMOVE_BG_API_KEY is not set. Create a .env file (see .env.example).');
  process.exit(1);
}
if (!process.env.FIREBASE_WEB_API_KEY) {
  console.error('ERROR: FIREBASE_WEB_API_KEY is not set. Create a .env file (see .env.example).');
  process.exit(1);
}

// Serve landing.html when the site root is opened, instead of index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// index: false so express.static doesn't fall back to index.html on '/'
app.use(express.static(path.join(__dirname, '..'), { index: false }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// calendar-core.js and calendar-picker.js live in the server/ folder (next to
// server.js), not in the project root, so express.static above won't find
// them. Serve those two files explicitly at the site root instead.
app.get('/calendar-core.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'calendar-core.js'));
});
app.get('/calendar-picker.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'calendar-picker.js'));
});

// Public Firebase web config for the client-side SDK (needed for "Continue
// with Google"). None of these values are secret — this is the same config
// Firebase expects apps to ship inside their client-side JS.
app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  });
});

app.use('/api', authRoutes);

app.use('/api', profileRoutes);

app.use('/api/wardrobe', wardrobeRoutes);

app.use('/api/calendar', calendarRoutes);

app.use('/api/favorites', favoritesRoutes);

app.post('/api/remove-bg', upload.single('image_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image_file provided.' });
    }

    const formData = new FormData();
    formData.append('size', 'auto');
    formData.append(
      'image_file',
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname
    );

    const rbgResponse = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_API_KEY, // stays on the server, never sent to the browser
      },
      body: formData,
    });

    if (!rbgResponse.ok) {
      const errText = await rbgResponse.text();
      console.error('remove.bg error:', rbgResponse.status, errText);
      return res.status(rbgResponse.status).json({ error: 'remove.bg request failed.' });
    }

    const arrayBuffer = await rbgResponse.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PICKyourFIT server running at http://localhost:${PORT}`);
});
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { db, auth } = require('./firebaseAdmin');

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, 'uploads', 'wardrobe');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per poză
});

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Autentificare necesară.' });

    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesiune invalidă sau expirată.' });
  }
}


router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nicio imagine trimisă.' });
    }
    const { description = '', brand = '' } = req.body;

    const itemId = randomUUID();
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';

    const userDir = path.join(UPLOAD_ROOT, req.uid);
    fs.mkdirSync(userDir, { recursive: true });

    const fileName = `${itemId}.${ext}`;
    const absolutePath = path.join(userDir, fileName);
    fs.writeFileSync(absolutePath, req.file.buffer);

    const imageUrl = `/uploads/wardrobe/${req.uid}/${fileName}`; // public URL 

    const itemData = {
      imageUrl,
      description,
      brand,
      createdAt: new Date().toISOString(),
    };

    await db
      .collection('users')
      .doc(req.uid)
      .collection('wardrobe')
      .doc(itemId)
      .set(itemData);

    return res.status(201).json({ id: itemId, ...itemData });
  } catch (err) {
    console.error('Wardrobe add error:', err);
    return res.status(500).json({ error: 'Nu s-a putut salva articolul.' });
  }
});


router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('users')
      .doc(req.uid)
      .collection('wardrobe')
      .orderBy('createdAt', 'desc')
      .get();

    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ items });
  } catch (err) {
    console.error('Wardrobe list error:', err);
    return res.status(500).json({ error: 'Nu s-a putut încărca dulapul.' });
  }
});


router.delete('/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const itemRef = db.collection('users').doc(req.uid).collection('wardrobe').doc(itemId);
    const itemDoc = await itemRef.get();

    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Articolul nu a fost găsit.' });
    }

    const { imageUrl } = itemDoc.data();
    if (imageUrl) {
      const absolutePath = path.join(__dirname, imageUrl.replace(/^\//, ''));
      fs.unlink(absolutePath, () => {}); // best-effort that doesn't block deletion if the file is missing
    }
    await itemRef.delete();

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Wardrobe delete error:', err);
    return res.status(500).json({ error: 'Nu s-a putut șterge articolul.' });
  }
});

module.exports = router;

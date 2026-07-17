const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { db, auth } = require('./firebaseAdmin');
const { uploadBuffer, deleteAsset } = require('./cloudinaryClient');

const router = express.Router();

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
    const { description = '', brand = '', category = '' } = req.body;
    const itemId = randomUUID();

    const result = await uploadBuffer(req.file.buffer, `wardrobe/${req.uid}`);

    const itemData = {
      imageUrl: result.secure_url,
      imagePublicId: result.public_id,
      description,
      brand,
      category,
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


router.patch('/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { brand, description } = req.body || {};

    const itemRef = db.collection('users').doc(req.uid).collection('wardrobe').doc(itemId);
    const itemDoc = await itemRef.get();

    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Articolul nu a fost găsit.' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (typeof brand === 'string') updates.brand = brand.trim();
    if (typeof description === 'string') updates.description = description.trim();

    await itemRef.set(updates, { merge: true });

    const updatedDoc = await itemRef.get();
    return res.status(200).json({ id: itemId, ...updatedDoc.data() });
  } catch (err) {
    console.error('Wardrobe update error:', err);
    return res.status(500).json({ error: 'Nu s-a putut actualiza articolul.' });
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

    const { imagePublicId } = itemDoc.data();
    await deleteAsset(imagePublicId); // best-effort, doesn't throw if missing
    await itemRef.delete();

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Wardrobe delete error:', err);
    return res.status(500).json({ error: 'Nu s-a putut șterge articolul.' });
  }
});

module.exports = router;

const express = require('express');
const { db } = require('./firebaseAdmin');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

const UNVERIFIED_FAVORITES_LIMIT = 2;

function favoritesCol(uid) {
  return db.collection('users').doc(uid).collection('favorites');
}

// GET /api/favorites -> all favorited outfits for the logged-in user
router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await favoritesCol(req.uid).orderBy('savedAt', 'desc').get();
    const favorites = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ favorites });
  } catch (err) {
    console.error('Favorites list error:', err);
    return res.status(500).json({ error: 'Could not load the favorites.' });
  }
});

// POST /api/favorites  body: { signature, type, items }
// Dedupes by signature — if the outfit is already favorited, returns the
// existing entry instead of creating a second one.
router.post('/', requireAuth, async (req, res) => {
  try {
    const { signature, type, items } = req.body || {};

    if (!signature || !type || !items) {
      return res.status(400).json({ error: 'Incomplete outfit data.' });
    }

    const existing = await favoritesCol(req.uid)
      .where('signature', '==', signature)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(200).json({ id: existing.docs[0].id, ...existing.docs[0].data() });
    }

    if (!req.emailVerified) {
      const currentFavs = await favoritesCol(req.uid).get();
      if (currentFavs.size >= UNVERIFIED_FAVORITES_LIMIT) {
        return res.status(403).json({
          error: `Unverified account can have at most ${UNVERIFIED_FAVORITES_LIMIT} outfits in favorites. Verify your email to save more.`,
        });
      }
    }

    const favData = {
      signature,
      type,
      items,
      savedAt: new Date().toISOString(),
    };
    const docRef = await favoritesCol(req.uid).add(favData);

    return res.status(201).json({ id: docRef.id, ...favData });
  } catch (err) {
    console.error('Favorites add error:', err);
    return res.status(500).json({ error: 'Could not save the outfit to favorites.' });
  }
});

// DELETE /api/favorites/:favId
router.delete('/:favId', requireAuth, async (req, res) => {
  try {
    const { favId } = req.params;
    const favRef = favoritesCol(req.uid).doc(favId);
    const favDoc = await favRef.get();

    if (!favDoc.exists) {
      return res.status(404).json({ error: 'Favorite not found.' });
    }

    await favRef.delete();

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Favorites delete error:', err);
    return res.status(500).json({ error: 'Could not delete the favorite.' });
  }
});

module.exports = router;

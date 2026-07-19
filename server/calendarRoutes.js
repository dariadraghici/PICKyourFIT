const express = require('express');
const { db } = require('./firebaseAdmin');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

const UNVERIFIED_CALENDAR_LIMIT = 2;

function calendarCol(uid) {
  return db.collection('users').doc(uid).collection('calendar');
}
function favoritesCol(uid) {
  return db.collection('users').doc(uid).collection('favorites');
}

// GET /api/calendar -> all scheduled outfits for the logged-in user
router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await calendarCol(req.uid).orderBy('date', 'asc').get();
    const entries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ entries });
  } catch (err) {
    console.error('Calendar list error:', err);
    return res.status(500).json({ error: 'Nu s-a putut încărca calendarul.' });
  }
});

// POST /api/calendar  body: { signature, type, items, isTights, date }
// Schedules an outfit on a given day. Rejects if the same outfit is already
// scheduled on that day (this is the server-side guard against duplicates —
// the client also checks its local cache before calling this).
router.post('/', requireAuth, async (req, res) => {
  try {
    const { signature, type, items, isTights, date } = req.body || {};

    if (!signature || !type || !items || !date) {
      return res.status(400).json({ error: 'Date de outfit incomplete.' });
    }

    if (!req.emailVerified) {
      const currentEntries = await calendarCol(req.uid).get();
      if (currentEntries.size >= UNVERIFIED_CALENDAR_LIMIT) {
        return res.status(403).json({
          error: `Conturile neverificate pot avea maximum ${UNVERIFIED_CALENDAR_LIMIT} outfituri în calendar. Verifică-ți emailul pentru a planifica mai multe.`,
        });
      }
    }

    const existing = await calendarCol(req.uid)
      .where('date', '==', date)
      .where('signature', '==', signature)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(409).json({ error: 'Acest outfit este deja planificat pentru ziua respectivă.' });
    }

    const entryData = {
      signature,
      type,
      items,
      isTights: !!isTights,
      date,
      savedAt: new Date().toISOString(),
    };

    const docRef = await calendarCol(req.uid).add(entryData);

    return res.status(201).json({ id: docRef.id, ...entryData });
  } catch (err) {
    console.error('Calendar add error:', err);
    return res.status(500).json({ error: 'Nu s-a putut planifica outfitul.' });
  }
});

// DELETE /api/calendar/:entryId
router.delete('/:entryId', requireAuth, async (req, res) => {
  try {
    const { entryId } = req.params;
    const entryRef = calendarCol(req.uid).doc(entryId);
    const entryDoc = await entryRef.get();

    if (!entryDoc.exists) {
      return res.status(404).json({ error: 'Intrarea nu a fost găsită.' });
    }

    await entryRef.delete();

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Calendar delete error:', err);
    return res.status(500).json({ error: 'Nu s-a putut șterge intrarea din calendar.' });
  }
});

// POST /api/calendar/:entryId/favorite
// Removes the entry from the calendar and saves it to favorites (dedupes by signature).
router.post('/:entryId/favorite', requireAuth, async (req, res) => {
  try {
    const { entryId } = req.params;
    const entryRef = calendarCol(req.uid).doc(entryId);
    const entryDoc = await entryRef.get();

    if (!entryDoc.exists) {
      return res.status(404).json({ error: 'Intrarea nu a fost găsită.' });
    }

    const entry = entryDoc.data();

    const existingFav = await favoritesCol(req.uid)
      .where('signature', '==', entry.signature)
      .limit(1)
      .get();

    if (existingFav.empty && !req.emailVerified) {
      const currentFavs = await favoritesCol(req.uid).get();
      if (currentFavs.size >= UNVERIFIED_CALENDAR_LIMIT) {
        return res.status(403).json({
          error: `Conturile neverificate pot avea maximum ${UNVERIFIED_CALENDAR_LIMIT} outfituri favorite. Verifică-ți emailul pentru a salva mai multe.`,
        });
      }
    }

    let favorite;
    if (!existingFav.empty) {
      favorite = { id: existingFav.docs[0].id, ...existingFav.docs[0].data() };
    } else {
      const favData = {
        signature: entry.signature,
        type: entry.type,
        items: entry.items,
        savedAt: new Date().toISOString(),
      };
      const favRef = await favoritesCol(req.uid).add(favData);
      favorite = { id: favRef.id, ...favData };
    }

    await entryRef.delete();

    return res.status(200).json({ removedEntryId: entryId, favorite });
  } catch (err) {
    console.error('Calendar move-to-favorites error:', err);
    return res.status(500).json({ error: 'Nu s-a putut muta outfitul la favorite.' });
  }
});

module.exports = router;

const express = require('express');
const { db } = require('./firebaseAdmin');

const router = express.Router();

const TOPICS = ['Scanare', 'Garderobă', 'Ținute', 'Calendar', 'Favorite', 'Cont', 'Bug', 'Altele'];

function reviewsCol() {
  return db.collection('reviews');
}
function contactCol() {
  return db.collection('contactMessages');
}

router.get('/reviews', async (req, res) => {
  try {
    const { topic } = req.query;
    let snapshot;
    if (topic && TOPICS.includes(topic)) {
      snapshot = await reviewsCol().where('topics', 'array-contains', topic).orderBy('createdAt', 'desc').get();
    } else {
      snapshot = await reviewsCol().orderBy('createdAt', 'desc').get();
    }
    const reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ reviews, topics: TOPICS });
  } catch (err) {
    console.error('Reviews list error:', err);
    return res.status(500).json({ error: 'The reviews could not be loaded.' });
  }
});

router.post('/reviews', async (req, res) => {
  try {
    const { name, subject, rating, message, topics } = req.body || {};

    const cleanName = (name || '').trim().slice(0, 60) || 'anonymous';
    const cleanSubject = (subject || '').trim().slice(0, 120);
    const cleanMessage = (message || '').trim().slice(0, 2000);
    const numericRating = Number(rating);
    const cleanTopics = Array.isArray(topics)
      ? [...new Set(topics)].filter((t) => TOPICS.includes(t)).slice(0, TOPICS.length)
      : [];

    if (!cleanSubject || !cleanMessage) {
      return res.status(400).json({ error: 'Subject and message are required.' });
    }
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Please select a rating between 1 and 5.' });
    }
    if (!cleanTopics.length) {
      return res.status(400).json({ error: 'Please choose at least one topic.' });
    }

    const reviewData = {
      name: cleanName,
      subject: cleanSubject,
      rating: numericRating,
      message: cleanMessage,
      topics: cleanTopics,
      createdAt: new Date().toISOString(),
    };

    const docRef = await reviewsCol().add(reviewData);

    return res.status(201).json({ id: docRef.id, ...reviewData });
  } catch (err) {
    console.error('Review add error:', err);
    return res.status(500).json({ error: 'The review could not be submitted.' });
  }
});

router.post('/contact', async (req, res) => {
  try {
    const { subject, message, email } = req.body || {};

    const cleanSubject = (subject || '').trim().slice(0, 120);
    const cleanMessage = (message || '').trim().slice(0, 3000);
    const cleanEmail = (email || '').trim().slice(0, 200);

    if (!cleanSubject || !cleanMessage) {
      return res.status(400).json({ error: 'Subject and message are required.' });
    }

    await contactCol().add({
      subject: cleanSubject,
      message: cleanMessage,
      email: cleanEmail || null,
      status: 'new',
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('Contact message error:', err);
    return res.status(500).json({ error: 'The message could not be sent.' });
  }
});

module.exports = router;

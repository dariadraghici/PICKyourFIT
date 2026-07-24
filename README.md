# Pick Your Fit

![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%26%20Firestore-FFCA28?logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/Cloudinary-Image%20Storage-3448C5?logo=cloudinary&logoColor=white)
![Teachable Machine](https://img.shields.io/badge/Google-Teachable%20Machine-4285F4?logo=google&logoColor=white)
![remove.bg](https://img.shields.io/badge/remove.bg-Background%20Removal-1F1F1F)
![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7?logo=render&logoColor=white)
![License](https://img.shields.io/badge/License-Unlicensed-lightgrey)

**Your digital wardrobe. Your style, planned.**

Pick Your Fit is a full-stack web application that turns a physical wardrobe into a digital one: you scan your clothes once, the app automatically recognizes their category, and you get outfit suggestions and the ability to plan them on a calendar - without ever pulling anything off a hanger.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <strong>Test the app live right now:</strong><br>
        <a href="https://pickyourfit.onrender.com/"><strong>https://pickyourfit.onrender.com/</strong></a>
      </td>
    </tr>
  </table>
</div>

## The Story

It started with a mundane but recurring frustration: packing for a trip.

At the beginning of July 2026, while getting ready for a trip to Rome, I did what I always do - took almost everything out of my wardrobe - and still couldn't find anything I actually loved. The problem was never a shortage of clothes; it was the absence of any structured overview of what I already owned and how those pieces could be combined.

> "What if my whole wardrobe lived in one place, and I could plan outfits without ever pulling a single thing off its hanger?"
> - the question asked the night before packing for Rome, July 2026

That question is where Pick Your Fit began: an app where you digitize your wardrobe once, item by item, and then get outfit suggestions on demand - removing both the guesswork and the time lost in the process.

### Before / After

| Before | After |
|---|---|
| "I have nothing to wear." | Open Pick Your Fit |
| 45+ minutes lost searching | Find what you love in seconds |
| A messy room, every time | Create the perfect outfit |
| Overpacking for every trip | Pack only what you need |
| Stress before every trip | More time for the trip itself |

Pick Your Fit is built for anyone who has ever said "I have nothing to wear," has plenty of clothes but still feels stuck, loves traveling and packing smart, wants to save money, or simply wants a more organized life.

---

## Technical Origin: the "What A Blouse" Foundation Project

Before any outfit-generation logic could be built, the app needed one core capability: to automatically determine, from a photograph alone, what type of garment it depicts. This piece was validated separately, in a proof-of-concept project called **What A Blouse / PICKyourFIT (classifier)**, which isolates exactly this problem:

- An image classification model trained with **Google Teachable Machine**, exported as a **TensorFlow.js** model and run entirely in-browser (no server, no image upload for inference).
- A manually assembled dataset, with a minimum of 30 representative photographs per category (T-shirt, blouse, shirt, jacket, blazer, pullover, hoodie, crop top, turtleneck, tank top, shorts, pants, skirt, tights, leggings, dress, bodysuit, jumpsuit, romper, socks, boots, sneakers, heels, glasses, plus a dedicated category for images that are not clothing at all).
- An **entropy-based confidence mechanism**, which addresses a structural limitation of any classifier: it will always output a probability for every class it was trained on, even for images with no relation to those classes (a wall, an animal, a face).

**How the entropy check works:**

For a probability distribution p1, p2, ..., pn over n classes, Shannon entropy is defined as:

```
H(p) = - sum(pi * log2(pi)), for i = 1 to n
```

The theoretical maximum occurs when the distribution is perfectly uniform (pi = 1/n for all i):

```
H_max = log2(n)
```

Normalizing gives a value between 0 and 1:

```
H_norm = H(p) / H_max
```

- **H_norm close to 0** -> concentrated distribution -> confident prediction (likely a real garment).
- **H_norm close to 1** -> uniform distribution -> total uncertainty (likely not clothing).

**Thresholds used:**
1. If `H_norm < 0.80`, the image passes the "is this clothing at all" check.
2. If the highest individual class probability is at least 72%, the prediction is shown directly.
3. If it falls below 72%, the interface shows several candidate categories with their confidence percentages and lets the user make the final call.

This proof-of-concept had no backend, database, or persistence - the wardrobe existed only in browser memory, for the duration of the session. Its sole purpose was to validate the classification pipeline before it became the foundation of the full application, **Pick Your Fit**.

---

## Features

### 1. Scanning and AI recognition
Every scan runs the same five steps, whether the user is a guest or logged in:

1. **Upload photo** - take or upload a photo of the item.
2. **Teachable Machine** - the trained model analyzes the image.
3. **Category prediction** - the algorithm predicts the most likely category.
4. **Review and edit** - confirm or manually correct the category.
5. **Save to wardrobe** - add the item if logged in.

Under the hood: **Google Teachable Machine** (classification), **remove.bg** (background removal), **Firebase** (auth and data), **Cloudinary** (image storage).

### 2. Digital wardrobe
- Unlimited clothing organization (for verified accounts).
- Instant search across the whole closet.
- Filter by category.
- Mark favorite pieces.
- Outfit suggestions generated from what the user already owns.
- Each item can be annotated with a brand name and a short description.
- The background of every image is automatically removed before saving, so each item is stored isolated on a transparent background.

### 3. Create outfits
- Drag and drop pieces from the wardrobe onto a canvas, the way you'd lay an outfit out on a bed.
- Create and save an unlimited number of outfits (verified account).
- Edit an existing outfit later, or duplicate it as a starting point.

### 4. Outfit gallery
- Every outfit created is stored in the user's personal gallery.
- Open any outfit to edit it, favorite it, or plan it on the calendar.

### 5. Calendar
- Assign an outfit to any day on the calendar.
- Avoid accidentally repeating the same outfit.
- Plan holidays, work weeks, or a single trip.
- See every upcoming outfit at a glance.

### 6. Archives
- Every outfit ever created stays on record.
- Browse previous months and years at any time (e.g. 2026, Summer, July: 31 outfits).

### 7. Contact and community
- Report a bug, ask a question, or send a suggestion directly to the team.
- A community space for sharing ideas, fashion inspiration, and general discussions.

### 8. Privacy and control
- No images are shared publicly.
- Only the account owner can access their wardrobe.
- One-click account deletion, with a permanent cascade delete of clothing, outfits, favorites, calendar, profile, and account information.

---

## Access Levels (Guest / Registered / Verified)

| Level | What you can do |
|---|---|
| **Guest** (no account) | Scan clothes and get AI recognition; browse the landing page and features; read about the app, reviews, contact info. Cannot save anything - everything is lost at the end of the session. |
| **Registered** (email not confirmed) | Can save clothes to the wardrobe, but everything is capped: **2 items per category, 2 favorites, 2 planned outfits**, until the email is confirmed. |
| **Verified** (email confirmed) | Unlimited wardrobe and favorites; unlimited outfit planning and calendar; full archives and statistics; everything unlocked, no limits. |

The cap on unconfirmed accounts is enforced **at the backend level, across all route files**, not just in the UI - so the limits cannot be bypassed with direct API calls.

---

## Technical Stack

**Frontend**
- HTML, CSS, and vanilla JavaScript, multi-page (no framework)
- `calendar-core.js` / `calendar-picker.js` - shared modules for calendar views (week/month/year)
- Google Fonts: Fraunces, Inter, JetBrains Mono

**Backend**
- Node.js and Express
- Authentication: **Firebase Authentication** (JWT passed as a Bearer token in authorization headers)
- Database: **Firebase Firestore** - profile, wardrobe item metadata (brand, category, description, createdAt), outfits, favorites, calendar
- Firestore security rules: each user can read, write, or delete only their own data

**Images**
- **Cloudinary** - storage and encrypted CDN delivery for avatars and wardrobe photos, organized under a `wardrobe/{uid}` folder
- **remove.bg (Kaleido AI)**, called through a secure backend proxy, for automatic background removal (ephemeral processing, no image retention by the third party)
- Avatar images are cropped and optimized client-side (Cropper.js) to 512x512px, JPEG, 88% quality

**Hosting and infrastructure**
- Backend deployed on **Render** (free tier)
- Source control on **GitHub**

---

## Data Collected and Privacy (summary)

- **Account data:** first name, last name, email.
- **Authentication:** hashed password (Firebase), IP address logged temporarily at sign-up to enforce a 2-accounts-per-IP limit.
- **Local session:** `pyf_idToken`, `pyf_uid`, `pyf_userPhoto` stored in LocalStorage - strictly functional, no tracking or advertising cookies.
- **Account deletion (cascade delete):** irreversibly removes the wardrobe from Firestore, images from Cloudinary, the profile document, and credentials from Firebase Authentication, plus local browser data. The process cannot be undone and no backups are kept.
- **Minimum age:** 13 (16 within the EU/EEA), per GDPR/COPPA.

---

## Installation and Local Setup

### Prerequisites
- Node.js 18+ and npm
- A Firebase project with Authentication (Email/Password) and Firestore enabled
- A Cloudinary account (cloud name, API key, API secret)
- A remove.bg API key

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/dariadraghici/PICKyourFIT
cd pick-your-fit

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
# then fill in the values described in "Environment Variables" below

# 4. Add your Firebase service account credentials
# Download the service account JSON from Firebase Console
# and place it as described in your .env (or as serviceAccountKey.json,
# depending on how firebase-admin is initialized in the project)

# 5. Run the app in development mode
npm run dev

# App will be available at:
# http://localhost:3000
```

### Frontend
The frontend is plain HTML/CSS/JS and is served statically by the Express backend, so no separate build step is required - once the server is running, the pages are available at the same host and port.

---

## Environment Variables

Create a `.env` file in the project root with the following keys:

```env
# Server
PORT=3000
NODE_ENV=development

# Firebase (client SDK config, used by the frontend)
FIREBASE_SERVICE_ACCOUNT=

# Firebase Admin SDK (server-side, for Firestore + token verification)
FIREBASE_WEB_API_KEY=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# remove.bg
REMOVE_BG_API_KEY=
```

Notes:
- `FIREBASE_PRIVATE_KEY` usually needs its newline characters escaped (`\n`) when stored in a single-line `.env` value.
- Never commit `.env` or any service account JSON file to source control; make sure both are listed in `.gitignore`.
- The `IP_ACCOUNT_LIMIT` variable reflects the 2-accounts-per-IP rule described in the Privacy section above and can be adjusted for local testing.

---

## Current Project Status

Active areas of work include:
- Email verification with per-feature caps for unverified accounts, enforced consistently across all backend route files.
- A fix for a stale JWT token bug affecting session refresh.
- UI refinements: a responsive profile page grid, a "Currently Planned Outfits" section, mini-stat blocks.
- The earlier migration of calendar and favorites data from LocalStorage to Firestore, using Bearer-token-authenticated fetch calls.
- Replacing ephemeral storage on Render's disk with Cloudinary, for real persistence of avatars and wardrobe photos.

---

*Built by Daria-Ioana Drăghici - for everyone who has ever said "I have nothing to wear."*
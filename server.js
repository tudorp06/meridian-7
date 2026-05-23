require('dotenv').config();
const express = require('express');
const path    = require('path');
const fetch   = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS for cross-origin requests from A3
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const API_KEY = process.env.GEMINI_API_KEY;

if (API_KEY) {
  console.log(`[✓] API key loaded: ${API_KEY.slice(0, 8)}...`);
}

// ── Rate limiter — protect the shared API key ─────────────────────────────────
const rateLimits = new Map(); // IP → { count, resetTime }
const RATE_LIMIT  = 20;       // max fabrications per window
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_WINDOW };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return { allowed: entry.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - entry.count) };
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetTime) rateLimits.delete(ip);
  }
}, 10 * 60 * 1000);

// ── /test — visit in browser to confirm key + see available models ─────────────
app.get('/test', async (req, res) => {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
    );
    const data = await r.json();
    if (data.error) return res.json({ error: data.error });
    const names = (data.models || []).map(m => m.name);
    res.json({ status: 'OK', available_models: names });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── /fabricate ────────────────────────────────────────────────────────────────
const MODEL = 'gemini-2.5-flash';

async function callGemini(prompt, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

app.post('/fabricate', async (req, res) => {
  const { description, apiKey } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'Description required' });

  // Use the key the player provided; fall back to server .env key
  const keyToUse = (apiKey && apiKey.startsWith('AIza')) ? apiKey : API_KEY;
  if (!keyToUse) return res.status(401).json({ error: 'No API key — enter one on the start screen' });

  // Rate limit when using the shared server key (not player's own key)
  const usingSharedKey = !apiKey || !apiKey.startsWith('AIza');
  if (usingSharedKey) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const { allowed, remaining } = checkRateLimit(ip);
    if (!allowed) {
      return res.status(429).json({ error: `Rate limit reached (${RATE_LIMIT}/hour). Enter your own free API key to get unlimited fabrications!` });
    }
    console.log(`[RATE] ${ip}: ${remaining} fabrications remaining this hour`);
  }

  const prompt = `You are the fabrication AI aboard a derelict space station in 2387. A survivor requested to fabricate: "${description.trim()}"

IMPORTANT: BE CREATIVE. Don't default to generic descriptions. Match the EXACT request, not a generic version.

Respond with ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "name": "2-5 word unique name matching the request exactly",
  "type": "weapon" | "armor" | "ally" | "hazard" | "consumable" | "pet" | "vehicle" | "tool" | "trap",
  "color": "a vivid neon CSS hex color that fits the item",
  "stats": {
    "damage": <integer 0-100>,
    "defense": <integer 0-50>,
    "hp": <integer 0-500>,
    "speed": <integer 0-3>
  },
  "description": "one sentence sci-fi flavor text describing THIS SPECIFIC item, max 20 words",
  "emoji": "one emoji that perfectly represents THIS SPECIFIC item",
  "specialEffect": "invisibility" | "colorChange" | "sizeChange" | "speedBoost" | "shield" | "regen" | "explosive" | "poison" | "freeze" | "fire" | "electric" | "none"
}

TYPE RULES — BE SPECIFIC, match the request:
- weapon → offensive item (guns, swords, lasers, unconventional weapons)
- armor → defensive gear (shields, suits, force fields)
- consumable → one-time use item (HP restore, special effects like invisibility/color change)
- ally → autonomous combat unit - BE CREATIVE! "ally xenomorph" = actual xenomorph, NOT generic drone
- pet → non-combat companion (cats, dogs, creatures) - USE THE EXACT ANIMAL REQUESTED
- vehicle → mount/vehicle (speed boost)
- tool → utility item with special effects. USE THIS for unusual/creative/non-combat requests (cellphone, boat, teleporter, laptop, umbrella, chair, etc.) — give them fun sci-fi flavor and minor stat boosts
- trap → stationary hazard damaging enemies
- hazard → ONLY use for explicitly dangerous/destructive requests like "nuclear bomb", "black hole", "antimatter explosion", "self-destruct". Do NOT make unusual or creative items into hazards! A "cellphone" is a tool, a "boat" is a vehicle, a "teleporter" is a tool with speedBoost

CREATIVITY RULES — NAMES MUST BE UNIQUE AND SPECIFIC:
- "ally xenomorph" → "Xenostriker" or "Xeno Alpha" (NOT "Xenomorph Drone" or "Allied Xenomorph")
- "giant ally bot" → "Titan Guardian" or "Colossus MK-7" (NOT "Giant Bot" or "Colossal Bot")
- "ally cat" → "Combat Feline" or "Hunter Cat" (describe unique attack style)
- "dragon ally" → "Plasma Drake" or "Inferno Wyrm" (NOT "Dragon Ally")
- "robot friend" → "Sentinel-9000" or "Guardian Core" (NOT "Friendly Robot")
- "invisibility potion" → "Stealth Serum", set specialEffect: "invisibility"
- "color change potion" → "Chromatic Elixir", set specialEffect: "colorChange"
- Match the VIBE of the request - horror → creepy names, cute → friendly names
- AVOID generic pattern "ADJECTIVE + NOUN" — be creative with the name itself

CRITICAL STAT SCALING — respect numbers and adjectives:
- "200HP potion" → hp: 200
- "massive heal" → hp: 150-300
- "weak pistol" → damage: 3-6
- "minigun" or "bazooka" → damage: 35-60
- "legendary sword" → damage: 40-55
- "titanium armor" → defense: 25-35
- "speed boost" → speed: 2-3
- "cat" or "dog" → type: pet, hp: 20-40, damage: 0
- Always match described power level. Do NOT cap stats conservatively.

SPECIAL EFFECTS — assign based on request:
- "invisibility potion" → specialEffect: "invisibility" (10s invisible, enemies can't see you)
- "color change potion" → specialEffect: "colorChange" (changes player color)
- "growth serum" → specialEffect: "sizeChange" (player becomes larger)
- "speed boost" → specialEffect: "speedBoost" (extra movement speed)
- "shield generator" → specialEffect: "shield" (50 HP shield)
- "regeneration kit" → specialEffect: "regen" (heal over time)
- Most items → specialEffect: "none"

EMOJI SELECTION — be highly specific, THE EMOJI IS THE VISUAL:
- "minigun" → 🔫
- "laser sword" → ⚔️
- "cat" → 🐱
- "dog" → 🐕
- "xenomorph" → 👽 (alien face, NOT 👾 generic)
- "alien" → 👾
- "healing potion" → 🧪
- "invisibility potion" → 🫥 or 👻
- "robot ally" → 🤖
- "dragon" → 🐉
- "monster" → 👹
- "creature" → 🦖 or 🦕 or 🐙
- "giant bot" → 🤖 (but NAME it uniquely!)
- CRITICAL: The emoji IS what players see - choose carefully to match the EXACT request

Output valid JSON only, nothing else`;

  try {
    const raw = (await callGemini(prompt, keyToUse))
      .trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const data = JSON.parse(raw);
    console.log(`[FABRICATED] ${data.type.toUpperCase()} — ${data.name}: ${data.description}`);
    console.log(`             stats: ATT ${data.stats?.damage||0} DEF ${data.stats?.defense||0} HP ${data.stats?.hp||0}`);
    res.json(data);
  } catch (err) {
    console.error('Fabrication error:', err.message);
    res.status(500).json({ error: 'Fabrication system offline' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`STATION FABRICATE → http://localhost:${PORT}`));

# 🛸 MERIDIAN-7

**A sci-fi roguelike with AI-generated items**

> *The armory is locked. Communications are down. Your only hope? An experimental AI fabrication terminal.*

---

## 🎮 What Is This?

You're trapped on a derelict space station. The defense AI went rogue. You're unarmed.

But you have access to a **fabrication terminal powered by Google Gemini AI.** Type a description — the AI generates an item with a unique name, stats, description, and icon in real-time.

- Type `minigun` → get a weapon with generated stats and flavor text
- Type `healing potion` → get a consumable with HP restore
- Type `robot ally` → get an autonomous combat companion
- Type `cat` → get a pet that follows you around

The AI decides the item type, balances the stats, writes a description, and picks an emoji icon — all on the fly. No predefined item list. No loot tables.

---

## 🤖 How the AI Works

The game uses **Google Gemini 2.0 Flash** as a real-time item generation system:

1. You type a description into the fabrication terminal
2. The description is sent to the Gemini API
3. The AI returns JSON with: **name, type, stats (damage/defense/HP/speed), description, emoji, color, and special effects**
4. The item materializes in the game world

**What's AI-generated:**
- Item **names** — unique sci-fi names based on your input
- Item **stats** — damage, defense, HP, speed values balanced by the AI
- Item **descriptions** — one-line flavor text
- Item **emoji icons** — the AI picks a representative emoji per item
- Item **type classification** — weapon, armor, ally, pet, consumable, vehicle, tool, trap, or hazard

**What's NOT AI-generated:**
- The game engine, map generation, combat system, sprites
- Enemy models (4 predefined types: drone, crawler, sentinel, alien)
- Weapon PNG icons (hand-made, matched by keyword detection)
- Allies that match existing enemy types use the game's sprite models in green; everything else renders as the AI-chosen emoji

The AI respects numbers and adjectives — `200HP potion` gives ~200 HP, `weak pistol` gives low damage, `legendary sword` gives high damage. But it's not perfect — unusual requests may get creative interpretations.

---

## 🎵 Features

- **AI fabrication** — generate items from any text description via Gemini API
- **Real-time combat** — continuous movement, independent enemy AI
- **9 item types** — weapons, armor, allies, pets, vehicles, consumables, tools, traps, hazards
- **Allies & pets** — fabricated companions follow you and persist between levels
- **5 levels** with progressive alien corruption (clean station → infested reactor)
- **Boss encounters** near level exits with threat indicators
- **Increasing difficulty** — enemies get tougher each floor
- **Organic map generation** — circular rooms, irregular blobs, corridors
- **Particle effects** — fabrication, hits, projectile trails
- **Minimap, tooltips, damage numbers, screen shake**

---

## 🕹️ Controls

| Key | Action |
|-----|--------|
| **W A S D** / **Arrows** | Move |
| **F** | Open Fabrication Terminal |
| **SPACE** | Use equipped weapon (hold to auto-fire) |
| **I** | Inventory |
| **R** | Restart after death |
| **F11** | Fullscreen |

---

## ⚠️ For A3 Judges

The AI fabrication system is **live and ready to use** — no setup required. The Gemini API key is pre-configured on the backend server.

**To confirm the API works:** Open the fabrication terminal (press **F** in-game), type anything (e.g. `laser sword`), and press Enter. You should see an AI-generated item appear within 2-5 seconds. If the backend is cold-starting, the first request may take up to 30 seconds.

**Please keep usage under ~50 fabrication requests during your review.** The API credits are on my personal account. Most playthroughs use 5-10 fabrications, so 50 is more than enough to fully experience the game.

If fabrication returns an error, wait a minute and try again — it likely means a temporary rate limit was hit.

Thank you for playing! 🚀

---

## 🚀 Quick Start for Local Development

```bash
npm install
npm start
```

Open **http://localhost:3000**

---

## 📦 Item Types

| Type | Behavior | Example |
|------|----------|---------|
| **Weapon** | Equip, use with SPACE | pistol, sword, laser rifle |
| **Armor** | Permanent DEF boost | shield, titanium armor |
| **Ally** | Hunts enemies autonomously | combat drone, robot guard |
| **Pet** | Follows player, non-combat | cat, dog, space hamster |
| **Vehicle** | Speed boost | hoverboard, jetpack |
| **Consumable** | Instant HP restore | potion, medkit |
| **Tool** | Utility stat boosts | repair kit, scanner |
| **Trap** | Auto-damages nearby enemies | turret, landmine |
| **Hazard** | Spawns hostile (dangerous requests) | nuclear bomb, black hole |

---

## 🎨 Technical Stack

- **Canvas rendering** — custom sprite system, particle effects, lerped camera
- **Node.js / Express** — proxies Gemini API requests on Render
- **BSP-inspired dungeon gen** — organic room shapes, blob rooms
- **Real-time game loop** — independent player/enemy timers

---

## 📝 License

MIT

---

**Made for the A3 hackathon, web game category** 🚀

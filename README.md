# 🛸 MERIDIAN-7

**An AI-powered sci-fi roguelike where creativity is your weapon**

> *The armory is locked. Communications are down. Your only hope? An experimental AI that can materialize anything you can imagine.*

---


**Trapped on a derelict space station.** The defense AI went rogue. You're unarmed.

But you have access to an **experimental fabrication terminal powered by Google Gemini AI.**

Type `minigun` → **Get a minigun.** Real stats. Real weapon.  
Type `healing cat` → **Get a pet that follows you.**  
Type `200HP potion` → **Get exactly 200 HP.**  
Type `dragon fire` → **The AI decides what that means.**

**No predefined items. No loot tables. Just an AI that interprets your creativity and generates balanced game content in real-time.**

Every playthrough is different. Every idea is valid. The AI is the game.

**Try to break it.** 🎯

---

## 🤖 **The Core Innovation: AI-Powered Fabrication**

**This is not a traditional roguelike.** There's no predefined item list. No weapon tier system. No loot tables.

Instead, you have **Google Gemini AI** as your fabrication system. Type ***anything*** — a minigun, a cat, a 200HP healing potion, dragon fire, a nuclear weapon — and the AI:
1. **Interprets your request** in real-time
2. **Decides what it becomes** (weapon, ally, pet, trap, or malfunction)
3. **Generates complete stats** (damage, defense, HP, speed)
4. **Materializes it** in the game world with a unique color and description

**Every playthrough is unique.** The AI handles thousands of possible inputs, from conventional weapons to absurd creative requests. This is emergent gameplay powered by generative AI.

- Want a **cat**? You get a pet companion.
- Want a **minigun**? You get a devastating weapon.
- Want a **200HP healing potion**? You get exactly 200 HP restored.
- Want **dragon fire**? The AI might give you a flamethrower ally or interpret it creatively.
- Want **pizza**? The AI decides if it's food (consumable) or gets creative!
- Want a **1000HP boss ally**? You can fabricate insanely powerful units with massive health pools to fight for you, and also fight **YOU**!

The AI respects **numbers, adjectives, and creative requests** — it's designed to handle unconventional inputs gracefully.

**Pro tip:** You can fabricate hard bosses as ALLIES by requesting high HP values: `"1000HP robot guardian"`, `"legendary dragon 800HP"`, `"titan mech 1500HP"` — the AI will generate them with those exact stats!

---

## 🎯  AI system testing**

**The AI can generate literally anything (with some constraints, of course), in the context of the game.** Here are examples that demonstrate different aspects:

### **Intelligence Testing:**
- `200HP mega potion` → AI gives exactly 200 HP
- `weak pistol` → Low damage (3-6)
- `legendary minigun` → High damage (40-60)
- `titanium armor` → High defense (25-35)
- `1000HP titan ally` → AI creates a boss-tier ally with 1000 HP
- `legendary dragon 800HP 50 damage` → AI respects all specified stats

### **Creative Interpretation:**
- `cat` → Spawns as pet companion (non-combat)
- `combat cat` → Spawns as ally with attacks
- `dragon` → AI decides: weapon? ally? hazard?
- `healing pizza` → Consumable with HP restore
- `nuclear bomb` → Probably spawns as hazard (hostile!)

### **Edge Cases:**
- `time machine` → What will the AI make of this?
- `antimatter` → Dangerous request → hazard?
- `rubber duck` → Harmless item → probably consumable
- `disco ball` → Completely absurd → AI adapts
- `friendly nuke` → Contradiction → AI resolves it

### **Conventional Weapons (Boring but Effective):**
- `minigun`, `bazooka`, `plasma rifle`
- `legendary sword`, `katana`, `lightsaber`
- `shotgun`, `sniper rifle`, `flamethrower`

### **Vehicles & Speed:**
- `hoverboard`, `jetpack`, `motorcycle`
- `teleporter`, `speed boost`, `rocket boots`

### **Utilities & Support:**
- `repair kit`, `shield generator`, `healing drone`
- `turret`, `landmine`, `laser grid` (traps)

**TL;DR:** Type anything and see how the AI interprets it. That's the entire game.

The AI will interpret your request and categorize it into one of these types:
- **Weapon** (guns, swords, lasers, unconventional)
- **Armor** (shields, suits, force fields)
- **Ally** (combat robots, drones, weaponized creatures)
- **Pet** (non-combat companions like cats, dogs, space creatures)
- **Vehicle** (speed boosts)
- **Consumable** (one-time HP restoration)
- **Tool** (utility items with stat boosts)
- **Trap** (stationary hazards that auto-damage enemies)
- **Hazard** (if you request something too dangerous/absurd, it spawns hostile!)

---

## 🎵 Features

### AI-Powered Fabrication
- **Google Gemini 2.0 Flash** generates items based on any text description
- Respects numbers: "500HP potion" gives exactly 500 HP
- Respects adjectives: "weak pistol" vs "legendary cannon"
- Handles creative/unconventional requests intelligently
- Dynamic emoji icons generated per item

### Sound System
- Procedural sound effects using Web Audio API
- Attack sounds (melee swing, ranged shoot)
- Hit impacts, fabrication complete, pickups
- Death sounds, footsteps, alerts

### Advanced Gameplay
- **Real-time combat** — continuous movement, independent enemy AI
- **8 item types** with unique behaviors
- **Multiple enemy types** — drones, crawlers, sentinels, aliens, each with different sprites
- **Pets follow you** — non-combat companions
- **Allies hunt enemies** — autonomous combat units
- **Traps auto-damage** enemies in range
- **Speed boosts** from vehicles
- **Organic map generation** — circular rooms, irregular blobs, not just rectangles

### Visual Polish
- **1920x1080 canvas** with smooth camera lerp
- **Detailed pixel sprites** for player, enemies, allies
- **Particle effects** — fabrication materialization, hit impacts, projectile trails
- **Damage numbers** that float upward
- **Screen shake** on damage
- **Minimap** with enemy/ally/pet/trap indicators
- **Tooltips** on hover showing full stats
- **Fabrication alert banners** that explain what was created
- **Dynamic emojis** for generated items

---

## 🕹️ Controls

| Key | Action |
|-----|--------|
| **W A S D** or **Arrows** | Move |
| **F** | Open Fabrication Terminal |
| **SPACE** | Use equipped weapon (hold to auto-fire) |
| **I** | Open inventory |
| **R** | Restart after death |
| **F11** | Fullscreen |

---

## 🔑 **AI Setup (Optional but Recommended)**

### **About the Free API Key:**

This game uses **Google Gemini 2.0 Flash** to power the fabrication system. You have two options:

#### **Option 1: Use Your Own Free Key** (Recommended for hackathon judges)
- **100% FREE** — Google AI Studio provides a generous free tier
- **No credit card required**
- **~20 fabrications per day** on free tier (plenty for testing!)
- **Takes 60 seconds to get**

**How to get your free key:**
1. Visit [aistudio.google.com](https://aistudio.google.com)
2. Sign in with Google
3. Click "Get API key"
4. Copy the key (starts with `AIza...`)

#### **Option 2: Use Shared Demo Key**
- A limited demo key is included for quick testing
- May hit rate limits if many people test simultaneously

### **⚠️ AI Transparency Disclaimer**

This game uses **Google Gemini AI (Gemini 2.0 Flash)** for procedural content generation:
- **What the AI does**: Interprets text descriptions and generates game items with stats
- **Why we use it**: To enable infinite creative possibilities — you can fabricate literally anything
- **Data sent**: Only your item descriptions (e.g., "minigun", "healing potion") are sent to Google's API
- **Privacy**: No personal data is collected or stored
- **Cost**: ~$0.0001 per fabrication (~0.01 cents). Free tier covers hundreds of items.


---

## 🚀 Quick Start

```bash
npm install
npm start
```

Open **http://localhost:3000**

1. Enter your free API key (or skip to use demo key)
2. Press `F` to open the Fabrication Terminal
3. Type anything: `minigun`, `legendary sword`, `healing cat`, `200HP potion`
4. Press Enter and watch the AI generate it in real-time
5. Pick it up and use it!

---

## 🎨 Technical Highlights

- **Canvas rendering** — custom sprite system, particle effects, lerped movement
- **Node.js/Express backend** — proxies Gemini API requests
- **Real-time game loop** — independent player/enemy timers
- **Intelligent AI prompting** — detailed instructions for consistent, creative generation
- **Web Audio API** — procedural sound synthesis
- **Organic procedural generation** — BSP-inspired dungeon with varied room shapes
- **State management** — clean separation of game states (playing, fabricating, inventory, dead, won)

---

## 📦 Item Type Breakdown

| Type | Description | Examples |
|------|-------------|----------|
| **Weapon** | Equip to inventory, use with SPACE | pistol, sword, minigun, laser rifle |
| **Armor** | Permanent DEF boost | shield, titanium armor, force field |
| **Ally** | Autonomous combat unit, hunts enemies | robot, combat drone, guard dog |
| **Pet** | Follows player, non-combat | cat, dog, space hamster |
| **Vehicle** | Speed boost (instant use) | hoverboard, jetpack, motorcycle |
| **Consumable** | Instant HP restore on pickup | potion, medkit, pizza |
| **Tool** | Utility bonuses to stats | repair kit, scanner, hacking tool |
| **Trap** | Stationary, auto-damages nearby enemies | landmine, turret, laser grid |
| **Hazard** | AI malfunction — spawns HOSTILE | if you request nuclear bomb, black hole, etc. |

---

## 🐛 Known Quirks

- AI might interpret requests differently than expected — that's part of the fun!
- Some emoji might not render on all systems (falls back to symbols)
- Very long item names may truncate in inventory
- Free Gemini tier: 20 fabrications per day (or use your own key for more)

*Try fabricating: dragon, time machine, rubber duck, antimatter, disco ball, or literally anything else.*

**Made for the A3 web design hackathon - game category** 🚀
---

## 📝 License

MIT — feel free to fork, hack, remix!

---



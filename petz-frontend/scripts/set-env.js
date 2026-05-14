#!/usr/bin/env node
/**
 * Injects environment variables into Angular environment files.
 *
 * Usage:
 *   node scripts/set-env.js          → patches environment.local.ts (local dev)
 *   node scripts/set-env.js --prod   → patches environment.prod.ts  (Netlify CI)
 *
 * Local : create petz-frontend/.env with GEMINI_KEY=your_key
 * Netlify: add GEMINI_KEY in Site Settings → Environment Variables
 *
 * The environment files contain 'GEMINI_KEY' as a placeholder token.
 * This script replaces that token with the actual key value.
 */

const fs   = require('fs');
const path = require('path');

// ── Load .env file for local dev ─────────────────────────────────────────────
const envFilePath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFilePath)) {
  fs.readFileSync(envFilePath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  });
}

// ── Resolve values ────────────────────────────────────────────────────────────
const isProd    = process.argv.includes('--prod');
const geminiKey = process.env.GEMINI_KEY || '';

if (!geminiKey) {
  console.warn('⚠️  GEMINI_KEY is not set — chatbot will not work.');
}

// ── Target file ───────────────────────────────────────────────────────────────
// Local : copy environment.ts → environment.local.ts, then replace token
// Prod  : replace token directly in environment.prod.ts
const envDir  = path.join(__dirname, '..', 'src', 'environments');
const srcFile = isProd ? 'environment.prod.ts' : 'environment.ts';
const dstFile = isProd ? 'environment.prod.ts' : 'environment.local.ts';

let content = fs.readFileSync(path.join(envDir, srcFile), 'utf8');
content = content.replace("'GEMINI_KEY'", `'${geminiKey}'`);

fs.writeFileSync(path.join(envDir, dstFile), content);
console.log(`✅  Injected GEMINI_KEY into src/environments/${dstFile}`);

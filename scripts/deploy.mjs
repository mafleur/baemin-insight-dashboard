#!/usr/bin/env node
/**
 * deploy.mjs — automated deploy helper
 * Usage: GITHUB_PAT=xxx GITHUB_USER=xxx VERCEL_TOKEN=xxx GEMINI_API_KEY=xxx node scripts/deploy.mjs
 * Never hardcode secrets in this file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_USER = process.env.GITHUB_USER;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;   // never hardcode — read from env only
const REPO_NAME = 'baemin-insight-dashboard';

if (!GITHUB_PAT || !GITHUB_USER || !VERCEL_TOKEN || !GEMINI_KEY) {
    console.error('Required env vars: GITHUB_PAT, GITHUB_USER, VERCEL_TOKEN, GEMINI_API_KEY');
    process.exit(1);
}

console.log('Use deploy-vercel-direct.mjs for Vercel deployment.');
console.log('This script is a placeholder — secrets come from environment only.');

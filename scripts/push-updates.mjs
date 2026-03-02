#!/usr/bin/env node
/**
 * push-updates.mjs — pushes specific updated files to GitHub via Contents API
 * Usage: GITHUB_PAT=xxx GITHUB_USER=xxx node scripts/push-updates.mjs file1 file2 ...
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_USER = process.env.GITHUB_USER;
const REPO = `${GITHUB_USER}/baemin-insight-dashboard`;

const GH_H = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
};

// Files to update (relative to project root)
const FILES = process.argv.slice(2);
if (!FILES.length) { console.error('Specify files to push'); process.exit(1); }

for (const relPath of FILES) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) { console.log(`⚠ Skipping (not found): ${relPath}`); continue; }

    const content = fs.readFileSync(fullPath).toString('base64');

    // Get current SHA (needed for updates)
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${relPath}`, { headers: GH_H });
    const getBody = await getRes.json().catch(() => ({}));
    const sha = getBody.sha;   // undefined for new files

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${relPath}`, {
        method: 'PUT',
        headers: GH_H,
        body: JSON.stringify({
            message: `security: remove hardcoded secrets from ${relPath}`,
            content,
            ...(sha ? { sha } : {}),
        }),
    });

    const status = res.status === 200 || res.status === 201 ? '✅' : '❌';
    console.log(`${status} ${relPath} (${res.status})`);
}

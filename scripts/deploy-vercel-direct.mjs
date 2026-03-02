#!/usr/bin/env node
/**
 * deploy-vercel-direct.mjs
 * Usage: GITHUB_PAT=xxx GITHUB_USER=xxx VERCEL_TOKEN=xxx GEMINI_API_KEY=xxx node scripts/deploy-vercel-direct.mjs
 * Never hardcode secrets in this file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_PAT = process.env.GITHUB_PAT;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;  // never hardcode — read from env only
const REPO_FULL = `${GITHUB_USER}/baemin-insight-dashboard`;

if (!VERCEL_TOKEN || !GEMINI_KEY) {
    console.error('Required: GITHUB_PAT, GITHUB_USER, VERCEL_TOKEN, GEMINI_API_KEY');
    process.exit(1);
}

const VC_H = { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' };

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'dist-ssr', '.git']);
const IGNORE_FILES = new Set(['scripts/deploy.mjs', 'scripts/deploy-vercel-direct.mjs', 'scripts/set-gh-secret.mjs']);

function collectFiles(dir, base = '') {
    const out = [];
    for (const entry of fs.readdirSync(dir)) {
        if (IGNORE_DIRS.has(entry)) continue;
        const full = path.join(dir, entry);
        const rel = base ? `${base}/${entry}` : entry;
        if (fs.statSync(full).isDirectory()) { out.push(...collectFiles(full, rel)); }
        else if (!IGNORE_FILES.has(rel)) { out.push({ path: rel, fullPath: full }); }
    }
    return out;
}

async function vcFetch(p, opts = {}) {
    const res = await fetch(`https://api.vercel.com${p}`, { ...opts, headers: { ...VC_H, ...opts.headers } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function main() {
    console.log('1️⃣  Vercel에 파일 업로드 중...');
    const files = collectFiles(ROOT);
    const fileMap = [];

    for (const f of files) {
        const content = fs.readFileSync(f.fullPath);
        const sha1 = createHash('sha1').update(content).digest('hex');
        const uploadRes = await fetch(`https://api.vercel.com/v2/files`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${VERCEL_TOKEN}`,
                'Content-Type': 'application/octet-stream',
                'x-vercel-digest': sha1,
                'Content-Length': String(content.length),
            },
            body: content,
        });
        if (uploadRes.status !== 200 && uploadRes.status !== 201 && uploadRes.status !== 409) {
            console.log(`  ⚠  ${f.path} upload: ${uploadRes.status}`);
        }
        fileMap.push({ file: f.path, sha: sha1 });
        process.stdout.write('.');
    }
    console.log(`\n   ✅ ${fileMap.length}개 파일 업로드 완료`);

    console.log('2️⃣  Vercel 프로젝트 확인...');
    let projectId = null;
    const { body: existProj } = await vcFetch('/v9/projects/baemin-insight-dashboard');
    if (existProj.id) {
        projectId = existProj.id;
        console.log(`   ℹ️  기존 프로젝트 사용: ${projectId}`);
    } else {
        const { status, body } = await vcFetch('/v10/projects', {
            method: 'POST',
            body: JSON.stringify({ name: 'baemin-insight-dashboard', framework: 'vite' }),
        });
        if (status === 200 || status === 201) { projectId = body.id; console.log(`   ✅ 프로젝트 생성`); }
        else throw new Error(`프로젝트 생성 실패 (${status}): ${JSON.stringify(body)}`);
    }

    console.log('3️⃣  환경변수 설정...');
    // NOTE: GITHUB_TOKEN is NOT set as VITE_ here — it stays server-side only
    const envVars = [
        { key: 'VITE_GEMINI_API_KEY', value: GEMINI_KEY, target: ['production', 'preview', 'development'] },
        { key: 'GITHUB_TOKEN', value: GITHUB_PAT || '', target: ['production', 'preview', 'development'] },
        { key: 'VITE_GITHUB_REPO', value: REPO_FULL, target: ['production', 'preview', 'development'] },
    ];
    for (const ev of envVars) {
        const { body: envList } = await vcFetch(`/v9/projects/${projectId}/env`);
        const existing = (envList.envs || []).find(e => e.key === ev.key);
        if (existing) await vcFetch(`/v9/projects/${projectId}/env/${existing.id}`, { method: 'DELETE' });
        const { status } = await vcFetch(`/v10/projects/${projectId}/env`, {
            method: 'POST',
            body: JSON.stringify({ key: ev.key, value: ev.value, type: 'encrypted', target: ev.target }),
        });
        console.log(`   ${status === 200 || status === 201 ? '✅' : '❌'} ${ev.key}`);
    }

    console.log('4️⃣  배포 트리거...');
    const { status, body: dep } = await vcFetch('/v13/deployments', {
        method: 'POST',
        body: JSON.stringify({
            name: 'baemin-insight-dashboard', project: projectId, target: 'production', files: fileMap,
            projectSettings: { framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist', installCommand: 'npm install' },
        }),
    });
    if (status === 200 || status === 201) {
        console.log(`\n🎉 배포 성공! URL: https://${dep.alias?.[0] || dep.url}`);
    } else {
        console.log(`❌ 배포 실패 (${status}): ${JSON.stringify(dep)}`);
    }
}

main().catch(err => { console.error(err.message); process.exit(1); });

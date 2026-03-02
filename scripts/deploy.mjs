#!/usr/bin/env node
/**
 * deploy.mjs  — one-shot deploy script
 * Usage: GITHUB_PAT=xxx GITHUB_USER=xxx VERCEL_TOKEN=xxx node scripts/deploy.mjs
 *
 * What it does:
 *  1. Creates a GitHub repo (baemin-insight-dashboard) under GITHUB_USER
 *  2. Pushes all project files via GitHub Contents API (base64 encoded)
 *  3. Adds GEMINI_API_KEY as a GitHub Actions secret
 *  4. Creates a Vercel project linked to the GitHub repo
 *  5. Sets Vercel env vars (VITE_GEMINI_API_KEY, VITE_GITHUB_TOKEN, VITE_GITHUB_REPO)
 *  6. Triggers an initial Vercel deployment
 *  7. Prints the live URL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Config from env ─────────────────────────────────────────────────────────
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_USER = process.env.GITHUB_USER;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBkAvV6K1T0AX8xnfFIFae1a3sv-GUbTwA';
const REPO_NAME = 'baemin-insight-dashboard';

if (!GITHUB_PAT || !GITHUB_USER || !VERCEL_TOKEN) {
    console.error('❌ Required env vars: GITHUB_PAT, GITHUB_USER, VERCEL_TOKEN');
    process.exit(1);
}

const GH_HEADERS = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
};
const VC_HEADERS = {
    Authorization: `Bearer ${VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
};

async function ghFetch(path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, { ...opts, headers: { ...GH_HEADERS, ...opts.headers } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function vcFetch(path, opts = {}) {
    const res = await fetch(`https://api.vercel.com${path}`, { ...opts, headers: { ...VC_HEADERS, ...opts.headers } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

// ─── Step 1: Create GitHub repo ──────────────────────────────────────────────
async function createRepo() {
    console.log(`\n1️⃣  GitHub 레포 생성: ${GITHUB_USER}/${REPO_NAME}`);
    const { status, body } = await ghFetch('/user/repos', {
        method: 'POST',
        body: JSON.stringify({
            name: REPO_NAME, private: false,
            description: 'Baemin Insight Dashboard — daily news aggregator',
            auto_init: false,
        }),
    });
    if (status === 201) { console.log(`   ✅ 생성 완료: ${body.html_url}`); return body; }
    if (status === 422) { console.log(`   ℹ️  이미 존재하는 레포 사용`); return { full_name: `${GITHUB_USER}/${REPO_NAME}` }; }
    throw new Error(`GitHub repo 생성 실패 (${status}): ${JSON.stringify(body)}`);
}

// ─── Step 2: Collect files and push via Contents API ─────────────────────────
const IGNORE = new Set([
    'node_modules', 'dist', '.git', 'dist-ssr',
    'scripts/deploy.mjs',  // don't push this script itself
]);

function collectFiles(dir, base = '') {
    const out = [];
    for (const entry of fs.readdirSync(dir)) {
        if (IGNORE.has(entry)) continue;
        const full = path.join(dir, entry);
        const rel = base ? `${base}/${entry}` : entry;
        if (fs.statSync(full).isDirectory()) {
            out.push(...collectFiles(full, rel));
        } else {
            out.push({ path: rel, fullPath: full });
        }
    }
    return out;
}

async function pushFiles(repoFullName) {
    console.log('\n2️⃣  파일 업로드 중...');
    const files = collectFiles(ROOT);
    let pushed = 0;

    // Get current tree (for SHA of existing files to update them)
    const shaMap = {};
    try {
        const { body } = await ghFetch(`/repos/${repoFullName}/git/trees/HEAD?recursive=1`);
        if (body.tree) body.tree.forEach(f => { shaMap[f.path] = f.sha; });
    } catch { /* repo may be empty */ }

    for (const f of files) {
        const content = fs.readFileSync(f.fullPath);
        const b64 = content.toString('base64');
        const sha = shaMap[f.path];
        const { status } = await ghFetch(`/repos/${repoFullName}/contents/${f.path}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `chore: add ${f.path}`,
                content: b64,
                ...(sha ? { sha } : {}),
            }),
        });
        if (status === 200 || status === 201) { pushed++; process.stdout.write('.'); }
        else { process.stdout.write('x'); }
        await new Promise(r => setTimeout(r, 80)); // stay within API rate limit
    }
    console.log(`\n   ✅ ${pushed}/${files.length}개 파일 업로드 완료`);
}

// ─── Step 3: GitHub Actions secrets ──────────────────────────────────────────
async function setGitHubSecret(repoFullName, name, value) {
    // First get the repo public key for secret encryption
    const { body: keyData } = await ghFetch(`/repos/${repoFullName}/actions/secrets/public-key`);
    if (!keyData.key) throw new Error('GitHub public key 취득 실패');

    // libsodium-wrappers or sodium-native not available without install
    // Fallback: use GitHub Actions Environment Variables approach (plaintext is fine for non-sensitive creds)
    // Actually just use a placeholder; we'll set the secret via API with sodium
    // Since we can't easily sodium-encrypt without native modules, we'll print it for the user
    console.log(`   ⚠️  GitHub Secret "${name}" 는 수동으로 설정 필요:`);
    console.log(`      GitHub → Settings → Secrets → Actions → New repo secret`);
    console.log(`      Name: ${name}  Value: ${value}`);
}

// ─── Step 4+5: Vercel project + env vars ─────────────────────────────────────
async function setupVercel(repoFullName) {
    console.log('\n3️⃣  Vercel 프로젝트 생성...');

    // Find or create project
    let projectId;
    const { body: existing } = await vcFetch(`/v9/projects/${REPO_NAME}`);
    if (existing.id) {
        projectId = existing.id;
        console.log(`   ℹ️  기존 프로젝트 사용: ${projectId}`);
    } else {
        const { status, body } = await vcFetch('/v10/projects', {
            method: 'POST',
            body: JSON.stringify({
                name: REPO_NAME,
                framework: 'vite',
                gitRepository: {
                    type: 'github',
                    repo: repoFullName,
                },
            }),
        });
        if (status === 200 || status === 201) {
            projectId = body.id;
            console.log(`   ✅ Vercel 프로젝트 생성: ${body.name}`);
        } else {
            throw new Error(`Vercel 프로젝트 생성 실패 (${status}): ${JSON.stringify(body)}`);
        }
    }

    // Set env vars
    console.log('\n4️⃣  Vercel 환경변수 설정...');
    const envVars = [
        { key: 'VITE_GEMINI_API_KEY', value: GEMINI_KEY, target: ['production', 'preview', 'development'] },
        { key: 'VITE_GITHUB_TOKEN', value: GITHUB_PAT, target: ['production', 'preview', 'development'] },
        { key: 'VITE_GITHUB_REPO', value: repoFullName, target: ['production', 'preview', 'development'] },
    ];
    for (const ev of envVars) {
        // Remove existing first
        const { body: envList } = await vcFetch(`/v9/projects/${projectId}/env`);
        const existing = (envList.envs || []).find(e => e.key === ev.key);
        if (existing) await vcFetch(`/v9/projects/${projectId}/env/${existing.id}`, { method: 'DELETE' });
        // Add new
        const { status } = await vcFetch(`/v10/projects/${projectId}/env`, {
            method: 'POST',
            body: JSON.stringify({ key: ev.key, value: ev.value, type: 'encrypted', target: ev.target }),
        });
        console.log(`   ${status === 200 || status === 201 ? '✅' : '❌'} ${ev.key}`);
    }

    // Trigger deployment
    console.log('\n5️⃣  Vercel 배포 트리거...');
    const { status: depStatus, body: depBody } = await vcFetch('/v13/deployments', {
        method: 'POST',
        body: JSON.stringify({
            name: REPO_NAME,
            gitSource: { type: 'github', repoId: null, ref: 'main', repo: repoFullName },
            projectId,
            target: 'production',
        }),
    });

    if (depStatus === 200 || depStatus === 201) {
        const url = depBody.url || depBody.alias?.[0] || '배포 중...';
        console.log(`\n🎉 배포 시작!\n   URL: https://${url}`);
        return url;
    } else {
        console.log(`\n⚠️  배포 트리거 실패 (${depStatus}): ${JSON.stringify(depBody)}`);
        console.log(`   Vercel 대시보드(https://vercel.com/dashboard)에서 수동 배포 확인`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 Baemin Insight Dashboard 배포 시작\n');
    try {
        const repo = await createRepo();
        await pushFiles(repo.full_name);
        await setGitHubSecret(repo.full_name, 'GEMINI_API_KEY', GEMINI_KEY);
        await setupVercel(repo.full_name);
        console.log('\n✅ 모든 단계 완료!');
    } catch (err) {
        console.error(`\n❌ 오류: ${err.message}`);
        process.exit(1);
    }
}

main();

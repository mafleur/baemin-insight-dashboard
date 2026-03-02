#!/usr/bin/env node
/**
 * Set a GitHub Actions secret using the GitHub REST API.
 * Requires: tweetsodium (pure-JS libsodium for secret encryption)
 */

const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO;
const SECRET_NAME = process.env.SECRET_NAME;
const SECRET_VAL = process.env.SECRET_VAL;

if (!GITHUB_PAT || !GITHUB_REPO || !SECRET_NAME || !SECRET_VAL) {
    console.error('Required: GITHUB_PAT, GITHUB_REPO, SECRET_NAME, SECRET_VAL');
    process.exit(1);
}

const GH_H = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
};

async function main() {
    // 1. Get repo public key
    const keyRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/secrets/public-key`, { headers: GH_H });
    const keyData = await keyRes.json();
    if (!keyData.key_id) throw new Error(`Cannot get public key: ${JSON.stringify(keyData)}`);

    // 2. Encrypt with libsodium via node-forge or simple XOR for now
    //    We'll use a Base64-encoded plaintext trick: GitHub API actually does accept
    //    sodiumEncryptedValue, but without native sodium let's use tweetsodium
    //    dynamically installed as a local dep
    const { execSync } = await import('child_process');

    // Install tweetsodium locally for this quick operation
    try { execSync('npm list tweetsodium --prefix /tmp', { stdio: 'ignore' }); }
    catch { execSync('npm install tweetsodium --prefix /tmp', { stdio: 'inherit' }); }

    const { default: sodium } = await import('/tmp/node_modules/tweetsodium/index.js');

    const messageBytes = Buffer.from(SECRET_VAL, 'utf8');
    const keyBytes = Buffer.from(keyData.key, 'base64');
    const encrypted = Buffer.from(sodium.seal(messageBytes, keyBytes)).toString('base64');

    // 3. PUT secret
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/secrets/${SECRET_NAME}`, {
        method: 'PUT',
        headers: GH_H,
        body: JSON.stringify({ encrypted_value: encrypted, key_id: keyData.key_id }),
    });

    if (res.status === 201 || res.status === 204) {
        console.log(`✅ Secret "${SECRET_NAME}" 설정 완료`);
    } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Secret 설정 실패 (${res.status}): ${JSON.stringify(err)}`);
    }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });

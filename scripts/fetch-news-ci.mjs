/**
 * fetch-news-ci.mjs — CI-safe version for GitHub Actions
 *
 * Identical to fetch-news.mjs but:
 *  - NO Puppeteer (Chromium blocked in CI without extra deps)
 *  - Falls back gracefully for any site that needs a browser
 *  - Uses only: RSS/Atom, cheerio, fetch
 */

import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { GoogleDecoder } from 'google-news-url-decoder';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../public/data.json');

const MAX_DAYS = 10;
const MAX_PER_BLOG = 3;
const MAX_PER_AGGREGATOR = 10;
const SIMILARITY_THRESH = 0.25;

// ─── RSS Parser ───────────────────────────────────────────────────────────────
const parser = new Parser({
    customFields: {
        item: ['media:content', 'media:thumbnail', 'enclosure', 'content:encoded'],
    },
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
});

// ─── Category relevance gate ─────────────────────────────────────────────────
const DELIVERY_MATCH = [
    '배달', '배민', '쿠팡이츠', '요기요', '퀵커머스', '음식배달', '배달앱', '라이더',
    'doordash', 'uber eats', 'ubereats', 'deliveroo', 'instacart', 'zomato', 'grubhub', 'gopuff',
    'meituan', 'grab food', 'foodpanda', 'rappi', 'getir', 'gorillas', 'getgo',
    'food delivery', 'quick commerce', 'last-mile', 'last mile', '美团', '饿了么',
    'delivery platform', 'delivery service', 'delivery app',
    '이츠', '배달 플랫폼', '딜리버리', 'deliveryhero', 'delivery hero',
];
const AI_MATCH = [
    'openai', 'chatgpt', 'gpt-4', 'gpt4', 'claude', 'anthropic', 'gemini', 'google ai',
    'llm', 'large language', 'generative ai', '생성형 ai', 'ai 에이전트', 'ai agent',
    'artificial intelligence', 'machine learning', 'deep learning', '인공지능',
    'ai 모델', 'ai 기능', 'ai 서비스', 'ai 플랫폼', 'ai 출시',
    'naver ai', '네이버 ai', '카카오 ai', 'hyperclova', 'clova',
    'foundation model', 'transformer', 'diffusion model',
    'midjourney', 'stable diffusion', 'llama', 'mistral', 'meta ai',
    '생성 ai', 'ai 도입', 'ai 적용', 'ai 자동화',
];
const IT_MATCH = [
    'tech', 'startup', '스타트업', 'ipo', '상장', 'fintech', 'ecommerce', 'e-commerce',
    'app update', 'platform', 'software', 'mobile', 'saas', 'cloud', 'api',
    'hacker news', '긱뉴스', 'geek', 'developer', '개발자',
    'kubernetes', 'docker', 'microservice', 'data engineering',
];

function categorize(title, defaultCategory, opts = {}) {
    const t = (title || '').toLowerCase();
    const hasDelivery = DELIVERY_MATCH.some(k => t.includes(k));
    const hasAI = AI_MATCH.some(k => t.includes(k));
    const hasIT = IT_MATCH.some(k => t.includes(k));
    if (hasDelivery) return 'Delivery';
    if (hasAI) return 'AI';
    if (opts.isAIBlog) return 'AI';
    if (hasIT || defaultCategory === 'IT') return 'IT';
    return null; // rejected
}

// ─── Trusted publishers ───────────────────────────────────────────────────────
const TRUSTED = new Set([
    '조선일보', '중앙일보', '동아일보', '한겨레', '경향신문', '한국경제', '매일경제',
    '서울경제', '이데일리', '연합뉴스', '뉴스1', '뉴시스', '아시아경제', '머니투데이',
    'SBS', 'KBS', 'MBC', 'JTBC', 'YTN', 'MBN',
    '전자신문', 'ZDNet Korea', '블로터',
    'Reuters', 'Bloomberg', 'Wall Street Journal', 'Financial Times',
    'New York Times', 'TechCrunch', 'The Verge', 'Wired', 'Forbes',
    'Business Insider', 'CNBC', 'BBC', 'The Guardian', 'Nikkei',
]);
function isTrusted(item) {
    const src = item.source?._ || item.source || '';
    const tail = (item.title || '').split(' - ').pop() || '';
    if (!src && !tail) return true;
    for (const p of TRUSTED) { if (src.includes(p) || tail.includes(p)) return true; }
    return false;
}

// ─── Deduplication ────────────────────────────────────────────────────────────
function norm(t) {
    return t.toLowerCase().replace(/[^\w가-힣]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}
function isDup(title, seen) {
    const words = new Set(norm(title));
    for (const s of seen) {
        const sw = new Set(norm(s));
        const inter = [...words].filter(w => sw.has(w)).length;
        const union = new Set([...words, ...sw]).size;
        if (union > 0 && inter / union > SIMILARITY_THRESH) return true;
    }
    return false;
}

// ─── Snippet extraction ───────────────────────────────────────────────────────
function extractSnippet(raw, title = '') {
    if (!raw) return '';
    let text = raw
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ').trim();

    const titleNorm = title.replace(/\s+/g, ' ').trim();
    if (titleNorm && text.toLowerCase().startsWith(titleNorm.toLowerCase()))
        text = text.substring(titleNorm.length).replace(/^[\s\-–—:.,]+/, '').trim();

    text = text.replace(/\s*[-–—]\s{0,3}[\w가-힣 .&]{1,40}$/, '').trim();
    if (text.length < 40) return '';

    const titleWords = new Set(norm(titleNorm));
    const textWords = norm(text);
    if (titleWords.size > 0 && textWords.length > 0) {
        const overlap = textWords.filter(w => titleWords.has(w)).length / textWords.length;
        if (overlap > 0.65) return '';
    }

    const sentences = text
        .split(/(?<=[.!?。])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && !s.startsWith('http'));
    const snip = sentences.slice(0, 3).join(' ');
    return snip.length > 40 ? snip : '';
}

// ─── Article factory ──────────────────────────────────────────────────────────
function makeArticle(base, meta) {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        category: meta.category || base.category,
        sourceTitle: meta.sourceTitle || '',
        sourceLabel: meta.sourceLabel || '',
        isGoogleNews: !!meta.isGoogleNews,
        title: base.title,
        link: base.link,
        pubDate: base.pubDate,
        snippet: base.snippet || '',
    };
}

// ─── Feed fetcher (no Puppeteer) ──────────────────────────────────────────────
async function fetchFeedSafe(url) {
    try {
        const feed = await parser.parseURL(url);
        return { feed };
    } catch (e1) {
        // Try with plain fetch
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
                signal: AbortSignal.timeout(12000),
                redirect: 'follow',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (text.includes('<rss') || text.includes('<feed') || text.includes('<atom')) {
                const feed = await parser.parseString(text);
                return { feed };
            }
            return { html: text };
        } catch (e2) {
            return null;
        }
    }
}

// ─── Process RSS feed items ───────────────────────────────────────────────────
function processFeedItems(feed, meta, cutoffDate, existingLinks, cap) {
    const arts = [];
    const seenTitles = [];
    for (const item of (feed.items || [])) {
        if (arts.length >= cap) break;
        if (existingLinks.has(item.link)) continue;
        const pub = new Date(item.isoDate || item.pubDate || Date.now());
        if (pub < cutoffDate) continue;
        const finalCat = categorize(item.title, meta.category, meta);
        if (!finalCat) continue;
        if (isDup(item.title, seenTitles)) continue;
        const raw = item['content:encoded'] || item.content || item.description || '';
        seenTitles.push(item.title);
        existingLinks.add(item.link);
        arts.push(makeArticle(
            { category: finalCat, title: item.title, link: item.link, pubDate: pub.toISOString(), snippet: extractSnippet(raw, item.title) },
            meta
        ));
    }
    return arts;
}

// ─── Google News ──────────────────────────────────────────────────────────────
const GN_QUERIES = [
    { sourceTitle: '한국 배달앱', category: 'Delivery', q: '"쿠팡이츠" OR "요기요" OR "배달의민족" OR "배달앱" OR "퀵커머스" OR "음식배달"', hl: 'ko', gl: 'KR', ceid: 'KR:ko' },
    { sourceTitle: '글로벌 배달', category: 'Delivery', q: '"DoorDash" OR "Uber Eats" OR "Deliveroo" OR "Instacart" OR "Zomato" OR "Grubhub" OR "quick commerce" OR "food delivery"', hl: 'en', gl: 'US', ceid: 'US:en' },
    { sourceTitle: '아시아 배달', category: 'Delivery', q: '"Meituan" OR "美团" OR "Eleme" OR "GoJek" OR "Foodpanda" OR "Rappi" OR "Grab delivery" OR "Baemin"', hl: 'en', gl: 'SG', ceid: 'SG:en' },
    { sourceTitle: 'AI 산업', category: 'AI', q: '"AI 에이전트" OR "생성형 AI" OR "LLM" OR "AI 플랫폼" OR "AI 기능 출시" OR "AI 자동화" OR "OpenAI" OR "Anthropic" OR "Claude" OR "Gemini"', hl: 'ko', gl: 'KR', ceid: 'KR:ko' },
    { sourceTitle: 'AI Tech', category: 'AI', q: '"OpenAI" OR "Anthropic" OR "Claude" OR "Gemini" OR "LLM" OR "AI agent" OR "foundation model" OR "generative AI" OR "AI product launch"', hl: 'en', gl: 'US', ceid: 'US:en' },
];

async function fetchGoogleNews(cutoffDate, existingLinks) {
    const all = [];
    const seenTitles = [];
    const seen = new Set(existingLinks);

    for (const q of GN_QUERIES) {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q.q)}+when:10d&hl=${q.hl}&gl=${q.gl}&ceid=${q.ceid}`;
        process.stdout.write(`  ▶ Google News [${q.sourceTitle}]... `);
        try {
            const result = await fetchFeedSafe(url);
            if (!result?.feed) { console.log('실패'); await new Promise(r => setTimeout(r, 1000)); continue; }
            let n = 0;
            for (const item of result.feed.items) {
                if (n >= MAX_PER_AGGREGATOR) break;
                if (seen.has(item.link)) continue;
                const pub = new Date(item.isoDate || item.pubDate || Date.now());
                if (pub < cutoffDate) continue;
                if (!isTrusted(item)) continue;
                const finalCat = categorize(item.title, q.category, { isAIBlog: false });
                if (!finalCat) continue;
                if (isDup(item.title, seenTitles)) continue;
                const raw = item['content:encoded'] || item.content || item.description || '';
                seenTitles.push(item.title);
                seen.add(item.link);
                all.push(makeArticle(
                    { category: finalCat, title: item.title, link: item.link, pubDate: pub.toISOString(), snippet: extractSnippet(raw, item.title) },
                    { sourceTitle: q.sourceTitle, sourceLabel: 'Google News', isGoogleNews: true }
                ));
                n++;
            }
            console.log(`${n}개`);
        } catch (e) {
            console.log(`실패 (${e.message.substring(0, 50)})`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    // Resolve Google News redirect URLs (no Puppeteer needed — uses protobuf decode)
    if (all.length > 0) {
        process.stdout.write(`  ▶ URL 리다이렉트 추적 (${all.length}개)... `);
        let resolved = 0;
        const decoder = new GoogleDecoder();
        await Promise.all(all.map(async a => {
            if (!a.link.includes('news.google.com/rss/articles/')) return;
            try {
                const decoded = await decoder.decode(a.link);
                if (decoded?.status && decoded.decoded_url) { a.link = decoded.decoded_url; resolved++; }
            } catch { /* ignore */ }
        }));
        console.log(`${resolved}개 URL 변환 완료`);
    }

    // Fetch snippets for articles missing them (plain fetch only, no Puppeteer)
    const noSnippet = all.filter(a => !a.snippet);
    if (noSnippet.length > 0) {
        process.stdout.write(`  ▶ 본문 수집 (${noSnippet.length}개)... `);
        let fetched = 0;
        for (let i = 0; i < noSnippet.length; i += 8) {
            await Promise.all(noSnippet.slice(i, i + 8).map(async a => {
                try {
                    const resp = await fetch(a.link, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
                        signal: AbortSignal.timeout(8000), redirect: 'follow',
                    });
                    if (!resp.ok) return;
                    const $ = cheerio.load(await resp.text());
                    $('nav,header,footer,aside,script,style').remove();
                    const paras = $('article p,[class*="article"] p,main p,.content p')
                        .map((_, el) => $(el).text().trim()).get()
                        .filter(p => p.length > 40 && !p.includes('©') && !p.includes('All rights reserved'));
                    if (paras.length > 0) { a.snippet = paras.slice(0, 3).join(' '); fetched++; }
                } catch { /* skip paywall/timeout */ }
            }));
        }
        console.log(`${fetched}/${noSnippet.length}개 본문 확보`);
    }

    return all;
}

// ─── Static sources (RSS only, no HTML scraping) ──────────────────────────────
const SOURCES = [
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Uber Engineering', url: 'https://www.uber.com/en-US/blog/engineering/rss/' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Delivery Hero Tech', url: 'https://tech.deliveryhero.com/feed/' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Instacart Tech', url: 'https://tech.instacart.com/feed' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Grab Engineering', url: 'https://engineering.grab.com/feed.xml' },
    { category: 'AI', sourceTitle: 'AI Research', sourceLabel: 'OpenAI Blog', url: 'https://openai.com/news/rss.xml', isAIBlog: true },
    { category: 'IT', sourceTitle: 'Tech', sourceLabel: 'Hacker News', url: 'https://news.ycombinator.com/rss', filterHN: true },
    { category: 'IT', sourceTitle: 'Tech', sourceLabel: 'GeekNews', url: 'https://news.hada.io/rss' },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 뉴스 수집 시작 (CI 모드 — Puppeteer 없음)\n');

    let existingData = { articles: [] };
    if (fs.existsSync(DATA_FILE)) {
        try { existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
        catch { console.warn('⚠️  data.json 파싱 실패.'); }
    }
    const existingLinks = new Set(existingData.articles.map(a => a.link));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_DAYS);

    let newArticles = [];

    console.log('━━━ PHASE 1: 기사 수집 ━━━');
    newArticles.push(...await fetchGoogleNews(cutoffDate, existingLinks));

    for (const source of SOURCES) {
        process.stdout.write(`  ▶ ${source.sourceLabel}... `);
        const result = await fetchFeedSafe(source.url);
        if (!result?.feed) { console.log('실패'); continue; }
        const cap = source.filterHN ? MAX_PER_AGGREGATOR : MAX_PER_BLOG;
        const meta = { category: source.category, sourceTitle: source.sourceTitle, sourceLabel: source.sourceLabel, isAIBlog: source.isAIBlog };
        const arts = processFeedItems(result.feed, meta, cutoffDate, existingLinks, cap);
        console.log(`${arts.length}개`);
        newArticles.push(...arts);
    }

    console.log('\n━━━ PHASE 2: 저장 ━━━');
    let all = [...newArticles, ...existingData.articles];
    all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const validCutoff = new Date();
    validCutoff.setDate(validCutoff.getDate() - MAX_DAYS);
    all = all.filter(a => new Date(a.pubDate) >= validCutoff).slice(0, 200);

    const actualNewCount = Math.max(0, all.length - existingData.articles.filter(a => new Date(a.pubDate) >= validCutoff).length);

    fs.writeFileSync(DATA_FILE, JSON.stringify({
        metadata: {
            lastUpdated: new Date().toISOString(),
            totalArticles: all.length,
            newArticlesCount: actualNewCount,
            runId: Date.now().toString(),
        },
        articles: all,
    }, null, 2), 'utf8');

    console.log(`✅ ${all.length}개 저장 완료. (신규: ${actualNewCount}개)`);
}

main().catch(err => { console.error('❌', err.message || err); process.exit(1); });

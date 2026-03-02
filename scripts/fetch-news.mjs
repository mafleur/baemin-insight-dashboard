import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { GoogleDecoder } from 'google-news-url-decoder';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../public/data.json');

const MAX_DAYS = 10;
const MAX_PER_BLOG = 3;
const MAX_PER_AGGREGATOR = 10;
const SIMILARITY_THRESH = 0.25;  // 25% word overlap → duplicate

// ─── RSS Parser ──────────────────────────────────────────────────────────────
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    customFields: { item: ['description', 'content:encoded', 'content', 'source'] },
    timeout: 12000,
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL TOPIC RELEVANCE GATE
//
// Every article, regardless of source, must pass the relevance test for its
// assigned category. If it doesn't match → dropped.
//
// Delivery: food delivery, quick commerce, last-mile logistics, delivery platforms
// AI      : AI applied to products/services; big-tech LLM/agent launches
// IT      : broad tech PM news; blocks celebrity, medical, lifestyle fluff
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_MATCH = [
    // Korean delivery brands & terms
    /배달의민족|쿠팡이츠|요기요|땡겨요|먹깨비|배달앱/,
    /배달플랫폼|배달수수료|음식배달|퀵커머스|큐커머스/,
    /배달원|라이더|쿠리어|잠고형|다크스어|점주수수료/,
    // Global delivery companies (precise)
    /\bdoordash\b/i, /\buber eats\b/i, /\binstacart\b/i,
    /\bdeliveroo\b/i, /\bzomato\b/i, /\bgrubhub\b/i, /\bgopuff\b/i,
    /\bMeituan\b|美团/i, /\bGrab (food|deliver|order|driver|app)\b/i,
    /\bGoJek\b|\bGo-Jek\b/i, /\bFoodpanda\b/i, /\bRappi\b/i,
    /\bEleme\b|饿了么/i, /\bBaemin\b/i,
    // Logistics / business model terms
    /\bquick.?commerce\b/i, /\bq-commerce\b/i,
    /\bfood.?delivery\b/i, /\bdark.?store\b/i, /\bghost.?kitchen\b/i,
    /\blast.?mile\b/i, /\bgig.?economy\b/i, /\bon.?demand delivery\b/i,
    /\bfood.?tech\b/i,
    /\bdelivery (platform|company|service|market|startup)\b/i,
];

const AI_MATCH = [
    // Specific big-tech AI product/model names — always relevant
    /\bopenai\b/i, /\banthropic\b/i, /\bgemini\b/i, /\bclaude\b/i,
    /\bllama\b/i, /\bmistral\b/i, /\bgrok\b/i, /\bdeepseek\b/i,
    /\bperplexity\b/i, /\bsora\b/i, /\bchatgpt\b/i, /\bgpt-\d/i,
    /\bnaver.{0,10}(AI|HyperCLOVA|하이퍼클로바)|\b하이퍼클로바\b/i,
    /\bkakao.{0,10}ai\b|ai.{0,10}kakao\b/i,
    /\bKT.{0,10}ai|ai.{0,10}KT\b/,
    /\b메이투안.{0,15}ai|ai.{0,15}메이투안/,
    // LLM / agent / model terminology — matches both EN and KO titles
    /\bLLM\b/, /\bRAG\b/, /\bfine.?tun/i,
    /\bai.?agent\b/i, /\bgenerative.?ai\b/i, /\bfoundation.?model\b/i,
    /\bmultimodal\b/i, /\bvector.?database\b/i,
    // Korean AI news — broader to capture 'AI 에이전트', 'AI 기능', etc.
    // Note: no longer require specific product name, just meaningful AI context
    /AI.{0,20}(서비스|기능|플랫폼|에이전트|모델|자동화|도입|출시|탑재|적용|연동|전략)/,
    /(서비스|기능|플랫폼|제품|시스템).{0,20}AI/,
    /생성형.{0,5}AI|AI.{0,5}생성형/,
    /멀티모달|대형.{0,5}언어.{0,5}모델|거대.{0,5}언어/,
    /AI.{0,15}(파트너십|투자|협력|합작|인수|출범|구축|분야)/,
    /AI.{0,20}(네이티브|인프라|반도체|칩|엣지|온디바이스)/,
    // English AI in context of services / products
    /ai.{0,25}(service|product|platform|feature|launch|release|deploy|integrat)/i,
    /ai.{0,25}(api|sdk|model|agent|automation|chip|hardware)/i,
    // Business/industry impact
    /ai.{0,20}(funding|raise|acquisition|IPO|valuation|revenue)/i,
];

// Patterns that BLOCK an AI article (consumer lifestyle, politics, entertainment)
const AI_BLOCK = [
    /우리 아이|자녀|학생|학습|어린이|유아|육아/,
    /부동산|아파트|청약|분양/,
    /정치|국회|선거|대통령|대선/,
    /스포츠|연예인|연예|데뷔|열리다|원정|드라마|변넷지/,
    /celebrity|entertainment|sports team|fashion brand/i,
    /의약품|친약|병원|의치|진료|의사|수술/,
    /수상|표식|표창|트로피|식품|올해의 문화인/,
];

// Patterns that BLOCK IT articles (same fluff that has no tech relevance)
const IT_BLOCK = [
    /연예인|열리다|스포츠 결과|어워즈|시상식|드라마 결말/,
    /의약품|친약|진료|수술|병원|수상|표창/,
    /부동산|아파트|청약|분양/,
    /celebrity|entertainment|award ceremony/i,
];

// Check ad/spam regardless of category
function isAdOrSpam(title) {
    return [
        /\[광고\]|\[홍보\]|\[알립니다\]|\[추천\]/i,
        /수강생 모집|세미나 안내|행사 안내/i,
        /PPL|협사|후원/i,
    ].some(p => p.test(title));
}

/**
 * Decide the final category for an article (or null = drop it).
 * @param {string} title
 * @param {string} assigned  - the source's intended category (Delivery/AI/IT)
 * @param {object} opts      - { isAIBlog, isBlogSource }
 * @returns {string|null}
 */
function categorize(title, assigned, opts = {}) {
    const { isAIBlog, isBlogSource } = opts;

    if (isAdOrSpam(title)) return null;

    // ─ Delivery ────────────────────────────────────────────────────────────
    if (assigned === 'Delivery') {
        // Blog sources for delivery companies often write about general engineering
        // topics not explicitly mentioning delivery — pass through, they're domain-specific
        if (isBlogSource) return 'Delivery';
        return DELIVERY_MATCH.some(p => p.test(title)) ? 'Delivery' : null;
    }

    // ─ AI ──────────────────────────────────────────────────────────────────
    if (assigned === 'AI') {
        if (AI_BLOCK.some(p => p.test(title))) return null;
        if (isAIBlog) return 'AI';   // known AI blog — trust it
        return AI_MATCH.some(p => p.test(title)) ? 'AI' : null;
    }

    // ─ IT / HackerNews / General aggregators ───────────────────────────────
    if (assigned === 'IT') {
        if (IT_BLOCK.some(p => p.test(title))) return null;
        // Promote to AI if the title is actually about AI
        if (!AI_BLOCK.some(p => p.test(title)) && AI_MATCH.some(p => p.test(title))) return 'AI';
        // Promote to Delivery if delivery-relevant
        if (DELIVERY_MATCH.some(p => p.test(title))) return 'Delivery';
        // HackerNews / GeekNews are trusted tech sources — pass through
        if (isBlogSource) return 'IT';
        return null;
    }

    return null;
}

// ─── Trusted publishers ──────────────────────────────────────────────────────
const TRUSTED = new Set([
    '조선일보', '중앙일보', '동아일보', '한겨레', '경향신문', '한국경제', '매일경제',
    '서울경제', '이데일리', '연합뉴스', '뉴스1', '뉴시스', '아시아경제', '머니투데이',
    'SBS', 'KBS', 'MBC', 'JTBC', 'YTN', 'MBN', '채널A', 'TV조선',
    '전자신문', 'ZDNet Korea', '블로터',
    'Reuters', 'Bloomberg', 'Wall Street Journal', 'Financial Times',
    'New York Times', 'TechCrunch', 'The Verge', 'Wired', 'Forbes',
    'Business Insider', 'CNBC', 'BBC', 'The Guardian', 'Nikkei', 'AP ',
]);
function isTrusted(item) {
    const src = item.source?._ || item.source || '';
    const tail = (item.title || '').split(' - ').pop() || '';
    if (!src && !tail) return true;
    for (const p of TRUSTED) { if (src.includes(p) || tail.includes(p)) return true; }
    return false;
}

// ─── Deduplication ───────────────────────────────────────────────────────────
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

    // Strip "- Publisher" suffix Google News appends
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

// ─── Puppeteer (shared instance) ─────────────────────────────────────────────
let _browser = null;
async function getBrowser() {
    if (!_browser) _browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    return _browser;
}
async function closeBrowser() { if (_browser) { await _browser.close(); _browser = null; } }
async function puppeteerGetContent(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 });
        await new Promise(r => setTimeout(r, 1800));
        return await page.content();
    } finally { await page.close(); }
}

// ─── Fallback: allorigins proxy ───────────────────────────────────────────────
async function fetchViaProxy(url) {
    const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) throw new Error(`proxy ${resp.status}`);
    const json = await resp.json();
    if (!json.contents) throw new Error('proxy empty');
    return json.contents;
}

// ─── 3-level feed fetcher ────────────────────────────────────────────────────
async function fetchFeed(source) {
    const url = source.url;
    try {
        return { feed: await parser.parseURL(url), method: 'direct' };
    } catch { process.stdout.write('[direct fail] '); }
    try {
        return { feed: await parser.parseString(await fetchViaProxy(url)), method: 'proxy' };
    } catch { process.stdout.write('[proxy fail] '); }
    try {
        const html = await puppeteerGetContent(url);
        try { return { feed: await parser.parseString(html), method: 'puppeteer-xml' }; }
        catch { return { html, method: 'puppeteer-html' }; }
    } catch { process.stdout.write('[puppeteer fail] '); return null; }
}

// ─── Build article object ─────────────────────────────────────────────────────
function makeArticle(fields, meta) {
    return {
        category: fields.category || meta.category,
        sourceTitle: meta.sourceTitle,   // topic group: "AI Tech", "한국 배달앱", "Engineering Blog"
        sourceLabel: meta.sourceLabel,   // actual source: "Google News", "OpenAI Blog", "Hacker News"
        isGoogleNews: meta.isGoogleNews || false,
        title: fields.title,
        link: fields.link,
        pubDate: fields.pubDate || new Date().toISOString(),
        snippet: fields.snippet || '',
        summaries: null,
    };
}

// ─── Process RSS feed into articles ──────────────────────────────────────────
function processFeed(feed, meta, cutoffDate, existingLinks, cap, seenTitles = []) {
    const articles = [];
    for (const item of feed.items) {
        if (articles.length >= cap) break;
        if (existingLinks.has(item.link)) continue;
        const pubDate = new Date(item.isoDate || item.pubDate || Date.now());
        if (pubDate < cutoffDate) continue;

        if (isAdOrSpam(item.title)) continue;
        if (meta.filterHN) {
            // HN items must match HN keyword list (already strict regex)
            const HN_KW = [
                /\bdelivery\b/i, /\bdoordash\b/i, /\buber eats\b/i, /\binstacart\b/i,
                /\bMeituan\b/i, /\bGoJek\b/i, /\bFoodpanda\b/i, /\bRappi\b/i,
                /\bGrab\b/,     // capital G
                /\bquick.?commerce\b/i, /\bdark.?store\b/i, /\bghost.?kitchen\b/i,
                /\bLLM\b/, /\bGPT-\d/i, /\bgemini\b/i, /\bclaude\b/i,
                /\bopenai\b/i, /\banthropic\b/i, /\bai.?agent\b/i, /\bgenerative.?ai\b/i,
                /\bfoundation.?model\b/i, /\bRAG\b/,
            ];
            if (!HN_KW.some(re => re.test(item.title))) continue;
        }

        // Universal category gate — also re-categorizes AI/Delivery items from HN
        const finalCat = categorize(item.title, meta.category, {
            isAIBlog: meta.isAIBlog,
            isBlogSource: true,   // blog sources get light gating
        });
        if (!finalCat) continue;
        if (isDup(item.title, seenTitles)) continue;

        seenTitles.push(item.title);
        const raw = item['content:encoded'] || item.content || item.description || '';
        articles.push(makeArticle({
            category: finalCat,
            title: item.title, link: item.link,
            pubDate: pubDate.toISOString(),
            snippet: extractSnippet(raw, item.title),
        }, meta));
    }
    return articles;
}

// ─── GeekNews HTML parser ─────────────────────────────────────────────────────
function parseGeekNewsHTML(html, meta, existingLinks, cap, seenTitles) {
    const $ = cheerio.load(html);
    const out = [];
    $('.topic_row').each((_, el) => {
        if (out.length >= cap) return false;
        const title = $(el).find('.topictitle a h1').text().trim();
        let link = $(el).find('.topictitle a').attr('href') || '';
        if (link && !link.startsWith('http')) link = `https://news.hada.io${link}`;
        const desc = $(el).find('.topicdesc').text().trim();
        if (!title || !link || existingLinks.has(link)) return;
        const cat = categorize(title, 'IT', { isBlogSource: true });
        if (!cat || isDup(title, seenTitles)) return;
        seenTitles.push(title);
        out.push(makeArticle({ category: cat, title, link, snippet: desc }, meta));
    });
    return out;
}

// ─── DoorDash blog scraper ────────────────────────────────────────────────────
async function scrapeDoorDash(meta, existingLinks, cap) {
    const results = [];
    const SKIP = new Set(['engineering blog', 'blog', 'read more', 'learn more', 'view all']);
    try {
        const html = await puppeteerGetContent('https://careersatdoordash.com/engineering-blog/');
        const $ = cheerio.load(html);
        const seen = new Set();
        $('a[href*="/engineering-blog/"]').each((_, el) => {
            if (results.length >= cap) return false;
            const href = $(el).attr('href') || '';
            if (!href || href.replace(/\/$/, '') === '/engineering-blog') return;
            const fullLink = href.startsWith('http') ? href : `https://careersatdoordash.com${href}`;
            if (existingLinks.has(fullLink) || seen.has(fullLink)) return;
            seen.add(fullLink);
            const card = $(el).closest('article,[class*="card"],[class*="post"],[class*="blog"],li');
            const title = (
                card.find('h1,h2,h3,h4').first().text().trim() ||
                $(el).find('h1,h2,h3,h4').first().text().trim() ||
                $(el).text().trim()
            ).replace(/\s+/g, ' ');
            if (!title || title.length < 12 || SKIP.has(title.toLowerCase())) return;
            const desc = card.find('p').first().text().trim();
            const snip = extractSnippet(desc, title);
            if (!snip) return;
            results.push(makeArticle({ title, link: fullLink, snippet: snip }, meta));
        });
    } catch (err) { console.log(`DoorDash 실패: ${err.message.substring(0, 60)}`); }
    return results;
}

// ─── Google News multi-query ──────────────────────────────────────────────────
// sourceTitle = topic group (visible in card), sourceLabel = "Google News"
const GN_QUERIES = [
    {
        sourceTitle: '한국 배달앱', category: 'Delivery',
        q: '"쿠팡이츠" OR "요기요" OR "배달의민족" OR "배달앱" OR "퀵커머스" OR "음식배달"',
        hl: 'ko', gl: 'KR', ceid: 'KR:ko',
    },
    {
        sourceTitle: '글로벌 배달', category: 'Delivery',
        q: '"DoorDash" OR "Uber Eats" OR "Deliveroo" OR "Instacart" OR "Zomato" OR "Grubhub" OR "quick commerce" OR "food delivery"',
        hl: 'en', gl: 'US', ceid: 'US:en',
    },
    {
        sourceTitle: '아시아 배달', category: 'Delivery',
        q: '"Meituan" OR "美团" OR "Eleme" OR "饿了么" OR "GoJek" OR "Foodpanda" OR "Rappi" OR "Grab delivery" OR "Baemin"',
        hl: 'en', gl: 'SG', ceid: 'SG:en',
    },
    {
        sourceTitle: '아시아 배달', category: 'Delivery',
        q: '"메이투안" OR "배달 플랫폼 아시아" OR "그랩" OR "고젝" OR "글로벌 배달" OR "해외 배달앱"',
        hl: 'ko', gl: 'KR', ceid: 'KR:ko',
    },
    {
        sourceTitle: 'AI 산업', category: 'AI',
        q: '"AI 에이전트" OR "생성형 AI" OR "LLM" OR "AI 플랫폼" OR "AI 기능 출시" OR "AI 자동화" OR "OpenAI" OR "Anthropic" OR "Claude" OR "Gemini"',
        hl: 'ko', gl: 'KR', ceid: 'KR:ko',
    },
    {
        sourceTitle: 'AI Tech', category: 'AI',
        q: '"OpenAI" OR "Anthropic" OR "Claude" OR "Gemini" OR "LLM" OR "AI agent" OR "foundation model" OR "generative AI" OR "AI product launch"',
        hl: 'en', gl: 'US', ceid: 'US:en',
    },
];

async function fetchGoogleNews(cutoffDate, existingLinks) {
    const all = [];
    const seenTitles = [];
    const seenLinks = new Set(existingLinks);

    for (const q of GN_QUERIES) {
        const enc = encodeURIComponent(q.q);
        const url = `https://news.google.com/rss/search?q=${enc}+when:10d&hl=${q.hl}&gl=${q.gl}&ceid=${q.ceid}`;
        process.stdout.write(`  ▶ Google News [${q.sourceTitle}]... `);
        try {
            const feed = await parser.parseURL(url);
            let n = 0;
            for (const item of feed.items) {
                if (n >= MAX_PER_AGGREGATOR) break;
                if (seenLinks.has(item.link)) continue;
                const pub = new Date(item.isoDate || item.pubDate || Date.now());
                if (pub < cutoffDate) continue;
                if (!isTrusted(item)) continue;

                // MANDATORY topic relevance gate
                const finalCat = categorize(item.title, q.category, { isAIBlog: false });
                if (!finalCat) continue;
                if (isDup(item.title, seenTitles)) continue;

                const raw = item['content:encoded'] || item.content || item.description || '';
                seenTitles.push(item.title);
                seenLinks.add(item.link);
                all.push(makeArticle({
                    category: finalCat,
                    title: item.title, link: item.link,
                    pubDate: pub.toISOString(),
                    snippet: extractSnippet(raw, item.title),
                }, { sourceTitle: q.sourceTitle, sourceLabel: 'Google News', isGoogleNews: true }));
                n++;
            }
            console.log(`${n}개`);
        } catch (e) {
            console.log(`실패 (${e.message.substring(0, 50)})`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    // Resolve Google News redirect links to final URLs
    if (all.length > 0) {
        process.stdout.write(`  ▶ URL 리다이렉트 추적 (${all.length}개)... `);
        let resolved = 0;
        const decoder = new GoogleDecoder();

        for (let i = 0; i < all.length; i += 40) {
            await Promise.all(all.slice(i, i + 40).map(async a => {
                if (!a.link.includes('news.google.com/rss/articles/')) return;
                try {
                    const decoded = await decoder.decode(a.link);
                    if (decoded && decoded.status && decoded.decoded_url) {
                        a.link = decoded.decoded_url;
                        resolved++;
                    }
                } catch { /* Ignore decode errors */ }
            }));
        }
        console.log(`${resolved}개 URL 변환 완료`);
    }

    // Fetch article body for items with empty snippet
    const noSnippet = all.filter(a => !a.snippet);
    if (noSnippet.length > 0) {
        process.stdout.write(`  ▶ 본문 직접 수집 (${noSnippet.length}개)... `);
        let fetched = 0;
        for (let i = 0; i < noSnippet.length; i += 5) {
            await Promise.all(noSnippet.slice(i, i + 5).map(async a => {
                try {
                    const resp = await fetch(a.link, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
                        signal: AbortSignal.timeout(8000), redirect: 'follow',
                    });
                    if (!resp.ok) return;
                    if (resp.url && !resp.url.includes('news.google.com')) a.link = resp.url; // Update link here too just in case
                    const $ = cheerio.load(await resp.text());
                    $('nav,header,footer,aside,script,style,[class*="nav"],[class*="sidebar"],[class*="cookie"],[class*="banner"],[class*="related"]').remove();
                    const paras = $('article p,[class*="article"] p,[class*="story"] p,main p,.content p')
                        .map((_, el) => $(el).text().trim()).get()
                        .filter(p => p.length > 40 && !p.includes('©') && !p.includes('All rights reserved'));
                    if (paras.length > 0) { a.snippet = paras.slice(0, 3).join(' '); fetched++; }
                } catch { /* paywall/timeout — skip */ }
            }));
        }
        console.log(`${fetched}/${noSnippet.length}개 본문 확보`);
    }

    return all;
}

// ─── Generic source fetcher ───────────────────────────────────────────────────
// Source structure: { category, sourceTitle (topic), sourceLabel (blog name), url, ... }
const SOURCES = [
    // ── Delivery engineering blogs ──────────────────────────────────────────
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Uber Engineering', url: 'https://www.uber.com/en-US/blog/engineering/rss/' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'DoorDash Engineering', url: null, htmlScrape: true },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Delivery Hero Tech', url: 'https://tech.deliveryhero.com/feed/' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Instacart Tech', url: 'https://tech.instacart.com/feed' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'GoPuff Tech', url: 'https://medium.com/gopuff-tech/feed' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Grubhub Engineering', url: 'https://grubhub.com/blog/feed' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Grab Engineering', url: 'https://engineering.grab.com/feed.xml' },
    { category: 'Delivery', sourceTitle: 'Engineering Blog', sourceLabel: 'Zomato Tech', url: 'https://medium.com/feed/zomato-technology' },
    // ── AI ──────────────────────────────────────────────────────────────────
    { category: 'AI', sourceTitle: 'AI Research', sourceLabel: 'OpenAI Blog', url: 'https://openai.com/news/rss.xml', isAIBlog: true },
    // ── IT ──────────────────────────────────────────────────────────────────
    { category: 'IT', sourceTitle: 'Tech', sourceLabel: 'GeekNews', url: 'https://news.hada.io/rss' },
    { category: 'IT', sourceTitle: 'Tech', sourceLabel: 'Hacker News', url: 'https://news.ycombinator.com/rss', filterHN: true },
];

async function fetchSource(source, cutoffDate, existingLinks) {
    const cap = source.filterHN ? MAX_PER_AGGREGATOR : MAX_PER_BLOG;
    const meta = { category: source.category, sourceTitle: source.sourceTitle, sourceLabel: source.sourceLabel, isAIBlog: source.isAIBlog };

    if (source.htmlScrape) {
        const res = await scrapeDoorDash(meta, existingLinks, cap);
        console.log(`${res.length}개`);
        return res;
    }

    const result = await fetchFeed(source);
    if (!result) { console.log('완전 실패 – 스킵'); return []; }

    if (result.feed) {
        const arts = processFeed(result.feed, { ...meta, filterHN: source.filterHN }, cutoffDate, existingLinks, cap);
        console.log(`${result.method}: ${arts.length}개`);
        return arts;
    }

    if (source.sourceLabel === 'GeekNews') {
        const arts = parseGeekNewsHTML(result.html, meta, existingLinks, cap, []);
        console.log(`GeekNews HTML: ${arts.length}개`);
        return arts;
    }

    console.log('HTML – 파싱 불가');
    return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 뉴스 수집 시작 (v6 — 카테고리별 관련성 게이트)\n');

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
        newArticles.push(...await fetchSource(source, cutoffDate, existingLinks));
    }

    await closeBrowser();

    console.log('\n━━━ PHASE 2: 저장 ━━━');
    let all = [...newArticles, ...existingData.articles];
    all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const validCutoff = new Date();
    validCutoff.setDate(validCutoff.getDate() - MAX_DAYS);
    all = all.filter(a => new Date(a.pubDate) >= validCutoff).slice(0, 200);

    fs.writeFileSync(DATA_FILE, JSON.stringify({
        metadata: { lastUpdated: new Date().toISOString(), totalArticles: all.length },
        articles: all,
    }, null, 2), 'utf8');

    console.log(`✅ ${all.length}개 저장 완료.`);
    console.log('ℹ️  AI 요약은 버튼 클릭 시에만 실행됩니다.');
}

main().catch(async err => { await closeBrowser(); console.error(err); });

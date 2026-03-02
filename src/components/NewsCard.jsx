import { useState } from 'react';

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;

async function geminiSummarize(title, snippet) {
    const text = snippet || title;
    const prompt = `다음 기사를 한글로 3줄 핵심 요약해줘. PM 관점에서 업계 인사이트가 드러나도록.
반드시 JSON 배열로만 반환: ["줄1", "줄2", "줄3"]
마크다운 없이 순수 JSON만.

제목: ${title}
내용: ${text.substring(0, 2000)}`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error?.message || `HTTP ${res.status}`;
        if (res.status === 429) throw new Error('RATE_LIMIT');
        throw new Error(msg);
    }

    const data = await res.json();
    let output = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    output = output.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const arr = JSON.parse(output);
    if (Array.isArray(arr)) return arr.map(s => s.replace(/^- /, '').trim());
    return [output];
}

export default function NewsCard({ item, onClickTag }) {
    const [summaryState, setSummaryState] = useState('idle'); // idle | loading | done | error
    const [summaries, setSummaries] = useState([]);
    const [showSummary, setShowSummary] = useState(false);

    const dateStr = item.pubDate
        ? new Date(item.pubDate).toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        })
        : '날짜 알 수 없음';

    const getTagColor = tag => {
        switch (tag) {
            case 'Delivery': return 'bg-orange-100 text-orange-700 border-orange-200';
            case 'AI': return 'bg-violet-100 text-violet-700 border-violet-200';
            case 'IT': return 'bg-sky-100 text-sky-700 border-sky-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
        }
    };

    const handleSummarize = async () => {
        if (summaryState === 'done') {
            // Toggle show/hide
            setShowSummary(v => !v);
            return;
        }
        if (summaryState === 'loading') return;

        setSummaryState('loading');
        setShowSummary(true);

        try {
            const result = await geminiSummarize(item.title, item.snippet);
            setSummaries(result);
            setSummaryState('done');
        } catch (err) {
            if (err.message === 'RATE_LIMIT') {
                setSummaries(['⚠️ API 요청 한도 초과입니다. 잠시 후 다시 시도해 주세요.']);
            } else {
                setSummaries([`⚠️ 요약 실패: ${err.message}`]);
            }
            setSummaryState('error');
        }
    };

    const btnLabel = () => {
        if (summaryState === 'loading') return '요약 중...';
        if (summaryState === 'done') return showSummary ? '요약 접기 ▲' : 'AI 요약 보기 ▼';
        if (summaryState === 'error') return '재시도';
        return '✦ AI 요약';
    };

    const btnClass = () => {
        const base = 'text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors';
        if (summaryState === 'loading') return `${base} bg-gray-50 text-gray-400 border-gray-100 cursor-wait`;
        if (summaryState === 'done' && showSummary)
            return `${base} bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100`;
        return `${base} bg-white text-gray-600 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200`;
    };

    return (
        <article className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-3 hover:shadow-md transition-shadow duration-200">

            {/* Meta */}
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-2 text-sm text-gray-500">
                <button
                    onClick={() => onClickTag(item.category)}
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border cursor-pointer hover:opacity-75 transition-opacity ${getTagColor(item.category)}`}
                >
                    {item.category}
                </button>
                <span className="font-medium text-gray-700">{item.sourceTitle}</span>
                {item.sourceLabel && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">
                        via {item.sourceLabel}
                    </span>
                )}
                <span className="text-gray-300">·</span>
                <span>{dateStr}</span>
            </div>

            {/* Title */}
            <h2 className="text-base font-bold text-gray-900 leading-snug mb-2">
                <a href={item.link} target="_blank" rel="noopener noreferrer"
                    className="hover:text-violet-700 transition-colors">
                    {item.title}
                </a>
            </h2>

            {/* Snippet — first 3 sentences of article body */}
            {item.snippet ? (
                <p className="text-sm text-gray-600 leading-relaxed mb-3 line-clamp-3">
                    {item.snippet}
                </p>
            ) : (
                <p className="text-sm text-gray-400 italic mb-3">
                    {item.isGoogleNews
                        ? 'Google News는 기사 본문을 직접 제공하지 않습니다. 원문 링크를 통해 확인해 주세요.'
                        : '본문 미리보기를 가져올 수 없습니다 (콘텐츠 접근 제한).'}
                </p>
            )}


            {/* AI Summary panel (revealed on click) */}
            {showSummary && (
                <div className="mb-3">
                    {summaryState === 'loading' ? (
                        <div className="flex items-center gap-2 text-sm text-violet-500 animate-pulse py-1">
                            <span className="inline-block w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                            AI가 요약하는 중...
                        </div>
                    ) : (
                        <ul className="border-l-2 border-violet-200 pl-3 space-y-1.5">
                            {summaries.map((s, i) => (
                                <li key={i} className="text-sm text-gray-700 leading-relaxed flex gap-1.5">
                                    <span className="text-violet-400 shrink-0 mt-0.5">•</span>
                                    <span>{s}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-1">
                <button onClick={handleSummarize} className={btnClass()}>
                    {btnLabel()}
                </button>
                <a href={item.link} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors ml-auto">
                    원문 보기 →
                </a>
            </div>

        </article>
    );
}

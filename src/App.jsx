import { useState, useEffect } from 'react';
import NewsCard from './components/NewsCard';
import RefreshButton from './components/RefreshButton';

export default function App() {
  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [activeTag, setActiveTag] = useState('All');
  const [lastUpdated, setLastUpdated] = useState('');
  const [loading, setLoading] = useState(true);

  const tags = ['All', 'Delivery', 'AI', 'IT'];

  useEffect(() => {
    fetch('/data.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load data.json');
        return res.json();
      })
      .then(data => {
        setArticles(data.articles || []);
        setFilteredArticles(data.articles || []);
        if (data.metadata?.lastUpdated) {
          const date = new Date(data.metadata.lastUpdated);
          setLastUpdated(date.toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          }));
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching data:', err);
        setLoading(false);
      });
  }, []);

  const handleTagClick = (tag) => {
    setActiveTag(tag);
    if (tag === 'All') {
      setFilteredArticles(articles);
    } else {
      setFilteredArticles(articles.filter(article => article.category === tag));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
                <span className="bg-primary-500 text-white rounded-lg px-2.5 py-1 text-lg">BI</span>
                Baemin Insight
              </h1>
              <p className="text-sm text-gray-500 mt-1">프로덕트인사이트팀을 위한 주간 동향 요약</p>
            </div>

            <div className="flex items-center gap-4">
              {lastUpdated && (
                <div className="text-right">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">최종 업데이트</span>
                  <p className="text-sm text-gray-600 font-medium">{lastUpdated}</p>
                </div>
              )}
              <RefreshButton />
            </div>

          </div>

          {/* Tag Filter */}
          <div className="mt-6 flex flex-wrap gap-2">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTag === tag
                  ? 'bg-gray-900 text-white shadow-md'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 md:px-6 py-8">

        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
          </div>
        )}

        {!loading && articles.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <p className="text-lg font-medium text-gray-900 mb-1">아직 수집된 기사가 없습니다.</p>
            <p className="text-sm">GNB의 새로고침 버튼을 눌러 기사를 가져오거나, 데이터 수집 스크립트를 실행해 주세요.</p>
          </div>
        )}

        {!loading && filteredArticles.length === 0 && articles.length > 0 && (
          <div className="text-center py-12 text-gray-500">
            해당 카테고리의 기사가 없습니다.
          </div>
        )}

        <div className="space-y-4">
          {filteredArticles.map((item, idx) => (
            <NewsCard
              key={item.link || idx}
              item={item}
              onClickTag={handleTagClick}
            />
          ))}
        </div>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500 font-medium">
            AI-powered News Aggregation by <span className="text-gray-900 font-semibold">Baemin Insight Team</span>
          </p>
          <p className="text-xs text-gray-400">매일 오전 8시 자동 업데이트 · 10일 이내 기사만 표시</p>
        </div>
      </footer>
    </div>
  );
}

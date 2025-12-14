import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useEffect, useMemo, useState } from 'react';

// Recharts
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';

/** ================= CONSTANTS & STYLES ================= */
const CHART_MARGINS = { top: 32, right: 64, bottom: 40, left: 24 };
const SPEND_COLOR = '#f97316'; 
const SALES_COLOR = '#0ea5e9'; 
const CVR_COLOR = '#2563eb';   
const ACOS_COLOR = '#16a34a';  
const CPC_COLOR = '#f59e0b';

/** ================= IMAGE UPLOAD COMPONENT ================= */
function ImageUploadForPDF() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImageUrl(null);
  };

  // If no image, don't render anything (won't show in PDF)
  if (!imageUrl) {
    return (
      <div className="bg-white rounded-lg border shadow mt-6 no-print">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="text-xl font-semibold">Additional Image (Optional)</h3>
        </div>
        <div className="p-8 text-center">
          <label className="cursor-pointer inline-flex flex-col items-center justify-center px-6 py-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
            <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-gray-600 font-medium">Click to upload image</span>
            <span className="text-xs text-gray-500 mt-1">Will appear in PDF export</span>
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleImageUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>
    );
  }

  // If image exists, show preview (will appear in PDF)
  return (
    <div className="bg-white rounded-lg border shadow mt-6 print:break-inside-avoid print:shadow-none print:border-none">
      <div className="p-4 border-b bg-gray-50 print:bg-white print:px-0">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold">Additional Image</h3>
          <button 
            onClick={handleRemoveImage}
            className="text-red-600 hover:text-red-700 text-sm font-medium no-print"
          >
            Remove
          </button>
        </div>
      </div>
      <div className="p-4 print:px-0 flex justify-center">
        <img 
          src={imageUrl} 
          alt="Uploaded content" 
          className="max-w-full h-auto max-h-[600px] object-contain rounded"
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/profile/$profileId')({
  component: ProfileDashboard,
});

/** ================= HELPERS ================= */
function formatMoney(major: number, currencyCode?: string, digits: number = 2) {
  const amt = Number(major || 0);
  try {
    return new Intl.NumberFormat(undefined, { 
      style: 'currency', 
      currency: currencyCode || 'USD', 
      minimumFractionDigits: digits, 
      maximumFractionDigits: digits 
    }).format(amt);
  } catch { 
    return `${amt.toFixed(digits)} ${currencyCode || ''}`; 
  }
}
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** ================= MAIN COMPONENT ================= */
export default function ProfileDashboard() {
  const { profileId } = Route.useParams();
  
  // 1. Data Hooks
  const profile = useQuery(api.profiles.getById, { profileId });
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('');
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [isRefreshing, setIsRefreshing] = useState(false); 

  // NEW: State for the dropdown filter (1-4 weeks or 1-2 months)
  // We initialize with a high number; the effect below corrects it if needed.
  const [selectedDuration, setSelectedDuration] = useState<number>(4);

  // Query DB
  const rawSnapshots = useQuery(api.amazonAds.getSnapshots, { 
    profileId, 
    portfolioId: selectedPortfolio || undefined,
    period: period 
  });

  // Actions
  const fetchPortfolios = useAction(api.amazonAds.fetchPortfolios);
  const syncAds = useAction(api.amazonAds.syncAds);
  const pollPending = useAction(api.amazonAds.pollPendingSnapshots);
  const resetSnapshots = useMutation(api.amazonAds.resetSnapshots);

  // Local State
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  // Reset duration when period changes
  useEffect(() => {
    setSelectedDuration(period === 'weekly' ? 4 : 2);
  }, [period]);

  // 2. Load Portfolios
  useEffect(() => {
    const run = async () => {
      setLoadingPorts(true);
      const res = await fetchPortfolios({ profileId });
      if (res?.success) setPortfolios(res.portfolios || []);
      setLoadingPorts(false);
    };
    run();
  }, [profileId, fetchPortfolios]);

  // 3. Sync Trigger
  useEffect(() => {
    if (!selectedPortfolio) return;
    if (rawSnapshots && rawSnapshots.length > 0 && !isRefreshing) return;

    if (rawSnapshots?.length === 0 || isRefreshing) {
        if (isRefreshing) setIsRefreshing(false); 
        syncAds({ profileId, portfolioId: selectedPortfolio, period });
    }
  }, [profileId, selectedPortfolio, period, rawSnapshots, syncAds, isRefreshing]);

  // 4. Polling
  const hasPending = useMemo(() => {
    return rawSnapshots?.some(s => s.status === 'PENDING' || s.status === 'INIT') ?? false;
  }, [rawSnapshots]);

  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => { pollPending({ profileId }); }, 5000);
    return () => clearInterval(interval);
  }, [hasPending, profileId, pollPending]);

  // 5. Data Preparation
  const allWeeks = useMemo(() => {
    if (!rawSnapshots || rawSnapshots.length === 0) return [];

    // Filter Window: 12 hours
    const BATCH_WINDOW = 12 * 60 * 60 * 1000; 
    const maxTime = Math.max(...rawSnapshots.map(s => s.updatedAt || 0));
    
    // Keep only recent batch
    const latestBatch = rawSnapshots.filter(s => (maxTime - (s.updatedAt || 0)) < BATCH_WINDOW);

    // Deduplicate logic
    const uniqueMap = new Map();
    for (const snap of latestBatch) {
        const existing = uniqueMap.get(snap.startDate);
        const hasData = snap.reportIds && Object.keys(snap.reportIds).length > 0;
        const existingHasData = existing && existing.reportIds && Object.keys(existing.reportIds).length > 0;

        if (!existing) {
            uniqueMap.set(snap.startDate, snap);
        } else {
            if (hasData && !existingHasData) {
                uniqueMap.set(snap.startDate, snap);
            }
            else if (hasData && existingHasData && (snap.updatedAt || 0) > (existing.updatedAt || 0)) {
                uniqueMap.set(snap.startDate, snap);
            }
        }
    }

    // Sort Chronologically: Oldest -> Newest (Left to Right in table)
    return Array.from(uniqueMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [rawSnapshots]);

  const allLoaded = allWeeks.length > 0 && !hasPending && allWeeks.every(s => s.status === 'COMPLETED');

  // === DYNAMIC FILTERING ===
  // We slice the array based on selectedDuration.
  // Since allWeeks is sorted Oldest -> Newest (Index 0 is old, Index N is new),
  // We want to keep the N newest items.
  // e.g., if we have 4 weeks and user selects 1, we want the LAST one (the most recent).
  const visibleWeeks = useMemo(() => {
    if (!allWeeks.length) return [];
    // Take the last N items (most recent dates)
    const count = Math.min(selectedDuration, allWeeks.length);
    return allWeeks.slice(-count); 
  }, [allWeeks, selectedDuration]);

  const chartData = useMemo(() => {
    return visibleWeeks.map(w => {
      const d = w.data;
      const acos = d.sales > 0 ? d.spend / d.sales : 0;
      const cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
      const cvr = d.clicks > 0 ? d.orders / d.clicks : 0;
      
      if (w.status !== 'COMPLETED') return { label: w.label, spend: 0, ppcSales: 0, clicks: 0, impressions: 0, acos: 0, cpc: 0, cvr: 0 };
      return { label: w.label, spend: d.spend, ppcSales: d.sales, clicks: d.clicks, impressions: d.impressions, acos, cpc, cvr };
    });
  }, [visibleWeeks]);

  // 6. Handlers
  const handleRefresh = async () => {
    if (!selectedPortfolio) return;
    if (window.confirm(`Reload ${period} data from Amazon? This will delete previous syncs for this period/portfolio.`)) {
      setIsRefreshing(true); 
      await resetSnapshots({ profileId, portfolioId: selectedPortfolio, period });
    }
  };

  const handleExportPDF = () => window.print();

  if (!profile) return <div className="p-8">Loading profile...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto print:p-0 print:max-w-none">
      <style>{`
        @media print {
          @page { size: landscape; margin: 1cm; }
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          nav, header, footer { display: none !important; } 
          .print-full-width { width: 100% !important; max-width: none !important; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-6">
        <Link to="/" className="text-blue-600 hover:underline text-sm mb-2 inline-block no-print">← Back to Profiles</Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">{profile.accountName}</h1>
            <p className="text-gray-600 mt-1">{profile.accountType} • {profile.countryCode} • {profile.currencyCode} {profile.region && <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">{profile.region}</span>}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 bg-white rounded-lg border p-4 flex flex-col md:flex-row justify-between items-end md:items-center gap-4 no-print">
        <div className="w-full md:w-auto flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4 items-end md:items-center">
            <div>
                <label className="block text-sm font-semibold mb-2">Filter by Portfolio:</label>
                {loadingPorts ? <p className="text-gray-500 text-sm">Loading...</p> : (
                <select value={selectedPortfolio} onChange={(e) => setSelectedPortfolio(e.target.value)} disabled={hasPending || isRefreshing} className="w-full md:w-72 px-4 py-2 border rounded-lg">
                    <option value="">Select a Portfolio</option>
                    {portfolios.map((p) => <option key={p.portfolioId} value={p.portfolioId}>{p.name} ({p.state})</option>)}
                </select>
                )}
            </div>

            {/* PERIOD TOGGLE */}
            {selectedPortfolio && (
                <div className="bg-gray-100 p-1 rounded-lg flex h-[42px] items-center">
                <button 
                    onClick={() => setPeriod("weekly")}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${period === 'weekly' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                    Weekly
                </button>
                <button 
                    onClick={() => setPeriod("monthly")}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${period === 'monthly' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                    Monthly
                </button>
                </div>
            )}
          </div>

          {/* DURATION DROPDOWN (Only visible when loaded) */}
          {selectedPortfolio && allLoaded && (
             <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                <label className="text-sm font-medium text-gray-700">Show last:</label>
                <select 
                    value={selectedDuration}
                    onChange={(e) => setSelectedDuration(Number(e.target.value))}
                    className="px-3 py-1.5 border rounded-md text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500"
                >
                    {period === 'weekly' ? (
                        <>
                            <option value={1}>1 Week</option>
                            <option value={2}>2 Weeks</option>
                            <option value={3}>3 Weeks</option>
                            <option value={4}>4 Weeks</option>
                        </>
                    ) : (
                        <>
                            <option value={1}>1 Month</option>
                            <option value={2}>2 Months</option>
                        </>
                    )}
                </select>
             </div>
          )}
        </div>
        
        {selectedPortfolio && (
          <button onClick={handleExportPDF} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 transition-colors shadow-sm">
            <span className="text-sm">Export PDF</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border shadow mb-8 print:shadow-none print:border-none">
        <div className="p-4 border-b bg-gray-50 print:bg-white print:border-b-2 print:px-0">
          <h2 className="text-xl font-semibold">
            {period === 'weekly' ? `Last ${visibleWeeks.length} Week${visibleWeeks.length > 1 ? 's' : ''}` : `Last ${visibleWeeks.length} Month${visibleWeeks.length > 1 ? 's' : ''}`} Performance
          </h2>
          <p className="hidden print:block text-sm text-gray-500">Portfolio: {portfolios.find(p => p.portfolioId === selectedPortfolio)?.name}</p>
          {selectedPortfolio && hasPending && <p className="text-xs text-blue-600 animate-pulse mt-1 no-print">Syncing...</p>}
        </div>

        {!selectedPortfolio ? (
          <div className="p-8 text-center text-gray-500">Please select a portfolio.</div>
        ) : allWeeks.length === 0 && !isRefreshing ? (
          <div className="p-8 text-center">
             {(rawSnapshots && rawSnapshots.length === 0) ? (
                 <>
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className="text-gray-500">Fetching {period} data...</p>
                 </>
             ) : (
                 <p className="text-gray-500">No data found. Click Hard Refresh to pull initial data.</p>
             )}
          </div>
        ) : (
          <div className="p-6 overflow-x-auto print:p-0 print:overflow-visible">
            <table className="w-full min-w-[820px] print:min-w-0 print:text-sm">
              <thead>
                <tr className="border-b bg-orange-50">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Metric</th>
                  {visibleWeeks.map((w) => (
                    <th key={w.label} className="text-right py-3 px-4 font-semibold text-gray-700">
                      {w.label}
                      <div className="text-xs text-gray-500 font-normal">{period === 'weekly' ? `${w.startDate} – ${w.endDate}` : ''}</div>
                      {w.status !== 'COMPLETED' && <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded ml-1 no-print">LOADING</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                 {[
                   { label: 'Impressions', key: 'impressions', fmt: (v:number)=>Number(v).toLocaleString() },
                   { label: 'Clicks', key: 'clicks', fmt: (v:number)=>Number(v).toLocaleString() },
                   { label: 'PPC Spend', key: 'spend', fmt: (v:number)=>formatMoney(v, profile.currencyCode) },
                   { label: 'PPC Sales', key: 'sales', fmt: (v:number)=>formatMoney(v, profile.currencyCode) },
                   { label: 'PPC Orders', key: 'orders', fmt: (v:number)=>Number(v).toLocaleString() },
                 ].map(row => (
                   <tr key={row.key} className="border-b hover:bg-gray-50">
                     <td className="py-3 px-4 text-gray-900 bg-orange-50  font-medium">{row.label}</td>
                     {visibleWeeks.map(w => <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">{w.status === 'COMPLETED' ? row.fmt(w.data[row.key as keyof typeof w.data]) : '-'}</td>)}
                   </tr>
                 ))}
                 <tr className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">ACOS</td>
                    {visibleWeeks.map(w => <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">{w.status === 'COMPLETED' ? pct(w.data.sales > 0 ? w.data.spend/w.data.sales : 0) : '-'}</td>)}
                 </tr>
                 <tr className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 bg-orange-50  font-medium">Cost per Click</td>
                    {visibleWeeks.map(w => <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">{w.status === 'COMPLETED' ? formatMoney(w.data.clicks > 0 ? w.data.spend/w.data.clicks : 0, profile.currencyCode) : '-'}</td>)}
                 </tr>
                 <tr className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 bg-orange-50  font-medium">CTR</td>
                    {visibleWeeks.map(w => <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">{w.status === 'COMPLETED' ? pct(w.data.impressions > 0 ? w.data.clicks/w.data.impressions : 0) : '-'}</td>)}
                 </tr>
                 <tr className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Conversion Rate</td>
                    {visibleWeeks.map(w => <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">{w.status === 'COMPLETED' ? pct(w.data.clicks > 0 ? w.data.orders/w.data.clicks : 0) : '-'}</td>)}
                 </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Charts */}
      {visibleWeeks.some(w => w.status === 'COMPLETED') && (
        <div className="mt-8 space-y-8 print:break-inside-avoid">
          {/* Spend vs Sales */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible print:break-inside-avoid print:shadow-none print:border-none">
            <div className="p-4 border-b bg-gray-50 print:bg-white print:px-0"><h3 className="text-xl font-semibold">PPC Spend vs Sales</h3></div>
            <div className="p-4 print:px-0">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartData} barCategoryGap={period === 'monthly' ? 40 : 24} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v) => formatMoney(v, profile?.currencyCode, 0)} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 8 }} />
                  <Bar dataKey="ppcSales" name="Sales" fill={SALES_COLOR} radius={[6,6,0,0]}><LabelList dataKey="ppcSales" position="top" content={(p:any) => p.value ? <text x={p.x+p.width/2} y={p.y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(p.value, profile.currencyCode, 0)}</text> : null} /></Bar>
                  <Bar dataKey="spend" name="Spend" fill={SPEND_COLOR} radius={[6,6,0,0]}><LabelList dataKey="spend" position="top" content={(p:any) => p.value ? <text x={p.x+p.width/2} y={p.y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(p.value, profile.currencyCode, 0)}</text> : null} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          {/* CVR */}
          <div className="bg-white rounded-lg border shadow mt-6 print:break-inside-avoid print:shadow-none print:border-none">
            <div className="p-4 border-b bg-gray-50 print:bg-white print:px-0"><h3 className="text-xl font-semibold">Conversion Rate</h3></div>
            <div className="p-4 print:px-0">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="cvr" name="CVR" stroke={CVR_COLOR} strokeWidth={3} dot={{r:4}}><LabelList dataKey="cvr" position="top" content={(p:any) => p.value ? <text x={p.x} y={p.y-6} textAnchor="middle" fontSize={12} fill="#374151">{(p.value*100).toFixed(2)}%</text> : null} /></Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          {/* ACOS */}
          <div className="bg-white rounded-lg border shadow mt-6 print:break-inside-avoid print:shadow-none print:border-none">
            <div className="p-4 border-b bg-gray-50 print:bg-white print:px-0"><h3 className="text-xl font-semibold">ACOS</h3></div>
            <div className="p-4 print:px-0">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="acos" name="ACOS" stroke={ACOS_COLOR} strokeWidth={3} dot={{r:4}}><LabelList dataKey="acos" position="top" content={(p:any) => p.value ? <text x={p.x} y={p.y-6} textAnchor="middle" fontSize={12} fill="#374151">{(p.value*100).toFixed(2)}%</text> : null} /></Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          
           {/* CPC */}
           <div className="bg-white rounded-lg border shadow mt-6 print:break-inside-avoid print:shadow-none print:border-none">
            <div className="p-4 border-b bg-gray-50 print:bg-white print:px-0"><h3 className="text-xl font-semibold">CPC</h3></div>
            <div className="p-4 print:px-0">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v)=>formatMoney(v, profile?.currencyCode)} />
                  <Legend />
                  <Line type="monotone" dataKey="cpc" name="CPC" stroke={CPC_COLOR} strokeWidth={3} dot={{r:4}}><LabelList dataKey="cpc" position="top" content={(p:any) => p.value ? <text x={p.x} y={p.y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(p.value, profile.currencyCode)}</text> : null} /></Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Image Upload Component */}
          <ImageUploadForPDF />

        </div>
      )}

      {/* Footer / Refresh */}
      <div className="mt-8 flex justify-end no-print">
        <button onClick={handleRefresh} disabled={hasPending || isRefreshing || !selectedPortfolio} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed shadow">{hasPending || isRefreshing ? 'Syncing...' : '🔄 Hard Refresh Data'}</button>
      </div>
    </div>
  );
}
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useEffect, useMemo, useState } from 'react';

// Recharts
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';

/** ================= CONSTANTS & STYLES ================= */
const CHART_MARGINS = { top: 32, right: 64, bottom: 40, left: 24 };
const SPEND_COLOR = '#f97316'; // orange-500
const SALES_COLOR = '#0ea5e9'; // sky-500
const CVR_COLOR = '#2563eb';   // blue-600
const ACOS_COLOR = '#16a34a';  // green-600
const CPC_COLOR = '#f59e0b';   // amber-500

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
      maximumFractionDigits: digits,
    }).format(amt);
  } catch {
    return `${amt.toFixed(digits)} ${currencyCode || ''}`;
  }
}
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** ================= MAIN COMPONENT ================= */
function ProfileDashboard() {
  const { profileId } = Route.useParams();
  
  // 1. Convex Data Hooks
  const profile = useQuery(api.profiles.getById, { profileId });
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('');
  
  // This Query is "Reactive". It will auto-update the UI when DB changes.
  const rawSnapshots = useQuery(api.amazonAds.getSnapshots, { 
    profileId, 
    portfolioId: selectedPortfolio || undefined 
  });

  // Actions / Mutations
  const fetchPortfolios = useAction(api.amazonAds.fetchPortfolios);
  const sync4Weeks = useAction(api.amazonAds.sync4Weeks);
  const pollPending = useAction(api.amazonAds.pollPendingSnapshots);
  const resetSnapshots = useMutation(api.amazonAds.resetSnapshots);

  // Local State
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 2. Load Portfolios on Mount
  useEffect(() => {
    const run = async () => {
      setLoadingPorts(true);
      const res = await fetchPortfolios({ profileId });
      if (res?.success) setPortfolios(res.portfolios || []);
      setLoadingPorts(false);
    };
    run();
  }, [profileId, fetchPortfolios]);

  // 3. Sync Trigger: When portfolio changes, ensure data exists or start fetching
  useEffect(() => {
    if (!selectedPortfolio) return;
    sync4Weeks({ profileId, portfolioId: selectedPortfolio });
  }, [profileId, selectedPortfolio, sync4Weeks]);

  // 4. Polling Logic: If any week is PENDING, poll Amazon every 5s
  const hasPending = useMemo(() => {
    return rawSnapshots?.some(s => s.status === 'PENDING' || s.status === 'INIT') ?? false;
  }, [rawSnapshots]);

  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      pollPending({ profileId });
    }, 5000);
    return () => clearInterval(interval);
  }, [hasPending, profileId, pollPending]);

  // 5. Data Preparation: Sort and Calculate
  const sortedWeeks = useMemo(() => {
    if (!rawSnapshots) return [];
    // Sort Oldest -> Newest
    return [...rawSnapshots].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [rawSnapshots]);

  const chartData = useMemo(() => {
    return sortedWeeks.map(w => {
      const d = w.data;
      const acos = d.sales > 0 ? d.spend / d.sales : 0;
      const cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
      const cvr = d.clicks > 0 ? d.orders / d.clicks : 0;
      
      // Return 0 for everything if it's not completed yet to prevent chart weirdness
      if (w.status !== 'COMPLETED') {
        return { label: w.label, spend: 0, ppcSales: 0, clicks: 0, impressions: 0, acos: 0, cpc: 0, cvr: 0 };
      }

      return {
        label: w.label,
        spend: d.spend,
        ppcSales: d.sales,
        clicks: d.clicks,
        impressions: d.impressions,
        acos,
        cpc,
        cvr,
      };
    });
  }, [sortedWeeks]);

  const allLoaded = sortedWeeks.length > 0 && !hasPending && sortedWeeks.every(s => s.status === 'COMPLETED');

  // 6. Refresh Handler
  const handleRefresh = async () => {
    if (!selectedPortfolio) return;
    if (window.confirm("Reload data from Amazon? This may take a few minutes.")) {
      setIsRefreshing(true);
      await resetSnapshots({ profileId, portfolioId: selectedPortfolio });
      await sync4Weeks({ profileId, portfolioId: selectedPortfolio });
      setIsRefreshing(false);
    }
  };

  if (!profile) return <div className="p-8">Loading profile...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/" className="text-blue-600 hover:underline text-sm mb-2 inline-block">
          ← Back to Profiles
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">{profile.accountName}</h1>
            <p className="text-gray-600 mt-1">
              {profile.accountType} • {profile.countryCode} • {profile.currencyCode}
              {profile.region && (
                <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                  {profile.region}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Portfolio Selector */}
      <div className="mb-6 bg-white rounded-lg border p-4">
        <label className="block text-sm font-semibold mb-2">Filter by Portfolio:</label>
        {loadingPorts ? (
          <p className="text-gray-500 text-sm">Loading portfolios...</p>
        ) : (
          <select
            value={selectedPortfolio}
            onChange={(e) => setSelectedPortfolio(e.target.value)}
            disabled={isRefreshing}
            className="w-full md:w-96 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">Select a Portfolio</option>
            {portfolios.map((p) => (
              <option key={p.portfolioId} value={p.portfolioId}>
                {p.name} ({p.state})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ==================== THE 4-WEEK TABLE (Restored) ==================== */}
      <div className="bg-white rounded-lg border shadow mb-8">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-semibold">Last 4 Weeks Performance</h2>
          {selectedPortfolio && sortedWeeks.length > 0 && hasPending && (
             <p className="text-xs text-blue-600 animate-pulse mt-1">
               Syncing latest reports from Amazon...
             </p>
          )}
        </div>

        {!selectedPortfolio ? (
          <div className="p-8 text-center text-gray-500">
            Please select a portfolio above to load data.
          </div>
        ) : sortedWeeks.length === 0 ? (
          <div className="p-8 text-center">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
             <p className="text-gray-500">Initializing database...</p>
          </div>
        ) : (
          <div className="p-6 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b bg-orange-50">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Metric</th>
                  {sortedWeeks.map((w) => (
                    <th key={w.label} className="text-right py-3 px-4 font-semibold text-gray-700">
                      {w.label}
                      <div className="text-xs text-gray-500">
                        {w.startDate} – {w.endDate}
                      </div>
                      {w.status !== 'COMPLETED' && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded ml-1">
                          LOADING
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Impressions */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Impressions</td>
                  {sortedWeeks.map(w => (
                    <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                       {w.status === 'COMPLETED' ? Number(w.data.impressions).toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
                {/* Clicks */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Clicks</td>
                  {sortedWeeks.map(w => (
                    <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                       {w.status === 'COMPLETED' ? Number(w.data.clicks).toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
                {/* PPC Spend */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">PPC Spend</td>
                  {sortedWeeks.map(w => (
                    <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                       {w.status === 'COMPLETED' ? formatMoney(w.data.spend, profile.currencyCode) : '-'}
                    </td>
                  ))}
                </tr>
                {/* PPC Sales */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">PPC Sales</td>
                  {sortedWeeks.map(w => (
                    <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                       {w.status === 'COMPLETED' ? formatMoney(w.data.sales, profile.currencyCode) : '-'}
                    </td>
                  ))}
                </tr>
                {/* PPC Orders */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">PPC Orders</td>
                  {sortedWeeks.map(w => (
                    <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                       {w.status === 'COMPLETED' ? Number(w.data.orders).toLocaleString() : '-'}
                    </td>
                  ))}
                </tr>
                {/* ACOS */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">ACOS</td>
                  {sortedWeeks.map(w => {
                     const val = w.data.sales > 0 ? w.data.spend / w.data.sales : 0;
                     return (
                      <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                        {w.status === 'COMPLETED' ? pct(val) : '-'}
                      </td>
                     );
                  })}
                </tr>
                {/* CPC */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Cost per Click</td>
                  {sortedWeeks.map(w => {
                     const val = w.data.clicks > 0 ? w.data.spend / w.data.clicks : 0;
                     return (
                      <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                        {w.status === 'COMPLETED' ? formatMoney(val, profile.currencyCode) : '-'}
                      </td>
                     );
                  })}
                </tr>
                {/* CTR (Calculated) */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Click Through Rate</td>
                  {sortedWeeks.map(w => {
                     const val = w.data.impressions > 0 ? w.data.clicks / w.data.impressions : 0;
                     return (
                      <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                        {w.status === 'COMPLETED' ? pct(val) : '-'}
                      </td>
                     );
                  })}
                </tr>
                {/* CVR */}
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50 font-medium">Conversion Rate</td>
                  {sortedWeeks.map(w => {
                     const val = w.data.clicks > 0 ? w.data.orders / w.data.clicks : 0;
                     return (
                      <td key={w._id} className="py-3 px-4 text-right text-lg font-bold">
                        {w.status === 'COMPLETED' ? pct(val) : '-'}
                      </td>
                     );
                  })}
                </tr>
              </tbody>
            </table>
            
            <div className="mt-4 pt-4 border-t text-sm text-gray-500">
               {allLoaded ? (
                 <p className="flex items-center text-green-600">
                   <span className="mr-2">✅</span> All reports downloaded and cached.
                 </p>
               ) : (
                 <p className="flex items-center text-blue-600">
                   <span className="animate-spin h-3 w-3 border-b-2 border-blue-600 rounded-full mr-2"></span>
                   We are polling Amazon and filling each column as soon as it’s ready...
                 </p>
               )}
            </div>
          </div>
        )}
      </div>

      {/* ==================== CHARTS (Restored) ==================== */}
      {/* Only show charts if we have at least one completed week to prevent empty graphs */}
      {sortedWeeks.some(w => w.status === 'COMPLETED') && (
        <div className="mt-8 space-y-8">
          
          {/* 1) PPC Spend vs PPC Sales */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">PPC Spend vs PPC Sales</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartData} barCategoryGap={24} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v) => formatMoney(v, profile?.currencyCode, 0)} />
                  <Tooltip formatter={(v:number) => formatMoney(v, profile?.currencyCode)} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 8 }} />
                  <Bar dataKey="ppcSales" name="PPC Sales" fill={SALES_COLOR} radius={[6,6,0,0]}>
                    <LabelList dataKey="ppcSales" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x+p.width/2} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(value, profile.currencyCode, 0)}</text> : null;
                    }} />
                  </Bar>
                  <Bar dataKey="spend" name="PPC Spend" fill={SPEND_COLOR} radius={[6,6,0,0]}>
                    <LabelList dataKey="spend" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x+p.width/2} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(value, profile.currencyCode, 0)}</text> : null;
                    }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 2) Conversion Rate */}
          <div className="bg-white rounded-lg border shadow mt-6">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Conversion Rate</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} />
                  <Tooltip formatter={(v:number)=>`${(v*100).toFixed(2)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="cvr" name="Conversion Rate" stroke={CVR_COLOR} strokeWidth={3} dot={{r:4}}>
                     <LabelList dataKey="cvr" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{(value*100).toFixed(2)}%</text> : null;
                    }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3) ACOS */}
          <div className="bg-white rounded-lg border shadow mt-6">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">ACOS</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} />
                  <Tooltip formatter={(v:number)=>`${(v*100).toFixed(2)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="acos" name="ACOS" stroke={ACOS_COLOR} strokeWidth={3} dot={{r:4}}>
                    <LabelList dataKey="acos" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{(value*100).toFixed(2)}%</text> : null;
                    }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4) CPC */}
          <div className="bg-white rounded-lg border shadow mt-6">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Cost per Click</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v)=>formatMoney(v, profile?.currencyCode)} />
                  <Tooltip formatter={(v:number)=>formatMoney(v, profile?.currencyCode)} />
                  <Legend />
                  <Line type="monotone" dataKey="cpc" name="CPC" stroke={CPC_COLOR} strokeWidth={3} dot={{r:4}}>
                     <LabelList dataKey="cpc" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(value, profile.currencyCode)}</text> : null;
                    }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 5) Impressions */}
          <div className="bg-white rounded-lg border shadow mt-6">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Impressions</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} barSize={36} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v)=>Number(v).toLocaleString()} />
                  <Tooltip formatter={(v:number)=>Number(v).toLocaleString()} />
                  <Legend />
                  <Bar dataKey="impressions" name="Impressions" fill="#6b7280" radius={[6,6,0,0]}>
                     <LabelList dataKey="impressions" position="top" content={(p:any) => {
                         const { x, y, value } = p;
                         return value ? <text x={x+p.width/2} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{Number(value).toLocaleString()}</text> : null;
                    }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}

      {/* Footer / Refresh */}
      <div className="mt-8 flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={hasPending || isRefreshing || !selectedPortfolio}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed shadow"
        >
          {hasPending || isRefreshing ? 'Syncing...' : '🔄 Hard Refresh Data'}
        </button>
      </div>
    </div>
  );
}
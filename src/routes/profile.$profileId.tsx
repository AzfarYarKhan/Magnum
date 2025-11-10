// app/routes/profile.$profileId.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/profile/$profileId')({
  component: ProfileDashboard,
})

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

type ReportTypes = 'sp' | 'sb' | 'sd';
type WeekRow = {
  label: string;
  startDate: string;
  endDate: string;
  // report IDs that are still pending for this week
  reports: Partial<Record<ReportTypes, string>>;
  // live running totals (sum of SP + SB, SD if present)
  impressions: number;
  clicks: number;
  spend: number;     // MAJOR units (matches account currency)
  ppcSales: number;  // MAJOR units
  ppcOrders: number;
  // optional
  campaignCount?: number;
  activeCampaignCount?: number;
};

function ProfileDashboard() {
  const { profileId } = Route.useParams();
  const profile = useQuery(api.profiles.getById, { profileId });

  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('');

  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [portfoliosLoading, setPortfoliosLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Requesting report from Amazon...');

  const fetchPortfolios = useAction(api.amazonAds.fetchPortfolios);
  const createFourWeekReports = useAction(api.amazonAds.createFourWeekReports);
  const checkAndDownloadReports = useAction(api.amazonAds.checkAndDownloadReports);

  // Load portfolios on mount / profile change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPortfoliosLoading(true);
      try {
        const res = await fetchPortfolios({ profileId });
        if (!cancelled && res?.success) setPortfolios(res.portfolios || []);
      } finally {
        if (!cancelled) setPortfoliosLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, fetchPortfolios]);

  // Helper: are there any pending reports left?
  const hasPending = (arr: WeekRow[] | null) =>
    !!arr?.some(w => !!(w.reports.sp || w.reports.sb || w.reports.sd));

  // Start the flow: create all reports for the last 4 weeks
  const startFlow = async () => {
    setLoading(true);
    setLoadingMessage('Creating reports…');
    setWeeks(null);

    try {
      const created = await createFourWeekReports({
        profileId,
        portfolioId: selectedPortfolio || undefined,
      });

      if (!created?.success) {
        setWeeks([]);
        setLoading(false);
        setLoadingMessage('');
        return;
      }

      const initial: WeekRow[] = (created.weeks || []).map((w: any) => ({
        label: w.label,
        startDate: w.startDate,
        endDate: w.endDate,
        reports: { ...w.reports }, // sp/sb(/sd) reportIds
        impressions: 0,
        clicks: 0,
        spend: 0,
        ppcSales: 0,
        ppcOrders: 0,
        campaignCount: w.campaignCount,
        activeCampaignCount: w.activeCampaignCount,
      }));

      setWeeks(initial);
      // polling is handled by the effect below (which watches `weeks` & `loading`)
    } catch (e) {
      console.error(e);
      setWeeks([]);
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Kick off flow on portfolio/profile change
  useEffect(() => {
    startFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, selectedPortfolio]);

  // 🔁 Polling effect: while loading & there are any pending report IDs, poll every 4s
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    // Only run while loading and we still have pending reports
    if (!loading || !weeks || !hasPending(weeks)) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (loading && weeks && !hasPending(weeks)) {
        // finished
        setLoading(false);
        setLoadingMessage('');
      }
      return;
    }

    setLoadingMessage('Waiting for Amazon to finish reports…');

    const tick = async () => {
      // Build the list of ONLY pending report IDs from *current* weeks state
      const entries: { reportId: string; type: ReportTypes }[] = [];
      for (const w of weeks) {
        if (w.reports.sp) entries.push({ reportId: w.reports.sp, type: 'sp' });
        if (w.reports.sb) entries.push({ reportId: w.reports.sb, type: 'sb' });
        if (w.reports.sd) entries.push({ reportId: w.reports.sd, type: 'sd' });
      }
      if (entries.length === 0) return;

      try {
        const res = await checkAndDownloadReports({
          profileId,
          portfolioId: selectedPortfolio || undefined,
          entries,
        });

        if (!res?.success || !Array.isArray(res.results)) return;

        // Merge results back into state:
        // - Add totals for any DOWNLOADED report
        // - Remove its reportId from the owning week's pending set
        setWeeks(prev => {
          if (!prev) return prev;
          const next = prev.map(w => ({ ...w, reports: { ...w.reports } }));

          for (const r of res.results) {
            // statuses: IN_PROGRESS / PENDING / PROCESSING / CREATED / DOWNLOADED / FAILURE / etc.
            if (r.status !== 'DOWNLOADED' || !r.totals) continue;

            const owner = next.find(w =>
              w.reports.sp === r.reportId || w.reports.sb === r.reportId || w.reports.sd === r.reportId
            );
            if (!owner) continue;

            owner.impressions += Number(r.totals.impressions || 0);
            owner.clicks      += Number(r.totals.clicks || 0);
            owner.spend       += Number(r.totals.cost || 0);     // MAJOR units
            owner.ppcSales    += Number(r.totals.sales || 0);    // MAJOR units
            owner.ppcOrders   += Number(r.totals.orders || 0);

            if (owner.reports.sp === r.reportId) delete owner.reports.sp;
            if (owner.reports.sb === r.reportId) delete owner.reports.sb;
            if (owner.reports.sd === r.reportId) delete owner.reports.sd;
          }
          return next;
        });
      } catch (e) {
        // swallow and keep polling; next ticks will try again
        console.warn('Polling error:', (e as any)?.message || e);
      }
    };

    // Start interval
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(tick, 4000);
    // Also fire immediately once
    tick();

    // Cleanup
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [loading, weeks, profileId, selectedPortfolio, checkAndDownloadReports]);

  // Progress wording
  useEffect(() => {
    if (!loading) return;
    const msgs = [
      'Creating reports…',
      'Waiting for Amazon…',
      'Processing data…',
      'Almost there…',
      'Finalizing…',
    ];
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % msgs.length;
      setLoadingMessage(msgs[i]);
    }, 4000);
    return () => clearInterval(t);
  }, [loading]);

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
        {portfoliosLoading ? (
          <p className="text-gray-500 text-sm">Loading portfolios...</p>
        ) : (
          <select
            value={selectedPortfolio}
            onChange={(e) => setSelectedPortfolio(e.target.value)}
            disabled={loading}
            className="w-full md:w-96 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">All Portfolios (Account Level)</option>
            {portfolios.map((p) => (
              <option key={p.portfolioId} value={p.portfolioId}>
                {p.name} ({p.state})
              </option>
            ))}
          </select>
        )}
        {portfolios.length === 0 && !portfoliosLoading && (
          <p className="text-sm text-gray-500 mt-2">No portfolios found for this profile.</p>
        )}
      </div>

      {/* Four-Week Grid */}
      <div className="bg-white rounded-lg border shadow">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-semibold">Last 4 Weeks Performance</h2>
          {selectedPortfolio ? (
            <p className="text-sm text-gray-600 mt-1">
              Showing data for: {portfolios.find(p => p.portfolioId === selectedPortfolio)?.name}
            </p>
          ) : (
            <p className="text-sm text-gray-600 mt-1">Showing data for entire account</p>
          )}
          {loading && <p className="text-xs text-gray-500 mt-1">{loadingMessage}</p>}
        </div>

        {!weeks ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-700 font-medium">{loadingMessage}</p>
            <p className="text-sm text-gray-500 mt-2">We’ll update each column as its reports finish…</p>
          </div>
        ) : weeks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No data.</div>
        ) : (
          <div className="p-6 overflow-x-auto">
          <table className="w-full min-w-[820px]">
  <thead>
    <tr className="border-b bg-orange-100">
      {/* left header cell */}
      <th className="text-left py-3 px-4 font-semibold text-orange-900 bg-orange-100">
        Metric
      </th>

      {/* week headers */}
      {weeks.map((w) => (
        <th
          key={w.label}
          className="text-right py-3 px-4 font-semibold text-orange-900 bg-orange-100"
        >
          {w.label}
          <div className="text-xs text-gray-700">{w.startDate} – {w.endDate}</div>
        </th>
      ))}
    </tr>
  </thead>

  <tbody>
    {/* IMPRESSIONS */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        Impressions
      </td>
      {weeks.map(w => (
        <td key={w.label + '-imp'} className="py-3 px-4 text-right text-lg font-bold">
          {Number(w.impressions || 0).toLocaleString()}
        </td>
      ))}
    </tr>

    {/* CLICKS */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        Clicks
      </td>
      {weeks.map(w => (
        <td key={w.label + '-clk'} className="py-3 px-4 text-right text-lg font-bold">
          {Number(w.clicks || 0).toLocaleString()}
        </td>
      ))}
    </tr>

    {/* PPC SPEND */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        PPC Spend
      </td>
      {weeks.map(w => (
        <td key={w.label + '-spend'} className="py-3 px-4 text-right text-lg font-bold">
          {formatMoney(w.spend || 0, profile?.currencyCode, 2)}
        </td>
      ))}
    </tr>

    {/* PPC SALES */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        PPC Sales
      </td>
      {weeks.map(w => (
        <td key={w.label + '-sales'} className="py-3 px-4 text-right text-lg font-bold">
          {formatMoney(w.ppcSales || 0, profile?.currencyCode, 2)}
        </td>
      ))}
    </tr>

    {/* PPC ORDERS */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        PPC Orders
      </td>
      {weeks.map(w => (
        <td key={w.label + '-orders'} className="py-3 px-4 text-right text-lg font-bold">
          {Number(w.ppcOrders || 0).toLocaleString()}
        </td>
      ))}
    </tr>

    {/* ACOS */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        ACOS
      </td>
      {weeks.map(w => {
        const acos = w.ppcSales > 0 ? w.spend / w.ppcSales : 0;
        return (
          <td key={w.label + '-acos'} className="py-3 px-4 text-right text-lg font-bold">
            {pct(acos)}
          </td>
        );
      })}
    </tr>

    {/* CPC */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        Cost per Click
      </td>
      {weeks.map(w => {
        const cpc = w.clicks > 0 ? w.spend / w.clicks : 0;
        return (
          <td key={w.label + '-cpc'} className="py-3 px-4 text-right text-lg font-bold">
            {formatMoney(cpc, profile?.currencyCode, 2)}
          </td>
        );
      })}
    </tr>

    {/* CTR */}
    <tr className="border-b hover:bg-gray-50">
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        Click Through Rate
      </td>
      {weeks.map(w => {
        const ctr = w.impressions > 0 ? w.clicks / w.impressions : 0;
        return (
          <td key={w.label + '-ctr'} className="py-3 px-4 text-right text-lg font-bold">
            {pct(ctr)}
          </td>
        );
      })}
    </tr>

    {/* CONVERSION RATE */}
    <tr>
      <td className="py-3 px-4 font-semibold text-orange-900 bg-orange-50">
        Conversion Rate
      </td>
      {weeks.map(w => {
        const cvr = w.clicks > 0 ? w.ppcOrders / w.clicks : 0;
        return (
          <td key={w.label + '-cvr'} className="py-3 px-4 text-right text-lg font-bold">
            {pct(cvr)}
          </td>
        );
      })}
    </tr>
  </tbody>
</table>


            <div className="mt-4 pt-4 border-t text-sm text-gray-500">
              <p>✅ Reports are created instantly; we poll Amazon and fill each column as soon as it’s ready.</p>
            </div>
          </div>
        )}
      </div>

      {/* Refresh Button */}
      <div className="mt-4">
        <button
          onClick={() => startFlow()}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Working…' : '🔄 Refresh Data'}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Uses major units and your account currency ({profile?.currencyCode}).
        </p>
      </div>
    </div>
  );
}

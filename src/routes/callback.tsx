import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/callback')({
  component: Callback,
})

function Callback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [refreshToken, setRefreshToken] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  
  const processCallback = useAction(api.amazonAds.processOAuthCallback);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state') as 'NA' | 'EU' | 'FE' || 'NA'; // Region from state

    if (!code) {
      setStatus('error');
      setError('No authorization code received from Amazon');
      return;
    }

    setRegion(state);
    handleCallback(code, state);
  }, []);

  const handleCallback = async (code: string, region: 'NA' | 'EU' | 'FE') => {
    try {
      console.log(`Processing callback for ${region} region...`);
      
      const result = await processCallback({ code, region });
      
      if (result.success) {
        setProfiles(result.profiles || []);
        setRefreshToken(result.refreshToken || '');
        setStatus('success');
      } else {
        setStatus('error');
        setError(result.error || 'Unknown error occurred');
      }
    } catch (err: any) {
      console.error("Error calling Convex action:", err);
      setStatus('error');
      setError(err.message || 'Failed to process authorization');
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Amazon Ads Authorization</h1>

      {status === 'loading' && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-blue-800">Processing authorization for {region} region...</p>
          <p className="text-sm text-blue-600 mt-2">Please wait, this may take a few seconds.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <p className="font-semibold text-red-800">Error:</p>
          <p className="text-red-700 mt-2">{error}</p>
          <div className="mt-4">
            <Link to="/auth" className="text-blue-600 hover:underline">
              ← Try authorization again
            </Link>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded">
            <p className="font-semibold text-green-800 mb-2">✅ Authorization Successful for {region}!</p>
            <p className="text-sm text-green-700">
              Found {profiles.length} profile(s) in this region and saved them to your dashboard.
            </p>
          </div>

          {refreshToken && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
              <p className="font-semibold mb-2">🔑 Important: Save Your {region} Refresh Token</p>
              <p className="text-sm mb-2">Add this to your Convex environment:</p>
              <div className="bg-white p-3 rounded border">
                <code className="text-xs break-all">{refreshToken}</code>
              </div>
              <pre className="bg-white p-3 rounded border mt-2 text-xs overflow-x-auto">
npx convex env set AMAZON_REFRESH_TOKEN_{region} {refreshToken}
              </pre>
            </div>
          )}

          {profiles.length > 0 && (
            <div className="bg-gray-50 p-4 rounded border">
              <h3 className="font-semibold mb-3">Profiles Added from {region}:</h3>
              <div className="space-y-2">
                {profiles.map((profile: any, index: number) => (
                  <div key={index} className="bg-white p-3 rounded border">
                    <p className="font-semibold">{profile.accountName}</p>
                    <p className="text-sm text-gray-600">
                      {profile.accountType} • {profile.countryCode}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => navigate({ to: '/' })}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Go to Dashboard
            </button>
            <Link
              to="/auth"
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Authorize Another Region
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
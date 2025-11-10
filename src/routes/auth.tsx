import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/auth')({
  component: AuthSetup,
})

function AuthSetup() {
  const [selectedRegion, setSelectedRegion] = useState<'NA' | 'EU' | 'FE'>('NA');
  
  const clientId = import.meta.env.VITE_AMAZON_CLIENT_ID;
  const redirectUri = "http://localhost:3000/callback";
  
  if (!clientId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="font-semibold text-red-800 mb-2">⚠️ Configuration Error</p>
          <p className="text-sm text-red-700">
            Missing VITE_AMAZON_CLIENT_ID in environment variables. Please add it to your .env.local file.
          </p>
        </div>
      </div>
    );
  }
  
  const regionConfig = {
    NA: {
      name: "North America",
      authUrl: "https://www.amazon.com/ap/oa",
      tokenUrl: "https://api.amazon.com/auth/o2/token",
      apiUrl: "https://advertising-api.amazon.com",
      countries: "US, CA, MX, BR",
    },
    EU: {
      name: "Europe",
      authUrl: "https://www.amazon.co.uk/ap/oa",
      tokenUrl: "https://api.amazon.co.uk/auth/o2/token",
      apiUrl: "https://advertising-api-eu.amazon.com",
      countries: "UK, DE, FR, IT, ES, NL, etc.",
    },
    FE: {
      name: "Far East",
      authUrl: "https://www.amazon.co.jp/ap/oa",
      tokenUrl: "https://api.amazon.co.jp/auth/o2/token",
      apiUrl: "https://advertising-api-fe.amazon.com",
      countries: "JP, AU, IN, SG",
    },
  };

  const config = regionConfig[selectedRegion];
  
  const authUrl = `${config.authUrl}?client_id=${clientId}&scope=advertising::campaign_management&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${selectedRegion}`;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Amazon Ads API Setup</h1>
      
      <div className="bg-blue-50 border border-blue-200 p-4 rounded mb-6">
        <p className="font-semibold mb-2">📍 Multi-Region Authorization</p>
        <p className="text-sm">
          Amazon Ads has separate regions. You need to authorize separately for each region where you have profiles.
        </p>
      </div>

      {/* Region Selector */}
      <div className="mb-6">
        <label className="block font-semibold mb-3">Select Region:</label>
        <div className="space-y-2">
          {(Object.keys(regionConfig) as Array<'NA' | 'EU' | 'FE'>).map((region) => (
            <label
              key={region}
              className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition ${
                selectedRegion === region
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="region"
                value={region}
                checked={selectedRegion === region}
                onChange={(e) => setSelectedRegion(e.target.value as 'NA' | 'EU' | 'FE')}
                className="mt-1 mr-3"
              />
              <div className="flex-1">
                <div className="font-semibold">
                  {regionConfig[region].name} ({region})
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  Countries: {regionConfig[region].countries}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 p-4 rounded mb-6">
        <p className="font-semibold mb-2">⚠️ Before you authorize {config.name}:</p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Make sure <code className="bg-gray-100 px-1">http://localhost:3000/callback</code> is in your Amazon app settings</li>
          <li>You may need to authorize each region separately if you have profiles in multiple regions</li>
        </ol>
      </div>

      <div className="space-y-4">
        <a
          href={authUrl}
          className="inline-block px-6 py-3 bg-orange-500 text-white font-semibold rounded hover:bg-orange-600"
        >
          Authorize {config.name} Region
        </a>

        <div className="text-sm text-gray-600 mt-4">
          <p><strong>Selected Region:</strong> {config.name}</p>
          <p><strong>Auth Endpoint:</strong> {config.tokenUrl}</p>
          <p><strong>API Endpoint:</strong> {config.apiUrl}</p>
        </div>
      </div>
    </div>
  );
}
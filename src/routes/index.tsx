import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  component: ProfilesList,
})

function ProfilesList() {
  const profiles = useQuery(api.profiles.list);

  if (!profiles) return <div className="p-8">Loading profiles...</div>;

  // Add some debugging
  console.log('Total profiles loaded:', profiles.length);
  console.log('Profiles:', profiles.map(p => p.accountName));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Client Profiles</h1>
          <p className="text-gray-600 mt-1">
            {profiles.length} profile(s) • Select a profile to view campaigns
          </p>
        </div>
        <Link
          to="/auth"
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
        >
          Re-authorize
        </Link>
      </div>

      {profiles.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600 mb-4">No profiles found. Please authorize your Amazon Ads account.</p>
          <Link
            to="/auth"
            className="inline-block px-6 py-3 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Authorize Now
          </Link>
        </div>
      ) : (
        <>
          {/* Search/Filter Box */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search profiles..."
              onChange={(e) => {
                const search = e.target.value.toLowerCase();
                const cards = document.querySelectorAll('[data-profile-name]');
                cards.forEach((card) => {
                  const name = card.getAttribute('data-profile-name')?.toLowerCase() || '';
                  if (name.includes(search)) {
                    (card as HTMLElement).style.display = 'block';
                  } else {
                    (card as HTMLElement).style.display = 'none';
                  }
                });
              }}
              className="w-full md:w-96 px-4 py-2 border rounded-lg"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <Link
                key={profile._id}
                to="/profile/$profileId"
                params={{ profileId: profile.profileId }}
                data-profile-name={profile.accountName}
                className="block p-6 bg-white border rounded-lg hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <h2 className="text-xl font-semibold">{profile.accountName}</h2>
                  <span className={`px-2 py-1 text-xs rounded ${
                    profile.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {profile.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="space-y-1 text-sm text-gray-600">
                  <p><span className="font-medium">Type:</span> {profile.accountType}</p>
                  <p><span className="font-medium">Market:</span> {profile.countryCode}</p>
                  <p><span className="font-medium">Currency:</span> {profile.currencyCode}</p>
                  <p className="text-xs text-gray-400 mt-2">ID: {profile.profileId}</p>
                </div>

                <div className="mt-4 text-blue-600 text-sm font-medium">
                  View Performance →
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

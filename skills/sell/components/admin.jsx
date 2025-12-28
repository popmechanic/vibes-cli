// Admin Dashboard Components
// Injected into unified.html by assemble-sell.js
// Uses CONFIG object and CSS variables for theming

// === Subscription Badge Component ===
function SubscriptionBadge({ status }) {
  const badges = {
    active: { bg: 'bg-green-500/20', text: 'text-green-600', label: 'Subscribed' },
    trial: { bg: 'bg-yellow-500/20', text: 'text-yellow-600', label: 'Trial' },
    past_due: { bg: 'bg-red-500/20', text: 'text-red-600', label: 'Past Due' },
    canceled: { bg: 'bg-gray-500/20', text: 'text-gray-600', label: 'Canceled' },
  };
  const badge = badges[status] || { bg: 'bg-blue-500/20', text: 'text-blue-600', label: 'Free' };

  return (
    <span className={`px-2 py-1 rounded text-xs font-bold ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  );
}

// === Admin Dashboard ===
function AdminDashboard() {
  const [tenants, setTenants] = useState([]);
  const [stats, setStats] = useState({
    tenantCount: 0,
    userCount: 0,
    subscriberCount: 0,
    mrr: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const { user } = useUser();

  // SECURITY: Do NOT add fallbacks like "|| CONFIG.adminUserIds.length === 0"
  // Empty admin list means NO admin access, not everyone is admin
  const isAdmin = CONFIG.adminUserIds.includes(user?.id);

  // Fetch tenants and stats from worker API
  useEffect(() => {
    if (!isAdmin) return;

    async function fetchData() {
      try {
        // Fetch tenants and stats in parallel
        const [tenantsRes, statsRes] = await Promise.all([
          fetch(`https://${CONFIG.domain}/api/tenants`),
          fetch(`https://${CONFIG.domain}/api/stats`)
        ]);

        if (!tenantsRes.ok) throw new Error('Failed to fetch tenants');
        const tenantsData = await tenantsRes.json();
        setTenants(tenantsData.tenants || []);

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(prev => ({ ...prev, ...statsData }));
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--admin-bg)] p-4">
        <div className="max-w-md text-center p-8 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[8px_8px_0px_var(--admin-shadow)]">
          <h2 className="text-2xl font-bold mb-4 text-[var(--admin-text)]">Access Denied</h2>
          <p className="text-[var(--admin-text-muted)] mb-4">You don't have admin permissions.</p>
          <p className="text-sm text-[var(--admin-text-muted)]">Your user ID: {user?.id}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--admin-bg)]">
        <div className="animate-pulse text-lg font-bold text-[var(--admin-text)]">Loading dashboard...</div>
      </div>
    );
  }

  // Filter tenants by subscription status
  const subscribedTenants = tenants.filter(t => t.subscriptionStatus === 'active');
  const trialTenants = tenants.filter(t => !t.subscriptionStatus || t.subscriptionStatus === 'trial');
  const activeTenants = tenants.filter(t => t.status === 'active').length;

  // Calculate MRR from tenants if not from stats
  const monthlyPriceNum = parseInt(String(CONFIG.pricing.monthly).replace(/\D/g, '') || '9');
  const calculatedMRR = stats.mrr || (subscribedTenants.length * monthlyPriceNum);

  return (
    <div className="min-h-screen bg-[var(--admin-bg)] p-4">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--admin-text)]">{CONFIG.appTitle} Admin</h1>
          <UserButton />
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border-4 border-red-500 text-red-700">
            Error: {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          {['overview', 'tenants', 'billing'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-bold border-4 border-[var(--admin-border)] transition-all capitalize ${
                activeTab === tab
                  ? 'bg-[var(--admin-border)] text-[var(--admin-card-bg)] shadow-none'
                  : 'bg-[var(--admin-card-bg)] text-[var(--admin-text)] shadow-[4px_4px_0px_var(--admin-shadow)] hover:shadow-[2px_2px_0px_var(--admin-shadow)] hover:translate-x-[2px] hover:translate-y-[2px]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            <div className="grid md:grid-cols-4 gap-6 mb-8">
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-shadow)]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">TOTAL TENANTS</h3>
                <p className="text-4xl font-bold text-[var(--admin-text)]">{tenants.length}</p>
              </div>
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_#3b82f6]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">TOTAL USERS</h3>
                <p className="text-4xl font-bold text-blue-600">{stats.userCount}</p>
              </div>
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-accent)]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">SUBSCRIBERS</h3>
                <p className="text-4xl font-bold text-green-600">{stats.subscriberCount || subscribedTenants.length}</p>
              </div>
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_#f59e0b]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">MONTHLY REVENUE</h3>
                <p className="text-4xl font-bold text-amber-600">${calculatedMRR}</p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-shadow)] p-6">
                <h3 className="font-bold mb-4 text-[var(--admin-text)]">Recent Activity</h3>
                <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
                  <p>• {activeTenants} active tenants</p>
                  <p>• {tenants.length - activeTenants} pending setup</p>
                  <p>• {trialTenants.length} on trial/free</p>
                </div>
              </div>
              <div className="bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-shadow)] p-6">
                <h3 className="font-bold mb-4 text-[var(--admin-text)]">Subscription Breakdown</h3>
                <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
                  <p>• {subscribedTenants.length} paid subscribers</p>
                  <p>• {tenants.filter(t => t.subscriptionStatus === 'past_due').length} past due</p>
                  <p>• {tenants.filter(t => t.subscriptionStatus === 'canceled').length} canceled</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Tenants Tab */}
        {activeTab === 'tenants' && (
          <div className="bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[8px_8px_0px_var(--admin-shadow)]">
            <div className="p-4 border-b-4 border-[var(--admin-border)] bg-[var(--admin-bg)]">
              <h2 className="text-xl font-bold text-[var(--admin-text)]">All Tenants ({tenants.length})</h2>
            </div>
            <div className="divide-y-2 divide-gray-200">
              {tenants.length === 0 ? (
                <div className="p-8 text-center text-[var(--admin-text-muted)]">No tenants yet</div>
              ) : (
                tenants.map(tenant => (
                  <div key={tenant.subdomain || tenant.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      {tenant.imageUrl && (
                        <img src={tenant.imageUrl} alt="" className="w-10 h-10 rounded-full border-2 border-[var(--admin-border)]" />
                      )}
                      <div>
                        <p className="font-bold text-[var(--admin-text)]">{tenant.subdomain}.{CONFIG.domain}</p>
                        <p className="text-sm text-[var(--admin-text-muted)]">{tenant.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <SubscriptionBadge status={tenant.subscriptionStatus} />
                      <span className={`px-3 py-1 text-sm font-bold ${
                        tenant.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {tenant.status}
                      </span>
                      <span className="text-sm text-[var(--admin-text-muted)]">{tenant.plan}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <>
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-accent)]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">ACTIVE SUBSCRIPTIONS</h3>
                <p className="text-4xl font-bold text-green-600">{subscribedTenants.length}</p>
              </div>
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_#f59e0b]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">TRIAL/FREE</h3>
                <p className="text-4xl font-bold text-amber-600">{trialTenants.length}</p>
              </div>
              <div className="p-6 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-shadow)]">
                <h3 className="text-sm font-bold text-[var(--admin-text-muted)] mb-2">MRR</h3>
                <p className="text-4xl font-bold text-[var(--admin-text)]">${calculatedMRR}</p>
              </div>
            </div>

            {/* Plan Configuration */}
            <div className="bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[6px_6px_0px_var(--admin-shadow)] p-6 mb-6">
              <h3 className="font-bold mb-4 text-[var(--admin-text)]">Plan Configuration</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 bg-[var(--admin-bg)] border-2 border-[var(--admin-border)]">
                  <p className="font-bold text-[var(--admin-text)]">Monthly Plan</p>
                  <p className="text-2xl font-bold text-[var(--admin-text)]">{CONFIG.pricing.monthly}<span className="text-sm font-normal text-[var(--admin-text-muted)]">/month</span></p>
                </div>
                <div className="p-4 bg-[var(--admin-bg)] border-2 border-[var(--admin-border)]">
                  <p className="font-bold text-[var(--admin-text)]">Yearly Plan</p>
                  <p className="text-2xl font-bold text-[var(--admin-text)]">{CONFIG.pricing.yearly}<span className="text-sm font-normal text-[var(--admin-text-muted)]">/year</span></p>
                </div>
              </div>
            </div>

            {/* Subscribers List */}
            <div className="bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[8px_8px_0px_var(--admin-shadow)]">
              <div className="p-4 border-b-4 border-[var(--admin-border)] bg-[var(--admin-bg)]">
                <h2 className="text-xl font-bold text-[var(--admin-text)]">Subscribers ({subscribedTenants.length})</h2>
              </div>
              <div className="divide-y-2 divide-gray-200">
                {subscribedTenants.length === 0 ? (
                  <div className="p-8 text-center text-[var(--admin-text-muted)]">
                    <p className="mb-4">No subscribers yet</p>
                    <p className="text-sm">
                      Set up <a href="https://clerk.com/docs/billing" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Clerk Billing</a> to start accepting payments.
                    </p>
                  </div>
                ) : (
                  subscribedTenants.map(tenant => (
                    <div key={tenant.subdomain || tenant.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                      <div>
                        <p className="font-bold text-[var(--admin-text)]">{tenant.subdomain}.{CONFIG.domain}</p>
                        <p className="text-sm text-[var(--admin-text-muted)]">{tenant.email}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-[var(--admin-text-muted)]">
                          {tenant.billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}
                        </span>
                        <SubscriptionBadge status={tenant.subscriptionStatus} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// === Admin App Wrapper ===
function AdminApp() {
  return (
    <ClerkProvider publishableKey={CONFIG.clerkPublishableKey} afterSignOutUrl={`https://${CONFIG.domain}`}>
      <SignedIn>
        <AdminDashboard />
      </SignedIn>
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-[var(--admin-bg)] p-4">
          <div className="max-w-md text-center p-8 bg-[var(--admin-card-bg)] border-4 border-[var(--admin-border)] shadow-[8px_8px_0px_var(--admin-shadow)]">
            <h2 className="text-2xl font-bold mb-4 text-[var(--admin-text)]">Admin Login</h2>
            <p className="mb-6 text-[var(--admin-text-muted)]">Sign in to access the admin dashboard.</p>
            <SignInButton mode="modal">
              <button className="px-6 py-3 bg-[var(--admin-border)] text-[var(--admin-card-bg)] font-bold border-4 border-[var(--admin-border)] hover:opacity-90 transition-opacity">
                Sign In
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
    </ClerkProvider>
  );
}

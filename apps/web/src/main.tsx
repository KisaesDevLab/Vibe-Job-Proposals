import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import './index.css';
import './lib/prefs'; // apply saved font-size + wide-mode before first paint
import { AuthProvider } from './lib/auth';
import { api, ApiError } from './lib/api';
import { toast } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { PublicUploadPage } from './pages/PublicUpload';
import { TimePage } from './pages/Time';
import { ExpensesPage } from './pages/Expenses';
import { InvoicesPage } from './pages/Invoices';
import { InvoiceDetailPage } from './pages/InvoiceDetail';
import { InvoiceSummaryDetailPage } from './pages/InvoiceSummaryDetail';
import { JobsPage } from './pages/Jobs';
import { CustomersPage } from './pages/Customers';
import { EmployeesPage } from './pages/Employees';
import { ReportsPage } from './pages/Reports';
import { ReadinessPage } from './pages/Readiness';
import { ImportPage } from './pages/Import';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';

// When any query or mutation hits a 401, the session has expired. Clear the
// cache and bounce to /login so the user isn't stuck clicking Save on a dead
// session and seeing the same auth toast every time. The check happens once
// here rather than in every onError handler.
function handleAuthError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    queryClient.clear();
    toast('Session expired — please sign in again', 'err');
    // setTimeout defers the navigation until after the current event handlers
    // unwind so React isn't mid-render.
    setTimeout(() => { window.location.assign('/login'); }, 0);
    return true;
  }
  return false;
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  // Queries rarely define their own onError, so a non-401 failure would
  // otherwise show as an endless skeleton / empty table. Surface it once here.
  // (401s are handled by handleAuthError.) Mutations keep their per-call onError,
  // so the mutation cache stays auth-only to avoid double-toasting.
  queryCache: new QueryCache({
    onError: (err) => {
      if (handleAuthError(err)) return;
      toast(err instanceof ApiError ? err.message : 'Something went wrong loading data', 'err');
    },
  }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
});

// Auth guard for the protected area: redirect to /login if not authenticated.
async function requireAuth() {
  try {
    await queryClient.fetchQuery({ queryKey: ['me'], queryFn: () => api.get('/auth/me') });
  } catch {
    throw redirect({ to: '/login' });
  }
}

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });

// Public, no-login bill upload page (token-gated) — outside the auth guard.
const uploadRoute = createRoute({ getParentRoute: () => rootRoute, path: '/upload', component: PublicUploadPage });

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => appRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/time' }); } });
const timeRoute = createRoute({ getParentRoute: () => appRoute, path: '/time', component: TimePage });
const expensesRoute = createRoute({ getParentRoute: () => appRoute, path: '/expenses', component: ExpensesPage });
const invoicesRoute = createRoute({ getParentRoute: () => appRoute, path: '/invoices', component: InvoicesPage });
const invoiceDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoices/$id',
  component: function Detail() {
    const { id } = invoiceDetailRoute.useParams();
    return <InvoiceDetailPage id={id} />;
  },
});
const invoiceSummaryDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoice-summaries/$id',
  component: function SummaryDetail() {
    const { id } = invoiceSummaryDetailRoute.useParams();
    return <InvoiceSummaryDetailPage id={id} />;
  },
});
const jobsRoute = createRoute({ getParentRoute: () => appRoute, path: '/jobs', component: JobsPage });
const customersRoute = createRoute({ getParentRoute: () => appRoute, path: '/customers', component: CustomersPage });
const employeesRoute = createRoute({ getParentRoute: () => appRoute, path: '/employees', component: EmployeesPage });
const reportsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reports', component: ReportsPage });
const readinessRoute = createRoute({ getParentRoute: () => appRoute, path: '/readiness', component: ReadinessPage });
const importRoute = createRoute({ getParentRoute: () => appRoute, path: '/import', component: ImportPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
const usersRoute = createRoute({ getParentRoute: () => appRoute, path: '/users', component: UsersPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  uploadRoute,
  appRoute.addChildren([
    indexRoute,
    timeRoute,
    expensesRoute,
    invoicesRoute,
    invoiceDetailRoute,
    invoiceSummaryDetailRoute,
    jobsRoute,
    customersRoute,
    employeesRoute,
    reportsRoute,
    readinessRoute,
    importRoute,
    settingsRoute,
    usersRoute,
  ]),
]);

const router = createRouter({ routeTree, context: { queryClient } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

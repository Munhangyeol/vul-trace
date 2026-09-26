import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ProjectDashboardPage } from './routes/ProjectDashboardPage';
import { ProjectListPage } from './routes/ProjectListPage';
import { VulnerabilityDetailPage } from './routes/VulnerabilityDetailPage';
import { VulnerabilityListPage } from './routes/VulnerabilityListPage';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <header>
          <Link to="/">VulnTrace</Link>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<ProjectListPage />} />
            <Route path="/projects/:projectId" element={<ProjectDashboardPage />} />
            <Route
              path="/projects/:projectId/vulnerabilities"
              element={<VulnerabilityListPage />}
            />
            <Route path="/findings/:findingId" element={<VulnerabilityDetailPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

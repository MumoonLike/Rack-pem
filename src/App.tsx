import { Spin } from 'antd';
import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import { NAV } from './nav';
import { RackDrawerProvider } from './components/RackDrawer';

function Loading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
      <Spin />
    </div>
  );
}

export default function App() {
  const routes = NAV.flatMap((g) => (g.children ? g.children.map((c) => ({ path: c.path, C: c.component })) : [{ path: g.path!, C: g.component! }]));
  return (
    <RackDrawerProvider>
      <Routes>
        <Route element={<AppLayout />}>
          {routes.map(({ path, C }) => (
            <Route
              key={path}
              path={path}
              element={
                <Suspense fallback={<Loading />}>
                  <C />
                </Suspense>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </RackDrawerProvider>
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ProveedorSesion } from './sesion';
import './estilos.css';

const consultas = new QueryClient({
  // Cada pantalla recarga al abrirse (mostrando lo anterior mientras tanto): en un backoffice compartido
  // los datos cambian por otros usuarios y no deben verse viejos.
  defaultOptions: { queries: { staleTime: 0, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <ProveedorSesion>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ProveedorSesion>
    </QueryClientProvider>
  </StrictMode>,
);

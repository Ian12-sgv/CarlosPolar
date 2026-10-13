import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api se redirige a la API para evitar CORS. Si la API usa el
// certificado de la CA interna (https://localhost:3443), el proxy local no lo
// verifica: es tráfico de la misma máquina.
const api = { target: process.env.API_URL ?? 'http://localhost:3000', secure: false, rewrite: (ruta: string) => ruta.replace(/^\/api/, '') };

export default defineConfig({
  plugins: [react()],
  // Una sola copia de React: en el monorepo la app móvil usa otra versión
  // (la que exige Expo) y librerías como React Query podrían tomar esa.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: { '/api': api },
  },
  preview: {
    port: 4173,
    proxy: { '/api': api },
  },
});

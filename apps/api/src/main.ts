import { crearApp } from './app.js';

const app = await crearApp();
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');

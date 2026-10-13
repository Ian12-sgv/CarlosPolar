import { crearPrisma } from '../src/prisma/conexion.js';
import { sembrarCatalogos } from '../src/prisma/catalogos.js';

const prisma = crearPrisma();
await sembrarCatalogos(prisma).finally(() => prisma.$disconnect());
console.log('Catálogos base cargados.');

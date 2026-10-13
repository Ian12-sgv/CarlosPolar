/**
 * Crea el primer usuario administrador.
 *
 *   ADMIN_PASSWORD='...' pnpm usuario:admin <username> "<Nombre completo>"
 *
 * La contraseña se lee de la variable de entorno para que no quede en el
 * historial de la terminal.
 */
import { crearUsuarioSchema } from '@cp/domain';
import { crearPrisma } from '../prisma/conexion.js';
import { crearUsuario } from '../usuarios/crear-usuario.js';

const [username, nombre] = process.argv.slice(2);
const datos = crearUsuarioSchema.safeParse({ username, nombre, password: process.env.ADMIN_PASSWORD, roles: ['ADMIN'] });
if (!datos.success) {
  console.error('Uso: ADMIN_PASSWORD=<mínimo 10 caracteres> pnpm usuario:admin <username> "<Nombre>"');
  for (const issue of datos.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const prisma = crearPrisma();
try {
  const usuario = await prisma.$transaction(async (tx) => {
    const creado = await crearUsuario(tx, datos.data);
    await tx.auditoria.create({
      data: { origen: 'SISTEMA', accion: 'usuario.crear_admin', tabla: 'usuarios', registroId: creado.id, datosDespues: { username: creado.username } },
    });
    return creado;
  });
  console.log(`Administrador "${usuario.username}" creado.`);
} finally {
  await prisma.$disconnect();
}

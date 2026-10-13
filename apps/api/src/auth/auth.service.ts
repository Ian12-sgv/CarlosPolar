import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { IniciarSesion, Origen, Permiso } from '@cp/domain';
import { config } from '../config.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio } from '../comun/errores.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HASH_FICTICIO, generarToken, hashToken, verificarContrasena } from './secretos.js';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiraEn: Date;
  sesionExpiraEn: Date;
}

export interface UsuarioSesion {
  id: string;
  username: string;
  nombre: string;
  roles: string[];
  permisos: Permiso[];
  vendedorId: string | null;
}

/** Solo se actualiza `ultimo_uso_en` si pasó este tiempo, para no escribir en cada solicitud. */
const INTERVALO_ULTIMO_USO_MS = 60_000;

const incluirPermisos = {
  vendedor: { select: { id: true, activo: true } },
  roles: { select: { rol: { select: { codigo: true, permisos: { select: { permiso: { select: { codigo: true } } } } } } } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async iniciarSesion(
    datos: IniciarSesion,
    origen: Origen,
    ip: string | null,
  ): Promise<Tokens & { usuario: UsuarioSesion }> {
    const usuario = await this.prisma.usuario.findUnique({ where: { username: datos.username }, include: incluirPermisos });
    // Se verifica siempre una contraseña para que el tiempo de respuesta no revele si el usuario existe.
    const valida = await verificarContrasena(datos.password, usuario?.passwordHash ?? HASH_FICTICIO);

    if (!usuario || !valida || !usuario.activo) {
      await this.auditoria.registrar(this.prisma, {
        usuarioId: usuario?.id ?? null,
        origen,
        ip,
        accion: 'sesion.fallida',
        tabla: 'sesiones',
        despues: { username: datos.username, motivo: !usuario || !valida ? 'credenciales' : 'usuario_inactivo' },
      });
      throw new UnauthorizedException({ codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Usuario o contraseña incorrectos' });
    }

    return this.prisma.$transaction(async (tx) => {
      const dispositivo = await tx.dispositivo.upsert({
        where: { usuarioId_identificador: { usuarioId: usuario.id, identificador: datos.dispositivo.identificador } },
        create: { usuarioId: usuario.id, ...datos.dispositivo },
        update: { plataforma: datos.dispositivo.plataforma, nombre: datos.dispositivo.nombre },
      });
      if (dispositivo.revocadoEn) {
        throw new ForbiddenException({ codigo: 'DISPOSITIVO_REVOCADO', mensaje: 'Este dispositivo fue revocado' });
      }

      const { tokens, hashes } = nuevosTokens();
      const sesionExpiraEn = new Date(Date.now() + config.sesionDias * 86_400_000);
      const sesion = await tx.sesion.create({
        data: { usuarioId: usuario.id, dispositivoId: dispositivo.id, ...hashes, expiraEn: sesionExpiraEn },
      });
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        dispositivoId: dispositivo.id,
        origen,
        ip,
        accion: 'sesion.iniciar',
        tabla: 'sesiones',
        registroId: sesion.id,
      });
      return { ...tokens, sesionExpiraEn, usuario: aUsuarioSesion(usuario) };
    });
  }

  /** Rota ambos tokens. El refresh token anterior deja de servir. */
  async refrescar(refreshToken: string): Promise<Tokens> {
    const sesion = await this.prisma.sesion.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { usuario: true, dispositivo: true },
    });
    const ahora = new Date();
    if (
      !sesion ||
      sesion.revocadaEn ||
      sesion.expiraEn <= ahora ||
      !sesion.usuario.activo ||
      sesion.dispositivo?.revocadoEn
    ) {
      throw new UnauthorizedException({ codigo: 'SESION_INVALIDA', mensaje: 'La sesión expiró o fue revocada' });
    }
    const { tokens, hashes } = nuevosTokens();
    // El filtro por el hash anterior evita que dos refrescos simultáneos con el mismo token tengan éxito.
    const { count } = await this.prisma.sesion.updateMany({
      where: { id: sesion.id, refreshTokenHash: sesion.refreshTokenHash },
      data: { ...hashes, ultimoUsoEn: ahora },
    });
    if (count === 0) throw new UnauthorizedException({ codigo: 'SESION_INVALIDA', mensaje: 'La sesión expiró o fue revocada' });
    return { ...tokens, sesionExpiraEn: sesion.expiraEn };
  }

  async cerrarSesion(ctx: Contexto, ip: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sesion.update({ where: { id: ctx.sesionId }, data: { revocadaEn: new Date() } });
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip,
        accion: 'sesion.cerrar',
        tabla: 'sesiones',
        registroId: ctx.sesionId,
      });
    });
  }

  /** Valida un token de acceso y devuelve el contexto, o null si no es válido. */
  async autenticar(accessToken: string, origen: Origen): Promise<Contexto | null> {
    const sesion = await this.prisma.sesion.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { dispositivo: true, usuario: { include: incluirPermisos } },
    });
    const ahora = new Date();
    if (
      !sesion ||
      sesion.revocadaEn ||
      sesion.accessExpiraEn <= ahora ||
      sesion.expiraEn <= ahora ||
      !sesion.usuario.activo ||
      sesion.dispositivo?.revocadoEn
    ) {
      return null;
    }
    if (ahora.getTime() - sesion.ultimoUsoEn.getTime() > INTERVALO_ULTIMO_USO_MS) {
      await this.prisma.sesion.update({ where: { id: sesion.id }, data: { ultimoUsoEn: ahora } });
    }
    const usuario = aUsuarioSesion(sesion.usuario);
    return {
      usuarioId: usuario.id,
      sesionId: sesion.id,
      dispositivoId: sesion.dispositivoId,
      roles: usuario.roles,
      permisos: new Set(usuario.permisos),
      vendedorId: usuario.vendedorId,
      origen,
    };
  }

  async usuarioActual(ctx: Contexto): Promise<UsuarioSesion> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: ctx.usuarioId }, include: incluirPermisos });
    return aUsuarioSesion(usuario);
  }
}

function nuevosTokens() {
  const accessToken = generarToken();
  const refreshToken = generarToken();
  const accessExpiraEn = new Date(Date.now() + config.accesoMinutos * 60_000);
  return {
    tokens: { accessToken, refreshToken, accessExpiraEn },
    hashes: { accessTokenHash: hashToken(accessToken), refreshTokenHash: hashToken(refreshToken), accessExpiraEn },
  };
}

interface UsuarioConPermisos {
  id: string;
  username: string;
  nombre: string;
  vendedor: { id: string; activo: boolean } | null;
  roles: { rol: { codigo: string; permisos: { permiso: { codigo: string } }[] } }[];
}

function aUsuarioSesion(u: UsuarioConPermisos): UsuarioSesion {
  const permisos = new Set(u.roles.flatMap((r) => r.rol.permisos.map((p) => p.permiso.codigo as Permiso)));
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    roles: u.roles.map((r) => r.rol.codigo),
    permisos: [...permisos].sort(),
    vendedorId: u.vendedor?.activo ? u.vendedor.id : null,
  };
}

export class SinPermiso extends ErrorNegocio {
  constructor(faltantes: Permiso[]) {
    super('SIN_PERMISO', 'No tiene permiso para esta acción', 403, { faltantes });
  }
}

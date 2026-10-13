import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '../api';
import { Boton, Campo, Encabezado, Estado, Insignia, MensajeError, Modal, Tarjeta, useAccion } from '../componentes/ui';
import { fechaHoraCorta } from '../formatos';

interface Usuario {
  id: string;
  username: string;
  nombre: string;
  activo: boolean;
  roles: { rol: { codigo: string; nombre: string } }[];
  vendedor: { codigo: string } | null;
  dispositivos: { id: string; identificador: string; plataforma: string; nombre: string | null; registradoEn: string; revocadoEn: string | null }[];
}

interface Rol {
  codigo: string;
  nombre: string;
}

export function PaginaUsuarios() {
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => get<Usuario[]>('/usuarios') });
  const [nuevo, setNuevo] = useState(false);
  const [dispositivos, setDispositivos] = useState<Usuario | null>(null);
  return (
    <>
      <Encabezado
        titulo="Usuarios"
        acciones={
          <Boton variante="primario" onClick={() => setNuevo(true)}>
            Nuevo usuario
          </Boton>
        }
      />
      <Tarjeta>
        <Estado cargando={usuarios.isLoading} error={usuarios.error}>
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Roles</th>
                <th>Vendedor</th>
                <th className="num">Dispositivos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username} {!u.activo && <Insignia estado="ANULADO" />}
                  </td>
                  <td>{u.nombre}</td>
                  <td>{u.roles.map((r) => r.rol.nombre).join(', ')}</td>
                  <td>{u.vendedor?.codigo ?? '—'}</td>
                  <td className="num">{u.dispositivos.filter((d) => !d.revocadoEn).length}</td>
                  <td>
                    <Boton onClick={() => setDispositivos(u)}>Dispositivos</Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Tarjeta>
      {nuevo && <ModalNuevoUsuario alCerrar={() => setNuevo(false)} />}
      {dispositivos && <ModalDispositivos usuario={usuarios.data?.find((u) => u.id === dispositivos.id) ?? dispositivos} alCerrar={() => setDispositivos(null)} />}
    </>
  );
}

function ModalNuevoUsuario({ alCerrar }: { alCerrar: () => void }) {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Rol[]>('/roles') });
  const [f, setF] = useState({ username: '', nombre: '', password: '', codigoVendedor: '' });
  const [elegidos, setElegidos] = useState<string[]>([]);
  const crear = useAccion(
    () => post('/usuarios', { ...f, codigoVendedor: f.codigoVendedor.trim() || undefined, roles: elegidos }),
    [['usuarios'], ['vendedores'], ['choferes']],
    alCerrar,
  );
  return (
    <Modal titulo="Nuevo usuario" abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Campo etiqueta="Usuario" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <Campo etiqueta="Nombre completo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <Campo etiqueta="Contraseña inicial" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} ayuda="Mínimo 10 caracteres" />
        <Campo
          etiqueta="Código de vendedor"
          value={f.codigoVendedor}
          onChange={(e) => setF({ ...f, codigoVendedor: e.target.value })}
          ayuda="Solo para preventistas"
        />
      </div>
      <h2>Roles</h2>
      <div className="rejilla" style={{ margin: '8px 0 14px' }}>
        {roles.data?.map((r) => (
          <label key={r.codigo} className="casilla">
            <input
              type="checkbox"
              checked={elegidos.includes(r.codigo)}
              onChange={(e) => setElegidos(e.target.checked ? [...elegidos, r.codigo] : elegidos.filter((x) => x !== r.codigo))}
            />
            {r.nombre}
          </label>
        ))}
      </div>
      <MensajeError texto={crear.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={elegidos.length === 0 || crear.enCurso} onClick={() => crear.ejecutar(undefined)}>
          Crear
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

/** Revocar corta de inmediato las sesiones del dispositivo (teléfono perdido o robado). */
function ModalDispositivos({ usuario, alCerrar }: { usuario: Usuario; alCerrar: () => void }) {
  const revocar = useAccion((id: string) => post(`/dispositivos/${id}/revocar`), [['usuarios']]);
  return (
    <Modal titulo={`Dispositivos de ${usuario.nombre}`} abierto alCerrar={alCerrar}>
      <MensajeError texto={revocar.error} />
      <Estado vacio={usuario.dispositivos.length === 0}>
        <table>
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Registrado</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {usuario.dispositivos.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.plataforma} <span className="sutil">{d.nombre?.slice(0, 40) ?? d.identificador.slice(0, 20)}</span>
                </td>
                <td>{fechaHoraCorta(d.registradoEn)}</td>
                <td>{d.revocadoEn ? <Insignia estado="ANULADO" /> : <Insignia estado="VALIDADO" />}</td>
                <td>
                  {!d.revocadoEn && (
                    <Boton variante="peligro" disabled={revocar.enCurso} onClick={() => revocar.ejecutar(d.id)}>
                      Revocar
                    </Boton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Modal>
  );
}

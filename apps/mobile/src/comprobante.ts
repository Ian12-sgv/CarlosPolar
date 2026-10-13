import { MAX_IMAGEN_BYTES, type Imagen } from '@cp/domain';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const ANCHO_MAXIMO = 1280;
const CALIDADES = [0.6, 0.45, 0.3];

export type ResultadoFoto = { imagen: Imagen; uri: string } | { error: string } | null;

/**
 * Toma la foto del comprobante con la cámara, la reduce a 1280 px de ancho y
 * la comprime a JPEG hasta que quepa en el límite de la API (512 KB).
 * Devuelve null si el usuario canceló.
 */
export async function fotografiarComprobante(): Promise<ResultadoFoto> {
  const permiso = await ImagePicker.requestCameraPermissionsAsync();
  if (!permiso.granted) return { error: 'Permita el uso de la cámara para fotografiar el comprobante.' };
  const captura = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false });
  if (captura.canceled || !captura.assets[0]) return null;

  const original = captura.assets[0];
  const contexto = ImageManipulator.manipulate(original.uri);
  if (original.width > ANCHO_MAXIMO) contexto.resize({ width: ANCHO_MAXIMO });
  const imagen = await contexto.renderAsync();
  for (const compress of CALIDADES) {
    const resultado = await imagen.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
    const base64 = resultado.base64 ?? '';
    // Bytes reales del archivo a partir del largo del base64.
    if (base64 && Math.floor((base64.length * 3) / 4) <= MAX_IMAGEN_BYTES) {
      return { imagen: { mime: 'image/jpeg', contenidoBase64: base64 }, uri: resultado.uri };
    }
  }
  return { error: 'La foto es demasiado pesada aun comprimida; tómela más de cerca.' };
}

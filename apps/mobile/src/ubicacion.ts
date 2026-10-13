import * as Location from 'expo-location';

export interface Coordenadas {
  latitud: number;
  longitud: number;
  precisionMetros?: number;
}

/**
 * Ubicación actual para la evidencia de la acción. Si no hay señal GPS a
 * tiempo, usa la última conocida. Devuelve null si el usuario negó el permiso.
 */
export async function ubicacionActual(): Promise<Coordenadas | null> {
  const permiso = await Location.requestForegroundPermissionsAsync();
  if (permiso.status !== 'granted') return null;
  const convertir = (p: Location.LocationObject): Coordenadas => ({
    latitud: Number(p.coords.latitude.toFixed(6)),
    longitud: Number(p.coords.longitude.toFixed(6)),
    precisionMetros: p.coords.accuracy !== null ? Math.round(p.coords.accuracy) : undefined,
  });
  try {
    const actual = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (actual) return convertir(actual);
  } catch {
    // Sin señal: se intenta con la última posición conocida.
  }
  const ultima = await Location.getLastKnownPositionAsync();
  return ultima ? convertir(ultima) : null;
}

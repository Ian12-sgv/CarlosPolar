/** Distancia en metros entre dos coordenadas (fórmula del haversine). */
export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(a)));
}

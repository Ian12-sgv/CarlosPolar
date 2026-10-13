import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { colores, textos } from '../ui';

export interface ControlFirma {
  /** PNG en base64, o null si no se firmó. */
  capturar: () => Promise<string | null>;
  limpiar: () => void;
}

/** Recuadro para firmar con el dedo. Se captura como PNG para adjuntarlo a la entrega. */
export const Firma = forwardRef<ControlFirma, { alCambiar?: (firmado: boolean) => void }>(function Firma({ alCambiar }, ref) {
  const vista = useRef<View>(null);
  const [trazos, setTrazos] = useState<string[]>([]);
  const actual = useRef('');
  const [, refrescar] = useState(0);

  const gestos = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        actual.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        refrescar((n) => n + 1);
      },
      onPanResponderMove: (e) => {
        actual.current += ` L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        refrescar((n) => n + 1);
      },
      onPanResponderRelease: () => {
        const trazo = actual.current;
        actual.current = '';
        setTrazos((t) => {
          const nuevos = [...t, trazo];
          alCambiar?.(true);
          return nuevos;
        });
      },
    }),
  ).current;

  useImperativeHandle(ref, () => ({
    capturar: async () => (trazos.length === 0 || !vista.current ? null : captureRef(vista, { format: 'png', quality: 1, result: 'base64', width: 600 })),
    limpiar: () => {
      setTrazos([]);
      alCambiar?.(false);
    },
  }));

  return (
    <View>
      <View
        ref={vista}
        collapsable={false}
        style={{ height: 180, backgroundColor: '#fff', borderWidth: 1, borderColor: colores.borde, borderRadius: 10 }}
        {...gestos.panHandlers}
      >
        <Svg width="100%" height="100%">
          {[...trazos, actual.current].filter(Boolean).map((d, i) => (
            <Path key={i} d={d} stroke={colores.texto} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
      </View>
      <Text style={[textos.sutil, { textAlign: 'center', marginTop: 4 }]}>Firma del receptor</Text>
    </View>
  );
});

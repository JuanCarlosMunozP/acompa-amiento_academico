/** Selección, descarga e impresión de archivos en web y móvil. */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** Abre el selector y devuelve el archivo listo para enviar, o `null` si se canceló. */
export async function elegirArchivo(): Promise<{ formulario: FormData; nombre: string } | null> {
  const resultado = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (resultado.canceled) return null;
  const archivo = resultado.assets[0];
  const formulario = new FormData();
  if (Platform.OS === 'web' && archivo.file) formulario.append('archivo', archivo.file);
  else
    formulario.append('archivo', {
      uri: archivo.uri,
      name: archivo.name,
      type: archivo.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
  return { formulario, nombre: archivo.name };
}

const nombreSeguro = (nombre: string) => nombre.replace(/[\\/:*?"<>|]/g, '_');

/** Guarda la respuesta como archivo: descarga en web y menú de compartir en móvil. */
export async function guardarRespuesta(response: Response, nombreAlternativo: string) {
  const disposition = response.headers.get('Content-Disposition');
  const nombre = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? nombreAlternativo;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await response.blob());
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  const uri = `${FileSystem.cacheDirectory}${nombreSeguro(nombre)}`;
  await FileSystem.writeAsStringAsync(uri, btoa(binario), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
}

/**
 * Abre el reporte HTML en una pestaña nueva para imprimirlo (web).
 * En móvil lo comparte como archivo HTML, que se abre e imprime desde el navegador del equipo.
 */
export async function abrirParaImprimir(response: Response, nombreAlternativo: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  await guardarRespuesta(response, nombreAlternativo);
}

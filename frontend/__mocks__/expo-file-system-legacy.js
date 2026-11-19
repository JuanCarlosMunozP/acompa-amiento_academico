// Sustituto estable de 'expo-file-system/legacy' en Jest: así todos los archivos (tests y código)
// resuelven el mismo módulo y los jest.mock con factoría se aplican siempre.
module.exports = {
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  writeAsStringAsync: async () => undefined,
};

const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
  },
  { ignores: ['dist/*', 'node_modules/*', '.expo/*'] },
];

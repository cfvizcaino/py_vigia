module.exports = function (api) {
  api.cache(true);
  const isTest = process.env.NODE_ENV === 'test';
  return {
    presets: [['babel-preset-expo', { worklets: false, reanimated: false }]],
    plugins: isTest ? [] : ['react-native-worklets/plugin'],
  };
};

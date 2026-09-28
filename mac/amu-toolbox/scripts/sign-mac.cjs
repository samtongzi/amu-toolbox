// electron-builder 26.0.12 does not implement identity="-" itself.
// Use its bundled osx-sign to sign nested Electron helpers before the outer app.
const { signAsync } = require('@electron/osx-sign');
module.exports = async options => {
  if (process.platform !== 'darwin') throw new Error('应用签名必须在 Mac 上执行');
  await signAsync({ ...options, identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile: file => ({ ...options.optionsForFile(file), timestamp: 'none' }) });
};

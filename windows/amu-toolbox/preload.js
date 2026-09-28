const { contextBridge, ipcRenderer } = require("electron");
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld("toolbox", {
  state: () => invoke("toolbox:state"),
  install: id => invoke("toolbox:install", id),
  launch: id => invoke("toolbox:launch", id),
  export: id => invoke("toolbox:export", id),
  uninstall: id => invoke("toolbox:uninstall", id),
  cancel: () => invoke("toolbox:cancel"),
  showFolder: id => invoke("toolbox:show-folder", id),
  showExport: id => invoke("toolbox:show-export", id),
  installationFolder: () => invoke("toolbox:installation-folder"),
  onState: callback => ipcRenderer.on("toolbox:state", (_event, state) => callback(state))
});

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workwork', {
  guideSearch: (query) => ipcRenderer.invoke('guide-search', query),
  guideDetail: (type, id) => ipcRenderer.invoke('guide-detail', type, id),
  guideOpen: (url) => ipcRenderer.invoke('guide-open', url),
  guideStatus: () => ipcRenderer.invoke('guide-status'),
  guideConfigure: (config) => ipcRenderer.invoke('guide-configure', config),
  guideAsk: (question, context) => ipcRenderer.invoke('guide-ask', question, context),
  guideClear: (removeKey) => ipcRenderer.invoke('guide-clear', removeKey),
  snapshot: () => ipcRenderer.invoke('snapshot'),
  toggle: () => ipcRenderer.invoke('toggle'),
  gemPointer: (event) => ipcRenderer.send('gem-pointer', event),
  dismissGemTip: () => ipcRenderer.invoke('dismiss-gem-tip'),
  dismissConnectionsTip: () => ipcRenderer.invoke('dismiss-connections-tip'),
  decide: (id, decision) => ipcRenderer.invoke('decide', id, decision),
  openApp: (provider, key) => ipcRenderer.invoke('open-app', provider, key),
  copyFollowup: (key, text) => ipcRenderer.invoke('copy-followup', key, text),
  dismiss: (key) => ipcRenderer.invoke('dismiss', key),
  connect: (provider, remove = false) => ipcRenderer.invoke('connect', provider, remove),
  testConnection: (provider) => ipcRenderer.invoke('test-connection', provider),
  setCursorReview: (enabled) => ipcRenderer.invoke('cursor-review', enabled),
  goLive: () => ipcRenderer.invoke('go-live'),
  resetDemo: () => ipcRenderer.invoke('reset-demo'),
  subscribe: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
});

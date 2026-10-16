import {Backend, serverAddress} from './backend-client.js';

const secureStorage = Promise.all(['local', 'session'].map(area =>
  chrome.storage[area].setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})));

async function message(data, sender) {
  await secureStorage;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) throw Error('unauthorized');
  if (data.type === 'status') {
    const {config} = await chrome.storage.local.get('config');
    return {configured: !!config};
  }
  if (data.type === 'configure') {
    const config = {url: serverAddress(data.url), token: data.token.trim()};
    await new Backend(config).info();
    await chrome.storage.local.set({config});
    return {configured: true};
  }
  throw Error('unsupported_command');
}
chrome.runtime.onMessage.addListener((data, sender, reply) => {
  message(data, sender).then(value => reply({ok: true, ...value}), error => reply({ok: false, error: error.code || 'internal_error'}));
  return true;
});
